import { describe, expect, it } from "bun:test";

import { normalizeElfInterpreter, readElfInterpreter } from "../build/portable-elf";

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
