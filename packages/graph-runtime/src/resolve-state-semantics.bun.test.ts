import { describe, expect, it } from "bun:test";

import { createPlanGraphFromCompiledPlan, resolveEffectivePlanGraph } from "./index";
import type { CompiledPlan } from "./index";

const now = "2026-05-17T00:00:00.000Z";

function makePlan(): CompiledPlan {
  return {
    id: "compiled_state_semantics",
    editablePlanId: "graph_state_semantics",
    sourceVersion: 1,
    nodes: [
      { id: "user", localId: "user", type: "task", title: "User", config: {}, dependencies: [], dependents: [] },
      { id: "approval", localId: "approval", type: "task", title: "Approval", config: {}, dependencies: [], dependents: [] },
      { id: "external", localId: "external", type: "task", title: "External", config: {}, dependencies: [], dependents: [] },
      { id: "degraded", localId: "degraded", type: "task", title: "Degraded", config: {}, dependencies: [], dependents: [] },
    ],
    edges: [],
    entryNodeIds: ["user", "approval", "external", "degraded"],
  };
}

function layerId(graph: ReturnType<typeof createPlanGraphFromCompiledPlan>, nodeId: string) {
  const layer = graph.nodes.find((node) => node.id === nodeId)?.layers.find((candidate) => candidate.type === "definition");
  if (!layer) throw new Error(`Missing layer for ${nodeId}`);
  return layer.id;
}

describe("resolveEffectivePlanGraph state semantics", () => {
  it("splits wait, approval, blocked, and degraded buckets", () => {
    const graph = createPlanGraphFromCompiledPlan({ taskId: "task_1", compiledPlan: makePlan(), now });
    const effective = resolveEffectivePlanGraph({
      graph,
      results: [
        { nodeId: "user", nodeLayerId: layerId(graph, "user"), status: "current", waitKind: "user_input", error: "Need input" },
        { nodeId: "approval", nodeLayerId: layerId(graph, "approval"), status: "current", waitKind: "approval", error: "Needs approval" },
        { nodeId: "external", nodeLayerId: layerId(graph, "external"), status: "current", waitKind: "external_dependency", error: "Waiting on external" },
        { nodeId: "degraded", nodeLayerId: layerId(graph, "degraded"), status: "rejected", error: "Sync failed", errorDetails: "degraded" },
      ],
    });

    expect(effective.waitingNodeIds).toEqual(["user", "approval", "external"]);
    expect(effective.waitingForUserNodeIds).toEqual(["user"]);
    expect(effective.waitingForApprovalNodeIds).toEqual(["approval"]);
    expect(effective.blockedNodeIds).toEqual([]);
    expect(effective.degradedNodeIds).toEqual(["degraded"]);
    expect(effective.failedNodeIds).toEqual([]);
  });

  it("exposes skipped separately while preserving completed aggregate", () => {
    const graph = createPlanGraphFromCompiledPlan({ taskId: "task_1", compiledPlan: makePlan(), now });
    graph.nodes.find((candidate) => candidate.id === "external")?.layers.push({
      id: "external_cancelled",
      nodeId: "external",
      type: "cancellation",
      createdAt: now,
      createdBy: "system",
      reason: "No longer needed",
    });

    const effective = resolveEffectivePlanGraph({ graph });

    expect(effective.cancelledNodeIds).toEqual(["external"]);
    expect(effective.skippedNodeIds).toEqual([]);
    expect(effective.completedNodeIds).toEqual([]);
  });

  it("lets a current result supersede an older failed attempt", () => {
    const graph = createPlanGraphFromCompiledPlan({ taskId: "task_1", compiledPlan: makePlan(), now });
    const nodeLayerId = layerId(graph, "user");
    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [{
        id: "attempt_user_1",
        taskId: "task_1",
        graphId: graph.id,
        nodeId: "user",
        nodeLayerId,
        executionContextSnapshotId: "ctx_user_1",
        idempotencyKey: "idem_user_1",
        attemptNumber: 1,
        status: "failed",
        error: { code: "NODE_FAILED", message: "Hermes request aborted" },
        startedAt: now,
        finishedAt: now,
      }],
      results: [
        {
          nodeId: "user",
          nodeLayerId,
          status: "rejected",
          error: "Hermes request aborted",
        },
        {
          nodeId: "user",
          nodeLayerId,
          status: "current",
          outputSummary: "Recovered externally",
        },
      ],
    });

    expect(effective.nodes.find((node) => node.id === "user")?.status).toBe("completed");
    expect(effective.completedNodeIds).toContain("user");
    expect(effective.failedNodeIds).not.toContain("user");
  });

  it("exposes condition branches when graph nodes use layered semantic metadata", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: {
        id: "compiled_condition_config",
        editablePlanId: "graph_condition_config",
        sourceVersion: 1,
        nodes: [
          {
            id: "choose",
            localId: "choose_source",
            type: "condition",
            title: "Choose source",
            config: {
              condition: "Pick a source",
              evaluationBy: "user",
              branches: [
                { label: "Public API", nextNodeId: "public" },
                { label: "Local mock", nextNodeId: "mock" },
              ],
              defaultNextNodeId: "public",
            },
            dependencies: [],
            dependents: ["public", "mock"],
          },
          { id: "public", localId: "public", type: "task", title: "Public", config: {}, dependencies: ["choose"], dependents: [] },
          { id: "mock", localId: "mock", type: "task", title: "Mock", config: {}, dependencies: ["choose"], dependents: [] },
        ],
        edges: [
          { id: "choose_public", from: "choose", to: "public", label: "Public API" },
          { id: "choose_mock", from: "choose", to: "mock", label: "Local mock" },
        ],
        entryNodeIds: ["choose"],
      },
      now,
    });

    const choose = resolveEffectivePlanGraph({ graph }).nodes.find((node) => node.id === "choose");

    expect(choose?.config).toMatchObject({
      condition: "Pick a source",
      evaluationBy: "user",
      branches: [
        { label: "Public API", nextNodeId: "public" },
        { label: "Local mock", nextNodeId: "mock" },
      ],
      defaultNextNodeId: "public",
    });
  });
});
