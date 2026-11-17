import { describe, expect, it } from "bun:test";

import { normalizeElfInterpreter, readElfInterpreter, readElfLibraryPathTags, removeElfLibraryPaths } from "./portable-elf";

function createElfFixture(interpreter: string, slotSize = 96) {
  const interpreterOffset = 128;
  const binary = Buffer.alloc(interpreterOffset + slotSize);
  binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  binary.writeBigUInt64LE(64n, 32);
  binary.writeUInt16LE(64, 52);
  binary.writeUInt16LE(56, 54);
  binary.writeUInt16LE(1, 56);

  binary.writeUInt32LE(3, 64);
  binary.writeBigUInt64LE(BigInt(interpreterOffset), 72);
  binary.writeBigUInt64LE(BigInt(slotSize), 96);
  binary.writeBigUInt64LE(BigInt(slotSize), 104);
  binary.write(`${interpreter}\0`, interpreterOffset, "utf8");
  return binary;
}

function createDynamicFixture(tags = [1n, 29n, 5n, 15n, 1n, 0n]) {
  const binary = Buffer.alloc(512);
  createElfFixture("/lib64/ld-linux-x86-64.so.2").copy(binary);
  binary.writeUInt16LE(2, 56);
  binary.writeBigUInt64LE(192n, 72);
  binary.fill(0, 128, 224);
  binary.write("/lib64/ld-linux-x86-64.so.2\0", 192);
  binary.writeUInt32LE(2, 120);
  binary.writeBigUInt64LE(288n, 128);
  binary.writeBigUInt64LE(128n, 152);
  binary.writeBigUInt64LE(128n, 160);
  for (const [index, tag] of tags.entries()) {
    binary.writeBigInt64LE(tag, 288 + index * 16);
    binary.writeBigUInt64LE(tag === 0n ? 0n : 416n, 296 + index * 16);
  }
  binary.write("/nix/store/compiler-libc/lib:/host/build/lib\0", 416);
  return binary;
}

describe("portable ELF library paths", () => {
  it("removes both path tags while preserving needed libraries, shared strings and the interpreter", () => {
    const binary = createDynamicFixture();
    const before = Buffer.from(binary);
    expect(readElfLibraryPathTags(binary)).toEqual([29n, 15n]);
    expect(removeElfLibraryPaths(binary)).toEqual({ removed: 2 });
    expect(readElfLibraryPathTags(binary)).toEqual([]);
    expect(readElfInterpreter(binary)).toBe("/lib64/ld-linux-x86-64.so.2");
    const expected = Buffer.concat([before.subarray(288, 304), before.subarray(320, 336), before.subarray(352, 384)]);
    expect(binary.subarray(288, 352)).toEqual(expected);
    expect(binary.subarray(352, 416)).toEqual(Buffer.alloc(64));
    expect(binary.subarray(416)).toEqual(before.subarray(416));
    expect(binary.subarray(0, 288)).toEqual(before.subarray(0, 288));
    const once = Buffer.from(binary);
    expect(removeElfLibraryPaths(binary)).toEqual({ removed: 0 });
    expect(binary).toEqual(once);
  });

  it("leaves static and already path-free executables byte-identical", () => {
    for (const binary of [createElfFixture("/lib64/ld-linux-x86-64.so.2"), createDynamicFixture([1n, 5n, 0n])]) {
      const before = Buffer.from(binary);
      expect(removeElfLibraryPaths(binary)).toEqual({ removed: 0 });
      expect(binary).toEqual(before);
    }
  });

  it.each(["bounds", "offset alignment", "size alignment", "terminator", "unsafe offset", "program headers"])("rejects malformed %s before modifying bytes", fault => {
    const binary = createDynamicFixture();
    if (fault === "bounds") binary.writeBigUInt64LE(1024n, 152);
    if (fault === "offset alignment") binary.writeBigUInt64LE(289n, 128);
    if (fault === "size alignment") binary.writeBigUInt64LE(127n, 152);
    if (fault === "terminator") for (let offset = 288; offset < 416; offset += 16) binary.writeBigInt64LE(1n, offset);
    if (fault === "unsafe offset") binary.writeBigUInt64LE(2n ** 63n, 128);
    if (fault === "program headers") binary.writeBigUInt64LE(2n ** 63n, 32);
    const before = Buffer.from(binary);
    expect(() => removeElfLibraryPaths(binary)).toThrow("ELF");
    expect(binary).toEqual(before);
  });
});

describe("portable ELF interpreter", () => {
  it("rewrites a host-specific interpreter to the portable Linux ABI path", () => {
    const binary = createElfFixture("/nix/store/example-glibc/lib/ld-linux-x86-64.so.2");

    expect(normalizeElfInterpreter(binary, "/lib64/ld-linux-x86-64.so.2")).toEqual({
      previousInterpreter: "/nix/store/example-glibc/lib/ld-linux-x86-64.so.2",
      changed: true,
    });
    expect(readElfInterpreter(binary)).toBe("/lib64/ld-linux-x86-64.so.2");
  });

  it("leaves an already portable interpreter unchanged", () => {
    const binary = createElfFixture("/lib/ld-linux-aarch64.so.1");

    expect(normalizeElfInterpreter(binary, "/lib/ld-linux-aarch64.so.1")).toEqual({
      previousInterpreter: "/lib/ld-linux-aarch64.so.1",
      changed: false,
    });
  });

  it("rejects non-ELF release files", () => {
    expect(() => readElfInterpreter(Buffer.from("not an elf"))).toThrow("not an ELF executable");
  });

  it("rejects an interpreter that cannot fit the existing segment", () => {
    const binary = createElfFixture("/ld.so", 8);
    expect(() => normalizeElfInterpreter(binary, "/lib64/ld-linux-x86-64.so.2")).toThrow(
      "does not fit existing PT_INTERP segment",
    );
  });
});
