import { describe, expect, it } from "bun:test";
import {
  analyzeStructuralChangeImpact,
  applyDownstreamInvalidation,
  createGraphRuntime,
  createNodeDefinitionFromCompiledNode,
  createPlanGraphFromCompiledPlan,
  planDownstreamInvalidation,
} from "./index";
import { makeBranchingPlan, makeConditionConfig } from "./graph-runtime.test-fixtures";

describe("graph-runtime mutation", () => {
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
});
