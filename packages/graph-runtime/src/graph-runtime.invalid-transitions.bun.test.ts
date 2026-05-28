import { describe, expect, it } from "bun:test";
import { createGraphRuntime, createPlanGraphFromCompiledPlan } from "./index";
import { makeBranchingPlan, makeLinearPlan } from "./graph-runtime.test-fixtures";

describe("graph-runtime invalid transitions", () => {
  it("does not dispatch unknown node ids", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeLinearPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 1,
      executors: { task: async () => ({ status: "done", summary: "done", evidence: {} }) },
    });

    const outcome = await runtime.dispatch({
      type: "resume_after_unblock",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
      nodeId: "missing",
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.state.attempts).toHaveLength(0);
    expect(outcome.message).toContain("Node missing does not exist in the effective graph");
  });

  it("blocks condition branches that target nodes outside the graph", async () => {
    const compiledPlan = makeBranchingPlan();
    compiledPlan.nodes[0].config = {
      condition: "Pick route",
      evaluationBy: "user",
      branches: [{ label: "missing", nextNodeId: "missing" }],
    };
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan,
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 2,
      executors: {
        condition: async () => ({
          status: "done",
          summary: "Picked missing",
          evidence: {},
          selectedBranch: { label: "missing", nextNodeId: "missing", source: "ai" },
        }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.message).toContain("missing");
  });
});
