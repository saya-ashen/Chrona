import { describe, expect, it } from "bun:test";
import { createGraphRuntime, createPlanGraphFromCompiledPlan, executeBuiltinGraphNode } from "./index";
import type { GraphExecutionState } from "./index";
import { makeBranchingPlan } from "./graph-runtime.test-fixtures";

describe("graph-runtime dispatch", () => {
  it("dispatches start and resume commands through a graph runtime factory", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const initialState: GraphExecutionState = {
      graph,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
    };
    let tick = 10;
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => tick++,
      callbacks: {
        executeNode: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const first = await runtime.dispatch({
      type: "start",
      state: initialState,
      trigger: "manual",
      context: null,
    });

    expect(first.status).toBe("waiting_for_user");
    expect(first.events.map((event) => event.type)).toEqual([
      "command_received",
      "executable_path_computed",
      "node_started",
      "node_waiting_for_user",
    ]);

    const second = await runtime.dispatch({
      type: "resume_with_input",
      state: first.state,
      context: null,
      input: { nodeId: "choose", value: "yes", fields: { decision: "yes" }, replaceStatus: "obsolete" },
    });

    expect(second.status).toBe("waiting_for_user");
    expect(second.executedNodeIds).toEqual(["choose"]);
    expect(second.currentNodeId).toBe("done");
    expect(second.events[0]?.type).toBe("command_received");
  });

  it("dispatches nodes through the executor registry", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      executors: {
        condition: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("waiting_for_user");
    expect(outcome.currentNodeId).toBe("choose");
  });

  it("approves a waiting node and continues execution", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 100,
      executors: {
        condition: async ({ node }) =>
          node.id === "choose"
            ? { status: "waiting_for_approval", prompt: "Approve", reason: "Needs approval" }
            : { status: "done", summary: "done", evidence: {} },
      },
    });

    const first = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });
    const second = await runtime.dispatch({
      type: "resume_with_approval",
      state: first.state,
      context: null,
      input: { nodeId: "choose", approved: true },
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(second.state.results[0]?.review?.status).toBe("accepted");
    expect(second.state.results[0]?.status).toBe("obsolete");
  });

  it("retries a node by obsoleting current results and re-executing it", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    let calls = 0;
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 200 + calls,
      executors: {
        condition: async ({ node, plan, userInput }) => {
          calls += 1;
          return executeBuiltinGraphNode({ node, plan, userInput });
        },
      },
    });

    const first = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });
    const second = await runtime.dispatch({
      type: "retry_node",
      state: first.state,
      context: null,
      nodeId: "choose",
    });

    expect(second.status).toBe("waiting_for_user");
    expect(second.currentNodeId).toBe("choose");
    expect(second.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["choose", "obsolete"],
      ["choose", "current"],
    ]);
  });

  it("blocks retry when maxAttempts policy is reached", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      policies: { retry: { maxAttempts: 1 } },
      executors: {
        condition: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const first = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });
    const second = await runtime.dispatch({
      type: "retry_node",
      state: first.state,
      context: null,
      nodeId: "choose",
    });

    expect(second.status).toBe("blocked");
    expect(second.message).toContain("Retry limit reached");
    expect(second.state.results).toHaveLength(1);
  });

  it("cancels a session by cancelling running attempts and obsoleting active results", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 300,
      callbacks: { executeNode: async () => null },
    });
    const state: GraphExecutionState = {
      graph,
      attempts: [
        {
          id: "attempt_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: graph.nodes[0]?.layers[0]?.id ?? "layer_1",
          executionContextSnapshotId: "ctx_1",
          status: "running",
          idempotencyKey: "key_1",
          attemptNumber: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "attempt_2",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "done",
          nodeLayerId: graph.nodes[1]?.layers[0]?.id ?? "layer_2",
          executionContextSnapshotId: "ctx_2",
          status: "succeeded",
          idempotencyKey: "key_2",
          attemptNumber: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      results: [
        { nodeId: "choose", status: "current", waitKind: "manual_action" },
        { nodeId: "done", status: "current", outputSummary: "completed" },
      ],
      executionContextSnapshots: [],
    };

    const outcome = await runtime.dispatch({
      type: "cancel_session",
      state,
      context: null,
      reason: "Stop",
    });

    expect(outcome.status).toBe("cancelled");
    expect(outcome.state.graph.status).toBe("cancelled");
    expect(outcome.state.attempts[0]?.status).toBe("cancelled");
    expect(outcome.state.attempts[1]?.status).toBe("succeeded");
    expect(outcome.state.results[0]?.status).toBe("obsolete");
    expect(outcome.state.results[1]?.status).toBe("current");
  });

  it("blocks runtime commands when graph validation fails", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const invalidGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "bad_edge",
          fromNodeId: "missing",
          toNodeId: "done",
          type: "hard_dependency" as const,
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      executors: {
        condition: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph: invalidGraph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.events.map((event) => event.type)).toEqual([
      "command_received",
      "command_validation_failed",
    ]);
    expect(outcome.message).toContain("MISSING_EDGE_SOURCE");
  });
});
