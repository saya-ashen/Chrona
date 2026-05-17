import { describe, expect, it } from "bun:test";
import {
  createGraphRuntime,
  createPlanGraphFromCompiledPlan,
  createNodeDefinitionFromCompiledNode,
  executeBuiltinGraphNode,
  applyDownstreamInvalidation,
  getDownstreamNodeIds,
  getUpstreamNodeIds,
  resolveEdgeSemantics,
  planDownstreamInvalidation,
  selectReadyNodeIds,
  runGraphExecution,
  validatePlanGraph,
  analyzeStructuralChangeImpact,
  resolveEffectivePlanGraph,
} from "./index";
import type { CompiledPlan, ConditionConfig, GraphExecutionState } from "./index";

function makeConditionConfig(input: {
  condition: string;
  evaluationBy: "user" | "system";
  branches: Array<{ label: string; nextNodeId: string }>;
  defaultNextNodeId?: string;
}): ConditionConfig {
  return {
    condition: input.condition,
    evaluationBy: input.evaluationBy,
    branches: input.branches,
    defaultNextNodeId: input.defaultNextNodeId,
  };
}

function makeBranchingPlan(): CompiledPlan {
  return {
    id: "compiled_branching",
    editablePlanId: "graph_branching",
    sourceVersion: 1,
    nodes: [
      {
        id: "choose",
        localId: "choose",
        type: "condition",
        title: "Choose path",
        description: "User chooses branch",
        config: makeConditionConfig({
          condition: "Pick route",
          evaluationBy: "user",
          branches: [{ label: "yes", nextNodeId: "done" }],
        }),
        dependencies: [],
        dependents: ["done"],
      },
      {
        id: "done",
        localId: "done",
        type: "condition",
        title: "Finish",
        description: "Terminal node",
        config: makeConditionConfig({
          condition: "Finish",
          evaluationBy: "user",
          branches: [{ label: "complete", nextNodeId: "done" }],
          defaultNextNodeId: "done",
        }),
        dependencies: ["choose"],
        dependents: [],
      },
    ],
    edges: [{ id: "edge_yes", from: "choose", to: "done", label: "yes" }],
    entryNodeIds: ["choose"],
  };
}

function makeForkedBranchingPlan(): CompiledPlan {
  return {
    id: "compiled_forked_branching",
    editablePlanId: "graph_forked_branching",
    sourceVersion: 1,
    nodes: [
      {
        id: "choose",
        localId: "choose",
        type: "condition",
        title: "Choose path",
        description: "User chooses branch",
        config: makeConditionConfig({
          condition: "Pick route",
          evaluationBy: "user",
          branches: [
            { label: "needs config", nextNodeId: "configure" },
            { label: "skip config", nextNodeId: "build" },
          ],
        }),
        dependencies: [],
        dependents: ["configure", "build"],
      },
      {
        id: "configure",
        localId: "configure",
        type: "task",
        title: "Configure",
        description: "Skipped branch node",
        config: { expectedOutput: "Configuration gathered" },
        dependencies: ["choose"],
        dependents: ["build"],
      },
      {
        id: "build",
        localId: "build",
        type: "task",
        title: "Build",
        description: "Selected branch node",
        config: { expectedOutput: "Build complete" },
        dependencies: ["choose", "configure"],
        dependents: [],
      },
    ],
    edges: [
      { id: "edge_choose_configure", from: "choose", to: "configure", label: "needs config" },
      { id: "edge_choose_build", from: "choose", to: "build", label: "skip config" },
      { id: "edge_configure_build", from: "configure", to: "build", label: "after config" },
    ],
    entryNodeIds: ["choose"],
  };
}

function activeDefinitionLayerId(graph: ReturnType<typeof createPlanGraphFromCompiledPlan>, nodeId: string) {
  const layer = graph.nodes.find((node) => node.id === nodeId)?.layers.find((candidate) => candidate.type === "definition");
  if (!layer) throw new Error(`Missing definition layer for ${nodeId}`);
  return layer.id;
}

function makeParallelPlan(): CompiledPlan {
  return {
    id: "compiled_parallel",
    editablePlanId: "graph_parallel",
    sourceVersion: 1,
    nodes: [
      {
        id: "left",
        localId: "left",
        type: "task",
        title: "Left",
        description: "Left task",
        config: { expectedOutput: "Left done" },
        dependencies: [],
        dependents: [],
      },
      {
        id: "right",
        localId: "right",
        type: "task",
        title: "Right",
        description: "Right task",
        config: { expectedOutput: "Right done" },
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["left", "right"],
  };
}

describe("graph-runtime", () => {
  it("marks unselected branch subgraphs skipped and keeps them out of active entry nodes", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeForkedBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });

    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [
        {
          id: "attempt_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          executionContextSnapshotId: "snapshot_choose_1",
          status: "succeeded",
          attemptNumber: 1,
          idempotencyKey: "choose:1",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      results: [
        {
          id: "result_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          attemptId: "attempt_choose_1",
          status: "current",
          selectedBranch: { label: "skip config", nextNodeId: "build", source: "system" },
        },
      ],
    });

    const configure = effective.nodes.find((node) => node.id === "configure");
    const build = effective.nodes.find((node) => node.id === "build");

    expect(configure?.reachable).toBe(false);
    expect(configure?.status).toBe("skipped");
    expect(build?.reachable).toBe(true);
    expect(build?.ready).toBe(true);
    expect(effective.entryNodeIds).toEqual(["choose"]);
    expect(effective.readyNodeIds).toEqual(["build"]);
    expect(effective.pendingNodeIds).not.toContain("configure");
    expect(effective.completedNodeIds).toContain("configure");
  });

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

  it("cancels a session by cancelling running attempts and obsoleting current results", async () => {
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
      ],
      results: [{ nodeId: "choose", status: "current", waitKind: "manual_action" }],
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
    expect(outcome.state.results[0]?.status).toBe("obsolete");
  });

  it("resolves edge semantics and traverses dependencies", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(resolveEdgeSemantics(graph.edges[0]!).selectsBranch).toBe(true);
    expect(getDownstreamNodeIds(graph, ["choose"])).toEqual(["done"]);
    expect(getUpstreamNodeIds(graph, ["done"])).toEqual(["choose"]);
    expect(getDownstreamNodeIds(graph, ["choose"], { maxDepth: 0 })).toEqual([]);
  });

  it("selects ready nodes with runtime selection options", async () => {
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

    expect(selectReadyNodeIds(outcome.effective, { maxNodes: 1 }).selectedNodeIds).toEqual([]);
    expect(selectReadyNodeIds(outcome.effective, { includeWaitingNodes: true }).selectedNodeIds).toEqual([]);
  });

  it("applies graph mutations through dispatch", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const definitionLayer = {
      id: "node_layer_graph_branching_extra_v1",
      nodeId: "extra",
      type: "definition" as const,
      createdAt: "2026-01-01T00:00:01.000Z",
      createdBy: "system" as const,
      definition: createNodeDefinitionFromCompiledNode({
        id: "extra",
        localId: "extra",
        type: "condition",
        title: "Extra",
        description: "Extra condition",
        config: makeConditionConfig({
          condition: "Continue?",
          evaluationBy: "user",
          branches: [{ label: "ok", nextNodeId: "extra" }],
          defaultNextNodeId: "extra",
        }),
        dependencies: [],
        dependents: [],
      }),
    };
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 400,
      callbacks: { executeNode: async () => null },
    });

    const outcome = await runtime.dispatch({
      type: "apply_mutation",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      context: null,
      mutation: {
        reason: "Add extra node",
        operations: [
          {
            type: "add_node",
            nodeId: "extra",
            semanticKey: "extra",
            definitionLayer,
          },
          {
            type: "add_edge",
            edge: {
              id: "edge_done_extra",
              fromNodeId: "done",
              toNodeId: "extra",
              type: "hard_dependency",
              active: true,
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          },
        ],
      },
    });

    expect(outcome.state.graph.nodes.some((node) => node.id === "extra")).toBe(true);
    expect(outcome.state.graph.edges.some((edge) => edge.id === "edge_done_extra")).toBe(true);
    expect(outcome.state.graph.mutations).toHaveLength(1);
    expect(outcome.events.map((event) => event.type)).toEqual([
      "command_received",
      "graph_mutation_applied",
    ]);
  });

  it("replaces a subgraph through mutation dispatch", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const definitionLayer = {
      id: "node_layer_graph_branching_review_v1",
      nodeId: "review",
      type: "definition" as const,
      createdAt: "2026-01-01T00:00:03.000Z",
      createdBy: "system" as const,
      definition: createNodeDefinitionFromCompiledNode({
        id: "review",
        localId: "review",
        type: "condition",
        title: "Review",
        description: "Replacement node",
        config: makeConditionConfig({
          condition: "Review complete?",
          evaluationBy: "user",
          branches: [{ label: "complete", nextNodeId: "review" }],
          defaultNextNodeId: "review",
        }),
        dependencies: ["choose"],
        dependents: [],
      }),
    };
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      now: () => 500,
      callbacks: { executeNode: async () => null },
    });

    const outcome = await runtime.dispatch({
      type: "apply_mutation",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      context: null,
      mutation: {
        reason: "Replace terminal branch",
        operations: [
          {
            type: "replace_subgraph",
            removeNodeIds: ["done"],
            nodes: [{ nodeId: "review", semanticKey: "review", definitionLayer }],
            edges: [
              {
                id: "edge_choose_review",
                fromNodeId: "choose",
                toNodeId: "review",
                type: "branch",
                active: true,
                label: "yes",
                createdAt: "2026-01-01T00:00:03.000Z",
                updatedAt: "2026-01-01T00:00:03.000Z",
              },
            ],
          },
        ],
      },
    });

    expect(outcome.state.graph.nodes.some((node) => node.id === "done")).toBe(false);
    expect(outcome.state.graph.nodes.some((node) => node.id === "review")).toBe(true);
    expect(outcome.state.graph.edges.find((edge) => edge.id === "edge_yes")?.active).toBe(false);
    expect(outcome.state.graph.edges.some((edge) => edge.id === "edge_choose_review")).toBe(true);
    expect(outcome.state.graph.mutations[0]?.affectedNodeIds).toEqual([
      "done",
      "review",
      "choose",
    ]);
    expect(outcome.state.graph.edges.find((edge) => edge.id === "edge_yes")?.updatedAt).toBe(
      "1970-01-01T00:00:00.500Z",
    );
  });

  it("plans and applies downstream invalidation", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const plan = planDownstreamInvalidation({
      graph,
      changedNodeIds: ["choose"],
      reason: "Changed upstream",
    });
    const state = applyDownstreamInvalidation({
      state: {
        graph,
        attempts: [
          {
            id: "attempt_done",
            taskId: "task_1",
            graphId: graph.id,
            nodeId: "done",
            nodeLayerId: graph.nodes[1]?.layers[0]?.id ?? "layer_done",
            executionContextSnapshotId: "ctx_done",
            status: "running",
            idempotencyKey: "done",
            attemptNumber: 1,
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        results: [{ nodeId: "done", status: "current", outputSummary: "Old done" }],
        executionContextSnapshots: [],
      },
      plan,
      now: "2026-01-01T00:00:02.000Z",
      mutationId: "mutation_1",
    });

    expect(plan.invalidatedNodeIds).toEqual(["done"]);
    expect(state.attempts[0]?.status).toBe("cancelled");
    expect(state.results[0]?.status).toBe("invalidated");
    expect(state.graph.nodes[1]?.layers.some((layer) => layer.type === "invalidation")).toBe(true);
  });

  it("analyzes structural change impact before applying mutations", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const impact = analyzeStructuralChangeImpact({
      graph,
      operations: [{ type: "update_edge", edgeId: "edge_yes", patch: { label: "ok" } }],
    });

    expect(impact.affectedNodeIds).toEqual(["choose", "done"]);
    expect(impact.changedEdgeIds).toEqual(["edge_yes"]);
    expect(impact.invalidatedNodeIds).toEqual(["done"]);
  });

  it("validates graph invariants with structured issues", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const invalid = {
      ...graph,
      nodes: [{ ...graph.nodes[0]!, layers: [] }, graph.nodes[0]!, graph.nodes[1]!],
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

    const result = validatePlanGraph(invalid);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_DEFINITION_LAYER");
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_NODE_ID");
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_EDGE_SOURCE");
  });

  it("validates condition branch targets", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const choose = graph.nodes[0]!;
    const layer = choose.layers[0];
    if (!layer || layer.type !== "definition") {
      throw new Error("Expected definition layer");
    }
    const invalid = {
      ...graph,
      nodes: [
        {
          ...choose,
          layers: [
            {
              ...layer,
              definition: {
                ...layer.definition,
                metadata: {
                  ...layer.definition.metadata,
                  branches: [{ label: "missing", nextNodeId: "missing" }],
                  defaultNextNodeId: "also_missing",
                },
              },
            },
          ],
        },
        graph.nodes[1]!,
      ],
    };

    const result = validatePlanGraph(invalid);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_BRANCH_TARGET");
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_DEFAULT_BRANCH_TARGET");
  });

  it("validates unreachable cyclic components", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: {
        id: "compiled_invalid_structure",
        editablePlanId: "graph_invalid_structure",
        sourceVersion: 1,
        nodes: [
          ...makeBranchingPlan().nodes,
          {
            id: "loop_a",
            localId: "loop_a",
            type: "condition",
            title: "Loop A",
            description: "Loop A",
            config: makeConditionConfig({
              condition: "Loop A",
              evaluationBy: "user",
              branches: [{ label: "next", nextNodeId: "loop_b" }],
            }),
            dependencies: ["loop_b"],
            dependents: ["loop_b"],
          },
          {
            id: "loop_b",
            localId: "loop_b",
            type: "condition",
            title: "Loop B",
            description: "Loop B",
            config: makeConditionConfig({
              condition: "Loop B",
              evaluationBy: "user",
              branches: [{ label: "next", nextNodeId: "loop_a" }],
            }),
            dependencies: ["loop_a"],
            dependents: ["loop_a"],
          },
        ],
        edges: [
          ...makeBranchingPlan().edges,
          { id: "edge_loop_a", from: "loop_a", to: "loop_b", label: "next" },
          { id: "edge_loop_b", from: "loop_b", to: "loop_a", label: "next" },
        ],
        entryNodeIds: ["choose"],
      },
      now: "2026-01-01T00:00:00.000Z",
    });

    const result = validatePlanGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("UNREACHABLE_NODE");
    expect(result.issues.map((issue) => issue.code)).toContain("CYCLE_DETECTED");
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
