import { expect, spyOn, test } from "bun:test";
import { runTypecheckStep } from "./verify-slice";

const outside = "packages/other/src/file.ts(1,1): error TS2322: Type mismatch.";
const inside = "scripts/example.ts(1,1): error TS2322: Type mismatch.\n  Assignment details.";

for (const { output, scoped, expected } of [
  { output: outside, scoped: true, expected: outside },
  { output: `${outside}\n${inside}`, scoped: true, expected: inside },
  { output: `${outside}\n${inside}`, scoped: false, expected: `${outside}\n${inside}` },
  { output: "error TS5058: The specified path does not exist.", scoped: true, expected: "error TS5058: The specified path does not exist." },
  { output: "", scoped: true, expected: "" },
]) {
  test(`typecheck failure remains a failure with scoped=${scoped}: ${output || "no diagnostics"}`, () => {
    const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({
      exitCode: 2,
      stdout: Buffer.from(output),
      stderr: Buffer.alloc(0),
    }) as ReturnType<typeof Bun.spawnSync>);
    try {
      const result = runTypecheckStep(["scripts/"], scoped);
      expect(result.ok).toBe(false);
      expect(result.details).toBe(expected);
      expect(result.summary).not.toContain("pre-existing");
      expect(spawn).toHaveBeenCalledWith(["bunx", "tsc", "--noEmit", "--pretty", "false"], expect.any(Object));
    } finally {
      spawn.mockRestore();
    }
  });
}

test("successful typecheck remains successful", () => {
  const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({
    exitCode: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  }) as ReturnType<typeof Bun.spawnSync>);
  try {
    expect(runTypecheckStep(["scripts/"], true).ok).toBe(true);
  } finally {
    spawn.mockRestore();
  }
});
