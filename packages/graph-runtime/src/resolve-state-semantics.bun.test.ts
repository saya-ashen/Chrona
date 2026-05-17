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
});
