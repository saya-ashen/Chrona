import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/graph-runtime";

import { reconcileTaskState } from "./reconcile-task-state";

function node(input: { id: string; status: EffectivePlanNode["status"]; dependencies?: string[] }): EffectivePlanNode {
  return {
    id: input.id,
    nodeId: input.id,
    activeLayerId: `${input.id}_layer`,
    semanticKey: input.id,
    definition: { title: input.id, objective: input.id, semantics: { type: "task" } },
    invalidated: false,
    localId: input.id,
    type: "task",
    title: input.id,
    config: {},
    dependencies: input.dependencies ?? [],
    dependents: [],
    status: input.status,
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: false,
    ready: input.status === "ready",
    reachable: true,
  };
}

describe("reconcileTaskState impossible state detection", () => {
  it("returns deterministic repair action when a terminal node completed before a reachable prerequisite", () => {
    const nodes = [node({ id: "build", status: "pending" }), node({ id: "ship", status: "completed", dependencies: ["build"] })];
    const graph: EffectivePlanGraph = {
      graphId: "graph_1",
      planId: "graph_1",
      basePlanId: "graph_1",
      resolvedAt: "2026-05-17T00:00:00.000Z",
      resolvedVersion: 1,
      nodes,
      edges: [],
      entryNodeIds: ["build"],
      terminalNodeIds: ["ship"],
      readyNodeIds: [],
      blockedNodeIds: [],
      waitingNodeIds: [],
      waitingForUserNodeIds: [],
      waitingForApprovalNodeIds: [],
      degradedNodeIds: [],
      skippedNodeIds: [],
      cancelledNodeIds: [],
      completedNodeIds: ["ship"],
      runningNodeIds: [],
      invalidatedNodeIds: [],
      failedNodeIds: [],
      pendingNodeIds: ["build"],
    };

    const result = reconcileTaskState({ taskId: "task_1", graph });

    expect(result.reconciliation.issues).toEqual([
      {
        code: "terminal_completed_with_pending_prerequisite",
        severity: "error",
        message: "Terminal node completed while a reachable prerequisite is still incomplete.",
        nodeId: null,
      },
    ]);
    expect(result.reconciliation.repairActions).toEqual([
      { type: "repair_inconsistency", enabled: true, label: "Repair state" },
    ]);
    expect(result.summary.recoveryActions).toEqual(result.reconciliation.repairActions);
  });
});
