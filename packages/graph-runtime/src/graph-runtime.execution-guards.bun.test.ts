import { describe, expect, it } from "bun:test";
import { createGraphRuntime, createPlanGraphFromCompiledPlan } from "./index";
import {
  activeDefinitionLayerId,
  makeBranchingPlan,
  makeLinearPlan,
} from "./graph-runtime.test-fixtures";

describe("graph-runtime execution guards", () => {
  it("blocks forced downstream execution when upstream dependencies are unfinished", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeLinearPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 900,
      executors: {
        task: async ({ node }) => ({ status: "done", summary: `${node.id} done`, evidence: {} }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "resume_after_unblock",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
      nodeId: "second",
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.currentNodeId).toBe("second");
    expect(outcome.state.attempts).toHaveLength(0);
    expect(outcome.message).toContain("unsatisfied dependencies");
  });

  it("blocks condition completion without a structured selectedBranch", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 901,
      executors: {
        condition: async () => ({ status: "done", summary: "Picked yes", evidence: {} }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.currentNodeId).toBe("choose");
    expect(outcome.state.attempts[0]).toMatchObject({
      nodeId: "choose",
      status: "failed",
      error: {
        code: "NODE_BLOCKED",
        message: "Condition node choose completed without a structured selectedBranch",
      },
    });
    expect(outcome.effective.nodes.find((node) => node.id === "choose")?.status).toBe("blocked");
  });

  it("blocks replayed states where a completed node has unfinished dependencies", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeLinearPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const secondLayerId = activeDefinitionLayerId(graph, "second");
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 902,
      executors: {
        task: async ({ node }) => ({ status: "done", summary: `${node.id} done`, evidence: {} }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: {
        graph,
        attempts: [],
        results: [
          {
            id: "bad_result_second",
            taskId: "task_1",
            graphId: graph.id,
            nodeId: "second",
            nodeLayerId: secondLayerId,
            status: "current",
            outputSummary: "Second incorrectly completed",
          },
        ],
        executionContextSnapshots: [],
      },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.state.attempts).toHaveLength(0);
    expect(outcome.message).toBe("Completed node second has unfinished dependency first");
  });
});
