import { describe, expect, it } from "bun:test";
import { createPlanGraphScenario } from "./plan-graph-test-fixtures";

describe("plan graph failure and recovery fixtures", () => {
  it("captures retry, blocked, and failure containment transitions", () => {
    const retry = createPlanGraphScenario("retry");
    const blocked = createPlanGraphScenario("blocked");
    const failure = createPlanGraphScenario("failure");

    expect(retry.expectedTransitions.retryable).toEqual(["ready", "running", "failed", "retryable", "running", "succeeded"]);
    expect(blocked.expectedTransitions.blocked).toEqual(["ready", "running", "blocked"]);
    expect(failure.expectedTransitions.dependent).toEqual(["pending", "blocked"]);
  });

  it("preserves unrelated branch progress when one branch fails", () => {
    const scenario = createPlanGraphScenario("partial-branch-failure");

    expect(scenario.expectedTransitions.safe).toContain("succeeded");
    expect(scenario.expectedTransitions.fail).toContain("failed");
    expect(scenario.expectedOutcome).toBe("failed");
  });
});
