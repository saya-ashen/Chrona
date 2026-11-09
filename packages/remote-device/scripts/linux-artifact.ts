import { readFileSync, writeFileSync } from "node:fs";

/** Build-time only. Preserve ELF layout while removing builder-specific loader
 * and library search paths; no patchelf/compiler is needed by the artifact. */
export function elfInterpreter(binary: Buffer): string {
  const slot = segments(binary).find(segment => segment.type === 3);
  if (!slot) throw new Error("Linux artifact has no ELF interpreter");
  const value = binary.subarray(slot.offset, slot.offset + slot.size), end = value.indexOf(0);
  if (end < 0) throw new Error("Unterminated ELF interpreter");
  return value.subarray(0, end).toString("utf8");
}
function segments(binary: Buffer) {
  if (binary.length < 64 || binary.readUInt32BE(0) !== 0x7f454c46 || binary[4] !== 2 || binary[5] !== 1) throw new Error("Expected ELF64 little endian Linux artifact");
  const start = Number(binary.readBigUInt64LE(32)), count = binary.readUInt16LE(56), width = binary.readUInt16LE(54);
  if (width < 56 || !Number.isSafeInteger(start) || start < 64 || start + count * width > binary.length) throw new Error("Invalid ELF segment table");
  return Array.from({ length: count }, (_, index) => {
    const header = start + index * width, offset = Number(binary.readBigUInt64LE(header + 8)), size = Number(binary.readBigUInt64LE(header + 32));
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > binary.length) throw new Error("Invalid ELF segment");
    return { type: binary.readUInt32LE(header), offset, size, tableEnd: start + count * width };
  });
}
function libraryPathEntries(binary: Buffer, segment: { offset: number; size: number }) {
  const retained: Buffer[] = [];
  let terminated = false;
  for (let cursor = segment.offset; cursor < segment.offset + segment.size; cursor += 16) {
    const tag = binary.readBigUInt64LE(cursor);
    if (tag === 0n) { terminated = true; break; }
    if (tag !== 15n && tag !== 29n) retained.push(Buffer.from(binary.subarray(cursor, cursor + 16)));
  }
  if (!terminated) throw new Error("Unterminated ELF dynamic table");
  return retained;
}
function removeLibraryPaths(binary: Buffer, headers: ReturnType<typeof segments>, slot: { offset: number; size: number }) {
  const tables = headers.filter(segment => segment.type === 2);
  if (tables.length > 1) throw new Error("Multiple ELF dynamic tables");
  for (const segment of tables) {
    if (segment.offset < segment.tableEnd || segment.offset % 8 || segment.size < 16 || segment.size % 16) throw new Error("Invalid ELF dynamic table");
    if (segment.offset < slot.offset + slot.size && slot.offset < segment.offset + segment.size) throw new Error("ELF dynamic table overlaps interpreter");
    const retained = libraryPathEntries(binary, segment);
    binary.fill(0, segment.offset, segment.offset + segment.size);
    Buffer.concat(retained).copy(binary, segment.offset);
  }
}
export function normalizeLinuxArtifact(path: string, arch = process.arch) {
  const interpreter = arch === "x64" ? "/lib64/ld-linux-x86-64.so.2" : arch === "arm64" ? "/lib/ld-linux-aarch64.so.1" : null;
  if (!interpreter) throw new Error("Unsupported native Linux artifact architecture");
  const binary = readFileSync(path), headers = segments(binary), slot = headers.find(segment => segment.type === 3);
  if (!slot || Buffer.byteLength(interpreter) + 1 > slot.size) throw new Error("Portable interpreter does not fit ELF artifact");
  removeLibraryPaths(binary, headers, slot);
  binary.fill(0, slot.offset, slot.offset + slot.size); binary.write(interpreter, slot.offset, "utf8");
  if (elfInterpreter(binary) !== interpreter) throw new Error("ELF normalization failed");
  writeFileSync(path, binary);
}
