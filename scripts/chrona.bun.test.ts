import { describe, expect, it } from "bun:test";

import { normalizeArgs, resolveCommand, TEST_COMMANDS } from "./chrona";

describe("chrona command runner", () => {
  it("runs the full test command by default", () => {
    expect(resolveCommand(["test"])).toBe(TEST_COMMANDS.all);
  });

  it("keeps CI tests centralized across typed steps", () => {
    expect(resolveCommand(["test", "ci"])).toMatchObject({
      description: "CI unit coverage, Bun, API, and LLM replay tests",
      steps: [
        { label: "vitest unit coverage" },
        { label: "bun tests" },
        { label: "api tests" },
        { label: "llm replay tests" },
      ],
    });
  });

  it("keeps passthrough args separate from command resolution", () => {
    expect(normalizeArgs(["test", "unit", "--", "--reporter=verbose"])).toEqual({
      commandArgs: ["test", "unit"],
      passthrough: ["--reporter=verbose"],
    });
  });

  it("exposes release smoke through build commands", () => {
    expect(resolveCommand(["build", "smoke"])).toMatchObject({
      description: "Smoke test release artifacts",
      steps: [{ label: "release smoke", acceptsExtraArgs: true }],
    });
  });

  it("keeps the aggregate check limited to working quality gates", () => {
    const command = resolveCommand(["check"]);
    if (!command) throw new Error("Expected aggregate check command");

    expect(command.description).toBe("Typecheck, lint, boundaries, and UI foundation");
    expect(command.steps.map(({ label }) => label)).toEqual([
      "typecheck",
      "e2e typecheck",
      "lint ratchet",
      "boundaries",
      "ui foundation",
    ]);
  });

  it("runs boundary checks across apps packages features shared", () => {
    expect(resolveCommand(["check", "boundaries"])).toMatchObject({
      steps: [{ label: "boundaries" }],
    });
  });
});
