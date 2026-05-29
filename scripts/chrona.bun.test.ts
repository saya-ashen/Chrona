import { describe, expect, it } from "bun:test";

import { normalizeArgs, resolveCommand, TEST_COMMANDS } from "./chrona";

describe("chrona command runner", () => {
  it("runs the full test command by default", () => {
    expect(resolveCommand(["test"])).toBe(TEST_COMMANDS.all);
  });

  it("keeps CI tests centralized across unit, Bun, API, and LLM replay", () => {
    expect(resolveCommand(["test", "ci"])).toEqual({
      description: "CI unit, Bun, API, and LLM replay tests",
      run: [
        "bun",
        "x",
        "vitest",
        "run",
        "--reporter=verbose",
        "&&",
        "bun",
        "run",
        "scripts/run-bun-tests.ts",
        "&&",
        "bun",
        "run",
        "scripts/run-api-tests.ts",
        "&&",
        "bun",
        "test",
        "packages/engine/src/test/llm-fixtures.bun.test.ts",
      ],
    });
  });

  it("keeps passthrough args separate from command resolution", () => {
    expect(normalizeArgs(["test", "unit", "--", "--reporter=verbose"])).toEqual({
      commandArgs: ["test", "unit"],
      passthrough: ["--reporter=verbose"],
    });
  });
});
