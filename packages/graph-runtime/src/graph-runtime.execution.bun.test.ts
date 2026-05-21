import { describe, expect, it } from "bun:test";
import {
  createGraphRuntime,
  createPlanGraphFromCompiledPlan,
  executeBuiltinGraphNode,
  runGraphExecution,
} from "./index";
import type { GraphExecutionState } from "./index";
import { makeBranchingPlan, makeParallelPlan } from "./graph-runtime.test-fixtures";

describe("graph-runtime execution", () => {
  it("builds, pauses, resumes, and advances a dynamic graph without engine dependencies", async () => {
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

    const first = await runGraphExecution({
      taskId: "task_1",
      runtimeName: "test",
      trigger: "manual",
      state: initialState,
      context: null,
      now: () => 1,
      callbacks: {
        executeNode: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    expect(first.status).toBe("waiting_for_user");
    expect(first.currentNodeId).toBe("choose");
    expect(first.state.results).toHaveLength(1);
    expect(first.state.results[0]).toMatchObject({
      nodeId: "choose",
      status: "current",
      waitKind: "user_input",
    });

    const second = await runGraphExecution({
      taskId: "task_1",
      runtimeName: "test",
      trigger: "manual",
      state: first.state,
      context: null,
      forcedNodeId: "choose",
      forcedReplaceStatus: "obsolete",
      userInput: "yes",
      inputFields: { decision: "yes" },
      now: () => 2,
      callbacks: {
        executeNode: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    expect(second.status).toBe("waiting_for_user");
    expect(second.executedNodeIds).toEqual(["choose"]);
    expect(second.currentNodeId).toBe("done");
    expect(second.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["choose", "obsolete"],
      ["choose", "current"],
      ["done", "current"],
    ]);
    expect(second.effective.completedNodeIds).toContain("choose");
    expect(second.effective.waitingForUserNodeIds).toContain("done");
  });

  it("returns running and keeps the attempt active when a node starts asynchronously", async () => {
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
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 123,
      callbacks: {
        executeNode: async () => ({
          status: "started",
          summary: "Run accepted",
          evidence: { sessionId: "session_1", runId: "run_1" },
          output: { runtimeRunRef: "runtime_run_1" },
        }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: initialState,
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("running");
    expect(outcome.currentNodeId).toBe("choose");
    expect(outcome.state.attempts).toHaveLength(1);
    expect(outcome.state.attempts[0]).toMatchObject({
      nodeId: "choose",
      status: "running",
      runtimeSnapshot: {
        evidence: { sessionId: "session_1", runId: "run_1" },
        output: { runtimeRunRef: "runtime_run_1" },
      },
    });
    expect(outcome.state.results).toHaveLength(0);
    expect(outcome.effective.runningNodeIds).toContain("choose");
    expect(outcome.effective.nodes.find((node) => node.id === "choose")?.status).toBe("running");
    expect(outcome.events.map((event) => event.type)).toEqual([
      "command_received",
      "executable_path_computed",
      "node_started",
    ]);
  });

  it("syncs external results and resumes downstream execution", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    let tick = 50;
    const state: GraphExecutionState = {
      graph,
      attempts: [],
      results: [
        {
          id: "result_pending_external",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          attemptId: "external_attempt_1",
          status: "current",
          waitKind: "external_dependency",
          outputSummary: "External run started",
        },
      ],
      executionContextSnapshots: [],
    };
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => tick++,
      executors: {
        condition: async ({ node, plan, userInput }) => executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const second = await runtime.dispatch({
      type: "sync_external_result",
      state,
      context: null,
      externalResult: {
        nodeId: "choose",
        status: "done",
        summary: "External run completed",
        evidence: { runId: "run_1" },
        output: [{ kind: "json", value: { selected: "yes" } }],
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });

    expect(second.status).toBe("waiting_for_user");
    expect(second.currentNodeId).toBe("done");
    expect(second.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["choose", "obsolete"],
      ["choose", "current"],
      ["done", "current"],
    ]);
    expect(second.state.results[1]).toMatchObject({
      evidence: { runId: "run_1" },
      outputs: [{ kind: "json", value: { selected: "yes" } }],
    });
    expect(second.events.map((event) => event.type)).toEqual([
      "command_received",
      "external_result_synced",
      "executable_path_computed",
      "node_started",
      "node_waiting_for_user",
    ]);
  });

  it("syncs external results without running downstream execution", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    let tick = 80;
    const state: GraphExecutionState = {
      graph,
      attempts: [],
      results: [
        {
          id: "result_pending_external",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          attemptId: "external_attempt_1",
          status: "current",
          waitKind: "external_dependency",
          outputSummary: "External run started",
        },
      ],
      executionContextSnapshots: [],
    };
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => tick++,
      executors: {
        condition: async ({ node, plan, userInput }) => executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });

    const result = await runtime.dispatch({
      type: "sync_external_result",
      state,
      context: null,
      continueExecution: false,
      externalResult: {
        nodeId: "choose",
        status: "done",
        summary: "External run completed",
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });

    expect(result.status).toBe("running");
    expect(result.state.results.map((entry) => [entry.nodeId, entry.status])).toEqual([
      ["choose", "obsolete"],
      ["choose", "current"],
    ]);
    expect(result.events.map((event) => event.type)).toEqual([
      "command_received",
      "external_result_synced",
    ]);
  });

  it("executes multiple ready nodes when maxConcurrency allows it", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeParallelPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    let tick = 600;
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => tick++,
      policies: { maxConcurrency: 2 },
      executors: {
        task: async ({ node }) => ({ status: "done", summary: `${node.id} done`, evidence: {} }),
      },
    });

    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.executedNodeIds).toEqual(["left", "right"]);
    expect(outcome.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["left", "current"],
      ["right", "current"],
    ]);
  });
});
