import { readFile, writeFile } from "node:fs/promises";

const ELF_CLASS_64 = 2;
const ELF_DATA_LITTLE_ENDIAN = 1;
const ELF_HEADER_SIZE_64 = 64;
const ELF_PROGRAM_HEADER_SIZE_64 = 56;
const PT_INTERP = 3;
const PT_DYNAMIC = 2;
const ELF_DYNAMIC_ENTRY_SIZE_64 = 16;
const DT_NULL = 0n;
const DT_RPATH = 15n;
const DT_RUNPATH = 29n;

type InterpreterSlot = {
  offset: number;
  size: number;
};

function assertElf64LittleEndian(binary: Buffer) {
  if (
    binary.length < ELF_HEADER_SIZE_64
    || binary[0] !== 0x7f
    || binary[1] !== 0x45
    || binary[2] !== 0x4c
    || binary[3] !== 0x46
  ) {
    throw new Error("Release binary is not an ELF executable");
  }
  if (binary[4] !== ELF_CLASS_64 || binary[5] !== ELF_DATA_LITTLE_ENDIAN) {
    throw new Error("Release binary must be a 64-bit little-endian ELF executable");
  }
}

function readProgramSegments(binary: Buffer) {
  assertElf64LittleEndian(binary);
  const programHeaderOffset = Number(binary.readBigUInt64LE(32));
  const programHeaderEntrySize = binary.readUInt16LE(54);
  const programHeaderCount = binary.readUInt16LE(56);
  if (programHeaderEntrySize < ELF_PROGRAM_HEADER_SIZE_64) {
    throw new Error(`ELF program header entry is too small: ${programHeaderEntrySize}`);
  }
  const tableEnd = programHeaderOffset + programHeaderCount * programHeaderEntrySize;
  if (!Number.isSafeInteger(programHeaderOffset) || programHeaderOffset < ELF_HEADER_SIZE_64 || tableEnd > binary.length) {
    throw new Error("ELF program header table extends beyond the release binary");
  }
  return Array.from({ length: programHeaderCount }, (_, index) => {
    const headerOffset = programHeaderOffset + index * programHeaderEntrySize;
    return {
      type: binary.readUInt32LE(headerOffset),
      offset: Number(binary.readBigUInt64LE(headerOffset + 8)),
      size: Number(binary.readBigUInt64LE(headerOffset + 32)),
      tableEnd,
    };
  });
}

function readInterpreterSlot(binary: Buffer): InterpreterSlot {
  const slot = readProgramSegments(binary).find(segment => segment.type === PT_INTERP);
  if (!slot) throw new Error("ELF release binary has no PT_INTERP segment");
  if (!Number.isSafeInteger(slot.offset) || !Number.isSafeInteger(slot.size) || slot.size <= 1 || slot.offset + slot.size > binary.length) {
    throw new Error("ELF interpreter segment is invalid");
  }
  return slot;
}

function assertDynamicTableBounds(binary: Buffer, table: InterpreterSlot & { tableEnd: number }) {
  if (!Number.isSafeInteger(table.offset) || !Number.isSafeInteger(table.size)
    || table.offset < table.tableEnd || table.offset % 8 !== 0
    || table.size < ELF_DYNAMIC_ENTRY_SIZE_64 || table.size % ELF_DYNAMIC_ENTRY_SIZE_64 !== 0
    || table.offset + table.size > binary.length) {
    throw new Error("ELF dynamic table has invalid bounds or alignment");
  }
}

function readDynamicEntries(binary: Buffer) {
  const segments = readProgramSegments(binary);
  const tables = segments.filter(segment => segment.type === PT_DYNAMIC);
  if (tables.length > 1) throw new Error("ELF has multiple PT_DYNAMIC segments");
  const table = tables[0];
  if (!table) return undefined; // Static executables have no dynamic search paths.
  assertDynamicTableBounds(binary, table);
  const interpreter = segments.find(segment => segment.type === PT_INTERP);
  if (interpreter && table.offset < interpreter.offset + interpreter.size && interpreter.offset < table.offset + table.size) {
    throw new Error("ELF dynamic table overlaps the interpreter");
  }
  const entries: { offset: number; tag: bigint }[] = [];
  for (let offset = table.offset; offset < table.offset + table.size; offset += ELF_DYNAMIC_ENTRY_SIZE_64) {
    const tag = binary.readBigInt64LE(offset);
    entries.push({ offset, tag });
    if (tag === DT_NULL) return { table, entries };
  }
  throw new Error("ELF dynamic table has no DT_NULL terminator");
}

export function readElfLibraryPathTags(binary: Buffer): bigint[] {
  return (readDynamicEntries(binary)?.entries ?? []).map(entry => entry.tag).filter(tag => tag === DT_RPATH || tag === DT_RUNPATH);
}

/** Remove search-path entries, never their strings: other tags can share string-table offsets. */
export function removeElfLibraryPaths(binary: Buffer): { removed: number } {
  const dynamic = readDynamicEntries(binary);
  if (!dynamic) return { removed: 0 };
  const retained = dynamic.entries.filter(entry => entry.tag !== DT_RPATH && entry.tag !== DT_RUNPATH);
  const removed = dynamic.entries.length - retained.length;
  if (removed === 0) return { removed };
  let destination = dynamic.table.offset;
  for (const entry of retained) {
    binary.copy(binary, destination, entry.offset, entry.offset + ELF_DYNAMIC_ENTRY_SIZE_64);
    destination += ELF_DYNAMIC_ENTRY_SIZE_64;
  }
  binary.fill(0, destination, dynamic.table.offset + dynamic.table.size);
  return { removed };
}

export async function removeElfLibraryPathsFile(path: string) {
  const binary = await readFile(path);
  const result = removeElfLibraryPaths(binary);
  if (result.removed > 0) await writeFile(path, binary);
  return result;
}

export function readElfInterpreter(binary: Buffer): string {
  const slot = readInterpreterSlot(binary);
  const segment = binary.subarray(slot.offset, slot.offset + slot.size);
  const terminator = segment.indexOf(0);
  if (terminator === -1) {
    throw new Error("ELF interpreter path is not null-terminated");
  }
  return segment.subarray(0, terminator).toString("utf8");
}

export function normalizeElfInterpreter(binary: Buffer, expectedInterpreter: string): {
  previousInterpreter: string;
  changed: boolean;
} {
  const slot = readInterpreterSlot(binary);
  const previousInterpreter = readElfInterpreter(binary);
  if (previousInterpreter === expectedInterpreter) {
    return { previousInterpreter, changed: false };
  }

  const encoded = Buffer.from(`${expectedInterpreter}\0`, "utf8");
  if (encoded.length > slot.size) {
    throw new Error(
      `Portable ELF interpreter path does not fit existing PT_INTERP segment: ${expectedInterpreter}`,
    );
  }

  binary.fill(0, slot.offset, slot.offset + slot.size);
  encoded.copy(binary, slot.offset);
  return { previousInterpreter, changed: true };
}

export async function normalizeElfInterpreterFile(path: string, expectedInterpreter: string) {
  const binary = await readFile(path);
  const result = normalizeElfInterpreter(binary, expectedInterpreter);
  if (result.changed) await writeFile(path, binary);
  return result;
}

export async function assertElfInterpreterFile(path: string, expectedInterpreter: string) {
  const actualInterpreter = readElfInterpreter(await readFile(path));
  if (actualInterpreter !== expectedInterpreter) {
    throw new Error(
      `Linux release binary uses non-portable ELF interpreter ${actualInterpreter}; expected ${expectedInterpreter}`,
    );
  }
}
