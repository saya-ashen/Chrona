import { describe, expect, it } from "bun:test";
import { createPlanGraphScenario } from "./plan-graph-test-fixtures";

describe("plan graph fixture coverage", () => {
  it("covers linear, branch, join, and sequential dependency scenarios", () => {
    for (const scenarioId of ["linear", "branch", "join"] as const) {
      const scenario = createPlanGraphScenario(scenarioId);

      expect(scenario.plan.nodes.length).toBeGreaterThanOrEqual(3);
      expect(scenario.plan.entryNodeIds.length).toBeGreaterThan(0);
      expect(scenario.plan.terminalNodeIds.length).toBeGreaterThan(0);
      expect(scenario.expectedOutcome).toBe("completed");
    }
  });

  it("keeps join nodes waiting until every prerequisite is complete", () => {
    const scenario = createPlanGraphScenario("join");
    const join = scenario.plan.nodes.find((node) => node.id === "join");

    expect(join?.dependencies).toEqual(["left", "right"]);
    expect(scenario.expectedTransitions.join).toEqual(["pending", "waiting", "ready", "running", "succeeded"]);
  });
});
