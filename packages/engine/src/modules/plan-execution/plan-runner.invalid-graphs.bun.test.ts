import { describe, expect, it } from "bun:test";
import { createAllPlanGraphScenarios, createPlanGraphScenario } from "./plan-graph-test-fixtures";

describe("invalid plan graph fixtures", () => {
  it("rejects empty, cyclic, and impossible graph topologies safely", () => {
    for (const scenarioId of ["empty", "cyclic", "impossible"] as const) {
      const scenario = createPlanGraphScenario(scenarioId);

      expect(scenario.expectedOutcome).toBe("rejected");
      expect(scenario.invalidReason).toBeTruthy();
      expect(scenario.plan.validationWarnings.length).toBeGreaterThan(0);
    }
  });

  it("keeps the required complex graph scenario catalog deterministic", () => {
    const scenarios = createAllPlanGraphScenarios();

    expect(scenarios).toHaveLength(13);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(13);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "linear",
      "branch",
      "join",
      "checkpoint",
      "retry",
      "blocked",
      "failure",
      "partial-branch-failure",
      "missing-result",
      "malformed-result",
      "empty",
      "cyclic",
      "impossible",
    ]);
  });
});
