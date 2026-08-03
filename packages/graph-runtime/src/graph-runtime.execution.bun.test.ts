import { describe, expect, it } from "bun:test";
import {
  createGraphRuntime,
  createPlanGraphFromCompiledPlan,
  executeBuiltinGraphNode,
  runGraphExecution,
  resolveEffectivePlanGraph,
} from "./index";
import type { GraphExecutionState } from "./index";
import {
  activeDefinitionLayerId,
  makeBranchingPlan,
  makeLinearPlan,
  makeParallelPlan,
} from "./graph-runtime.test-fixtures";

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
      attempts: [
        {
          id: "external_attempt_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: graph.nodes[0]?.layers[0]?.id ?? "choose_layer",
          executionContextSnapshotId: "ctx_external_1",
          idempotencyKey: "external_1",
          attemptNumber: 1,
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
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
      type: "submit_node_result",
      state,
      context: null,
      nodeResult: {
        nodeId: "choose",
        expectedAttemptId: "external_attempt_1",
        status: "done",
        summary: "External run completed",
        evidence: { runId: "run_1" },
        output: [{ root: "root", elements: { root: { type: "JsonView", props: { value: { selected: "yes" } } } } }],
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });

    expect(second.status).toBe("waiting_for_user");
    expect(second.currentNodeId).toBe("done");
    expect(second.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["choose", "stale"],
      ["choose", "current"],
      ["done", "current"],
    ]);
    expect(second.state.results[1]).toMatchObject({
      evidence: { runId: "run_1" },
    });
    expect(second.events.map((event) => event.type)).toEqual([
      "command_received",
      "node_result_submitted",
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
      attempts: [
        {
          id: "external_attempt_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: graph.nodes[0]?.layers[0]?.id ?? "choose_layer",
          executionContextSnapshotId: "ctx_external_1",
          idempotencyKey: "external_1",
          attemptNumber: 1,
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      results: [
        {
          id: `result_${graph.id}_choose_${new Date(tick).toISOString()}`,
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
      type: "submit_node_result",
      state,
      context: null,
      continueExecution: false,
      nodeResult: {
        nodeId: "choose",
        expectedAttemptId: "external_attempt_1",
        status: "done",
        summary: "External run completed",
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });

    expect(result.status).toBe("running");
    expect(result.state.results.map((entry) => [entry.nodeId, entry.status])).toEqual([
      ["choose", "stale"],
      ["choose", "current"],
    ]);
    expect(new Set(result.state.results.map((entry) => entry.id)).size).toBe(2);
    expect(result.events.map((event) => event.type)).toEqual([
      "command_received",
      "node_result_submitted",
    ]);
  });

  it("continues after a node submits its result through a graph command", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeLinearPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const firstLayerId = activeDefinitionLayerId(graph, "first");
    const secondLayerId = activeDefinitionLayerId(graph, "second");
    let tick = 90;

    const outcome = await runGraphExecution({
      taskId: "task_1",
      runtimeName: "test",
      trigger: "manual",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      context: null,
      now: () => tick++,
      callbacks: {
        executeNode: async ({ node }) => ({
          status: "done",
          summary: `${node.id} done`,
          evidence: {},
        }),
        resolveSubmittedNodeState: async ({ node, attempt, state }) => {
          if (node.id !== "first") return null;
          return {
            ...state,
            attempts: state.attempts.map((entry) =>
              entry.id === attempt.id
                ? {
                    ...entry,
                    status: "succeeded",
                    finishedAt: "2026-01-01T00:00:01.000Z",
                  }
                : entry,
            ),
            results: [
              {
                id: "result_first_submitted",
                taskId: "task_1",
                graphId: graph.id,
                nodeId: "first",
                nodeLayerId: firstLayerId,
                attemptId: attempt.id,
                status: "current",
                outputSummary: "first submitted",
              },
            ],
          };
        },
      },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.executedNodeIds).toEqual(["first", "second"]);
    expect(outcome.state.results.map((result) => [result.nodeId, result.status])).toEqual([
      ["first", "current"],
      ["second", "current"],
    ]);
    expect(outcome.state.results[1]).toMatchObject({
      nodeId: "second",
      nodeLayerId: secondLayerId,
      outputSummary: "second done",
    });
  });

  it("does not count failed Chrona submissions as node results", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeParallelPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const nodeLayerId = activeDefinitionLayerId(graph, "left");

    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [
        {
          id: "attempt_left_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "left",
          nodeLayerId,
          executionContextSnapshotId: "ctx_left_1",
          idempotencyKey: "left_1",
          attemptNumber: 1,
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      results: [
        {
          id: "result_left_failed_submission",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "left",
          nodeLayerId,
          attemptId: "attempt_left_1",
          status: "current",
          outputSummary: "Provider returned final output but terminal tool submission failed",
        },
      ],
    });

    const leftNode = effective.nodes.find((node) => node.id === "left");
    expect(leftNode?.status).toBe("ready");
    expect(leftNode?.result).toBeUndefined();
  });

  it("surfaces rejected results even when an attempt is still marked running", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeParallelPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const nodeLayerId = activeDefinitionLayerId(graph, "left");

    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [
        {
          id: "attempt_left_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "left",
          nodeLayerId,
          executionContextSnapshotId: "ctx_left_1",
          idempotencyKey: "left_1",
          attemptNumber: 1,
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      results: [
        {
          id: "result_left_failed",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "left",
          nodeLayerId,
          attemptId: "attempt_left_1",
          status: "rejected",
          error: "Hermes run.completed event missing session_id",
        },
      ],
    });

    const leftNode = effective.nodes.find((node) => node.id === "left");
    expect(leftNode?.status).toBe("failed");
    expect(leftNode?.lastError).toBe("Hermes run.completed event missing session_id");
    expect(leftNode?.result?.status).toBe("rejected");
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

  it("does not expose another ready branch while one branch attempt is running", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeParallelPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    let tick = 700;
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => tick++,
      executors: {
        task: async ({ node }) => ({
          status: "started",
          summary: `${node.id} started`,
          evidence: {},
          output: { runtimeRunRef: `runtime-${node.id}` },
        }),
      },
    });

    const first = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });
    const second = await runtime.dispatch({
      type: "start",
      state: first.state,
      trigger: "manual",
      context: null,
    });

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(second.state.attempts).toHaveLength(1);
    expect(second.effective.readyNodeIds).toEqual([]);
    expect(second.effective.runningNodeIds).toHaveLength(1);
  });
  it("rejects a late terminal result from an obsolete attempt without completing its retry", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const layerId = graph.nodes[0]?.layers[0]?.id ?? "choose_layer";
    const state: GraphExecutionState = {
      graph,
      attempts: [
        {
          id: "attempt-a",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: layerId,
          executionContextSnapshotId: "ctx-a",
          idempotencyKey: "attempt-a",
          attemptNumber: 1,
          status: "failed",
          startedAt: "2026-01-01T00:00:00.000Z",
          runtimeSnapshot: { status: "failed", output: { runtimeRunRef: "run-a" } },
        },
        {
          id: "attempt-b",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: layerId,
          executionContextSnapshotId: "ctx-b",
          idempotencyKey: "attempt-b",
          attemptNumber: 2,
          status: "running",
          startedAt: "2026-01-01T00:00:02.000Z",
          runtimeSnapshot: { status: "running", output: { runtimeRunRef: "run-b" } },
        },
      ],
      results: [{
        id: "result-b-running",
        taskId: "task_1",
        graphId: graph.id,
        nodeId: "choose",
        attemptId: "attempt-b",
        status: "current",
        waitKind: "external_dependency",
        outputSummary: "Retry is running",
      }],
      executionContextSnapshots: [],
    };
    let tick = 900;
    const runtime = createGraphRuntime({ taskId: "task_1", runtimeName: "test", now: () => tick++ });

    const late = await runtime.dispatch({
      type: "submit_node_result",
      state,
      context: null,
      continueExecution: false,
      nodeResult: {
        nodeId: "choose",
        expectedAttemptId: "attempt-a",
        runtimeRunRef: "run-a",
        status: "done",
        summary: "Late attempt A",
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });
    expect(late.state.attempts.find((attempt) => attempt.id === "attempt-b")?.status).toBe("running");
    expect(late.state.results.at(-1)).toMatchObject({ attemptId: "attempt-a", status: "stale" });

    const exact = await runtime.dispatch({
      type: "submit_node_result",
      state: late.state,
      context: null,
      continueExecution: false,
      nodeResult: {
        nodeId: "choose",
        expectedAttemptId: "attempt-b",
        runtimeRunRef: "run-b",
        status: "done",
        summary: "Exact attempt B",
        selectedBranch: { label: "yes", nextNodeId: "done", source: "system" },
      },
    });
    expect(exact.state.attempts.find((attempt) => attempt.id === "attempt-b")?.status).toBe("succeeded");
    expect(exact.state.results.at(-1)).toMatchObject({ attemptId: "attempt-b", status: "current" });
  });

  it("accepts an exact active checkpoint result without reopening its terminal attempt", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeLinearPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const manualNode = graph.nodes.find((node) => node.id === "second")!;
    const state: GraphExecutionState = {
      graph,
      attempts: [{
        id: "attempt-manual",
        taskId: "task_1",
        graphId: graph.id,
        nodeId: "second",
        nodeLayerId: manualNode.layers[0]?.id ?? "second_layer",
        executionContextSnapshotId: "ctx-manual",
        idempotencyKey: "attempt-manual",
        attemptNumber: 1,
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        error: { code: "NODE_BLOCKED", message: "Manual completion required" },
      }],
      results: [{
        id: "result-manual-wait",
        taskId: "task_1",
        graphId: graph.id,
        nodeId: "second",
        nodeLayerId: manualNode.layers[0]?.id,
        attemptId: "attempt-manual",
        status: "current",
        waitKind: "manual_action",
        error: "Manual completion required",
      }],
      executionContextSnapshots: [],
    };
    const runtime = createGraphRuntime({ taskId: "task_1", runtimeName: "test", now: () => 1_000 });

    const outcome = await runtime.dispatch({
      type: "submit_node_result",
      state,
      context: null,
      continueExecution: false,
      nodeResult: {
        nodeId: "second",
        expectedAttemptId: "attempt-manual",
        status: "done",
        summary: "Manual review completed",
      },
    });

    expect(outcome.state.attempts[0]).toMatchObject({
      id: "attempt-manual",
      status: "failed",
      finishedAt: "2026-01-01T00:00:01.000Z",
      error: { code: "NODE_BLOCKED", message: "Manual completion required" },
    });
    expect(outcome.state.results.at(-1)).toMatchObject({
      attemptId: "attempt-manual",
      status: "current",
      outputSummary: "Manual review completed",
    });
    expect(outcome.effective.nodes.find((node) => node.id === "second")?.status).toBe("completed");
  });
});
