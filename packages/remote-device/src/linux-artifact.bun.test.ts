import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { elfInterpreter, normalizeLinuxArtifact } from "../scripts/linux-artifact";

function fixture() {
  const bytes = Buffer.alloc(512);
  bytes.writeUInt32BE(0x7f454c46); bytes[4] = 2; bytes[5] = 1;
  bytes.writeBigUInt64LE(64n, 32); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(2, 56);
  bytes.writeUInt32LE(3, 64); bytes.writeBigUInt64LE(192n, 72); bytes.writeBigUInt64LE(64n, 96);
  bytes.write("/builder/ld-linux.so\0", 192);
  bytes.writeUInt32LE(2, 120); bytes.writeBigUInt64LE(256n, 128); bytes.writeBigUInt64LE(64n, 152);
  bytes.writeBigUInt64LE(1n, 256); bytes.writeBigUInt64LE(400n, 264);
  bytes.writeBigUInt64LE(29n, 272); bytes.writeBigUInt64LE(400n, 280);
  bytes.writeBigUInt64LE(15n, 288); bytes.writeBigUInt64LE(400n, 296);
  bytes.write("shared-string\0", 400);
  return bytes;
}
function withArtifact(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "chrona-device-elf-"));
  try { run(join(dir, "device")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("standalone ELF removes host search tags while preserving dependencies and shared strings", () => withArtifact(path => {
  const original = fixture(); writeFileSync(path, original);
  normalizeLinuxArtifact(path, "x64"); const bytes = readFileSync(path);
  expect(elfInterpreter(bytes)).toBe("/lib64/ld-linux-x86-64.so.2");
  expect(bytes.readBigUInt64LE(256)).toBe(1n);
  expect(bytes.readBigUInt64LE(264)).toBe(400n);
  expect(bytes.subarray(272, 320).equals(Buffer.alloc(48))).toBe(true);
  expect(bytes.subarray(400).equals(original.subarray(400))).toBe(true);
}));

for (const [name, corrupt] of [
  ["missing terminator", (bytes: Buffer) => bytes.writeBigUInt64LE(1n, 304)],
  ["overlapping interpreter", (bytes: Buffer) => bytes.writeBigUInt64LE(192n, 128)],
  ["misaligned dynamic table", (bytes: Buffer) => bytes.writeBigUInt64LE(257n, 128)],
  ["multiple dynamic tables", (bytes: Buffer) => {
    bytes.writeUInt16LE(3, 56); bytes.writeUInt32LE(2, 176);
    bytes.writeBigUInt64LE(320n, 184); bytes.writeBigUInt64LE(16n, 208);
  }],
] as const) test(`standalone ELF rejects ${name} without changing disk bytes`, () => withArtifact(path => {
  const bytes = fixture(); corrupt(bytes); writeFileSync(path, bytes);
  expect(() => normalizeLinuxArtifact(path, "x64")).toThrow();
  expect(readFileSync(path).equals(bytes)).toBe(true);
}));
