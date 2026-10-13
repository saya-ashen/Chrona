import { describe, expect, test } from "bun:test";
import { TOOL_STATES, TOOL_TRANSITIONS } from "@chrona/contracts/steward";
import type { HandlingMode, ToolState } from "@chrona/contracts/steward";
import { chooseHandling, nextToolState, ToolTransitionError } from "./handling";
import type { HandlingSignals, ToolTransition } from "./handling";

const base: HandlingSignals = {
  repeatsExpected: "once", rulesStable: true, needsOngoingObservation: false,
  needsUserInteraction: "none", ambiguity: "clear", existingToolFits: false,
  risk: "low", valueWorthKeeping: false,
};
const cases: [string, Partial<HandlingSignals>, HandlingMode][] = [
  ["one-off answer", {}, "direct_answer"],
  ["valuable one-off research", { valueWorthKeeping: true }, "result_page"],
  ["do not build a tool for one-off comparison", { needsUserInteraction: "compare_or_fill" }, "direct_answer"],
  ["do not reuse unnecessarily for one-off", { existingToolFits: true }, "direct_answer"],
  ["stable repeats reuse before generating", { repeatsExpected: "few", existingToolFits: true }, "reuse_tool"],
  ["a fitting tool suffices even when underlying rules vary", { repeatsExpected: "recurring", rulesStable: false, existingToolFits: true }, "reuse_tool"],
  ["stable repeats generate script", { repeatsExpected: "few" }, "script"],
  ["read-only interaction does not require a panel", { repeatsExpected: "recurring", needsUserInteraction: "read" }, "script"],
  ["ongoing observation overrides a fitting one-off tool", { existingToolFits: true, needsOngoingObservation: true }, "delegation"],
  ["ongoing recurring observation", { repeatsExpected: "recurring", needsOngoingObservation: true }, "delegation"],
  ["repeated comparison needs panel", { repeatsExpected: "few", needsUserInteraction: "compare_or_fill" }, "panel"],
  ["panel wins when observation also needs repeated comparison", { repeatsExpected: "recurring", needsUserInteraction: "compare_or_fill", needsOngoingObservation: true }, "panel"],
  ["fuzzy one-off needs iteration", { ambiguity: "fuzzy" }, "agent_iteration"],
  ["unstable repeated rules need iteration", { repeatsExpected: "recurring", rulesStable: false }, "agent_iteration"],
  ["fuzzy goals cannot be assumed solved by fitting tool", { ambiguity: "fuzzy", existingToolFits: true, repeatsExpected: "recurring" }, "agent_iteration"],
];
describe("6. lightest sufficient handling mode", () => {
  test.each(cases)("%s", (_name, overrides, mode) => {
    const signals = { ...base, ...overrides };
    const before = { ...signals };
    const result = chooseHandling(signals);
    expect(result.mode).toBe(mode);
    expect(result.rationale.length).toBeGreaterThan(20);
    expect(chooseHandling(signals)).toEqual(result);
    expect(signals).toEqual(before);
    if (mode === "direct_answer") expect(result.escalatesFrom).toBeUndefined();
    else expect(result.escalatesFrom).toBeDefined();
  });
  test("high-risk script requires validation and authorization, never auto-enables", () => {
    const result = chooseHandling({ ...base, repeatsExpected: "recurring", risk: "high" });
    expect(result.mode).toBe("script");
    expect(result.rationale).toContain("validation and authorization are required");
    expect(result).not.toHaveProperty("enabled");
  });
  test("entire signal space is deterministic and high risk always states its gate", () => {
    for (const repeatsExpected of ["once", "few", "recurring"] as const)
      for (const rulesStable of [false, true])
        for (const needsOngoingObservation of [false, true])
          for (const needsUserInteraction of ["none", "read", "compare_or_fill"] as const)
            for (const ambiguity of ["clear", "fuzzy"] as const)
              for (const existingToolFits of [false, true])
                for (const risk of ["low", "high"] as const)
                  for (const valueWorthKeeping of [false, true]) {
                    const signals = { repeatsExpected, rulesStable, needsOngoingObservation, needsUserInteraction, ambiguity, existingToolFits, risk, valueWorthKeeping };
                    const result = chooseHandling(signals);
                    expect(chooseHandling(signals)).toEqual(result);
                    if (risk === "high") expect(result.rationale).toContain("validation and authorization are required");
                  }
  });
});

const current = { version: 2, validatedVersion: 2, validationPassed: true };
const legal: [ToolState, ToolTransition, ToolState][] = [
  ["generated", "validate", "validated"],
  ["validation_failed", "validate", "validated"],
  ["validated", "authorize", "authorized"],
  ["authorized", "enable", "enabled"],
  ["enabled", "disable", "disabled"],
  ["disabled", "enable", "enabled"],
  ["disabled", "retire", "retired"],
];
describe("6. managed tool lifecycle separates generation, validation, authorization and enablement", () => {
  test.each(legal)("%s + %s -> %s", (state, action, result) => {
    expect(nextToolState(state, action, current)).toBe(result);
  });
  test.each(["generated", "validation_failed"] as const)("%s validation failure stays unvalidated", (state) => {
    expect(nextToolState(state, "validate", { ...current, validationPassed: false })).toBe("validation_failed");
    expect(() => nextToolState(state, "validate", { version: 2, validatedVersion: null })).toThrow(ToolTransitionError);
  });
  test("all other state/contract transition pairs fail closed", () => {
    for (const state of TOOL_STATES) for (const transition of TOOL_TRANSITIONS) {
      if (!legal.some(([from, action]) => from === state && action === transition)) {
        expect(() => nextToolState(state, transition, current)).toThrow(ToolTransitionError);
      }
    }
  });
  test.each([null, 1, 3])("cannot authorize or enable validation from version %s", (validatedVersion) => {
    for (const [state, action] of [["validated", "authorize"], ["authorized", "enable"], ["disabled", "enable"]] as const) {
      expect(() => nextToolState(state, action, { ...current, validatedVersion })).toThrow(ToolTransitionError);
    }
  });
  test.each([...TOOL_STATES])("editing %s creates a generated new version and revokes the old lifecycle", (state) => {
    const generated = nextToolState(state, "edit", { version: 3, validatedVersion: 2 });
    expect(generated).toBe("generated");
    expect(() => nextToolState(generated, "authorize", { version: 3, validatedVersion: 2 })).toThrow(ToolTransitionError);
    expect(() => nextToolState(generated, "enable", { version: 3, validatedVersion: 2 })).toThrow(ToolTransitionError);
  });
  test("full lifecycle requires revalidation after an edit", () => {
    let state = nextToolState("generated", "validate", { version: 1, validatedVersion: null, validationPassed: false });
    state = nextToolState(state, "validate", { version: 1, validatedVersion: null, validationPassed: true });
    state = nextToolState(state, "authorize", { version: 1, validatedVersion: 1 });
    state = nextToolState(state, "enable", { version: 1, validatedVersion: 1 });
    state = nextToolState(state, "edit", { version: 2, validatedVersion: 1 });
    state = nextToolState(state, "validate", { version: 2, validatedVersion: null, validationPassed: true });
    expect(() => nextToolState(state, "authorize", { version: 2, validatedVersion: 1 })).toThrow(ToolTransitionError);
    expect(nextToolState(state, "authorize", current)).toBe("authorized");
  });
  test.each([0, -1, 1.5, NaN, Infinity])("invalid version %s cannot transition", (version) => {
    expect(() => nextToolState("generated", "validate", { ...current, version })).toThrow(ToolTransitionError);
  });
});
