import { readFile, writeFile } from "node:fs/promises";

const ELF_CLASS_64 = 2;
const ELF_DATA_LITTLE_ENDIAN = 1;
const ELF_HEADER_SIZE_64 = 64;
const ELF_PROGRAM_HEADER_SIZE_64 = 56;
const PT_INTERP = 3;

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

function readInterpreterSlot(binary: Buffer): InterpreterSlot {
  assertElf64LittleEndian(binary);

  const programHeaderOffset = Number(binary.readBigUInt64LE(32));
  const programHeaderEntrySize = binary.readUInt16LE(54);
  const programHeaderCount = binary.readUInt16LE(56);
  if (programHeaderEntrySize < ELF_PROGRAM_HEADER_SIZE_64) {
    throw new Error(`ELF program header entry is too small: ${programHeaderEntrySize}`);
  }

  for (let index = 0; index < programHeaderCount; index += 1) {
    const headerOffset = programHeaderOffset + index * programHeaderEntrySize;
    if (headerOffset + ELF_PROGRAM_HEADER_SIZE_64 > binary.length) {
      throw new Error("ELF program header table extends beyond the release binary");
    }
    if (binary.readUInt32LE(headerOffset) !== PT_INTERP) continue;

    const offset = Number(binary.readBigUInt64LE(headerOffset + 8));
    const size = Number(binary.readBigUInt64LE(headerOffset + 32));
    if (size <= 1 || offset < 0 || offset + size > binary.length) {
      throw new Error("ELF interpreter segment is invalid");
    }
    return { offset, size };
  }

  throw new Error("ELF release binary has no PT_INTERP segment");
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
