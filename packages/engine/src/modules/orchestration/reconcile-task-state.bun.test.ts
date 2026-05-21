import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/graph-runtime";

import { reconcileTaskState } from "./reconcile-task-state";

function makeNode(input: Partial<EffectivePlanNode> & Pick<EffectivePlanNode, "id" | "status">): EffectivePlanNode {
  return {
    id: input.id,
    nodeId: input.id,
    activeLayerId: `${input.id}_layer`,
    semanticKey: input.id,
    definition: {
      title: input.title ?? input.id,
      objective: input.title ?? input.id,
      semantics: { type: input.type ?? "task" },
    },
    invalidated: false,
    localId: input.id,
    type: input.type ?? "task",
    title: input.title ?? input.id,
    config: {},
    dependencies: input.dependencies ?? [],
    dependents: input.dependents ?? [],
    status: input.status,
    attempts: input.attempts ?? 0,
    metadata: {},
    dependenciesSatisfied: input.dependenciesSatisfied ?? true,
    ready: input.ready ?? input.status === "ready",
    reachable: input.reachable ?? true,
    lastError: input.lastError,
    blockedReason: input.blockedReason,
    result: input.result,
  };
}

function makeGraph(nodes: EffectivePlanNode[], overrides: Partial<EffectivePlanGraph> = {}): EffectivePlanGraph {
  return {
    graphId: "graph_1",
    basePlanId: "graph_1",
    resolvedAt: "2026-05-17T00:00:00.000Z",
    resolvedVersion: 3,
    nodes,
    edges: [],
    entryNodeIds: nodes.slice(0, 1).map((node) => node.id),
    terminalNodeIds: nodes.slice(-1).map((node) => node.id),
    readyNodeIds: nodes.filter((node) => node.status === "ready").map((node) => node.id),
    blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
    waitingNodeIds: nodes.filter((node) => node.status === "waiting" || node.status.startsWith("waiting_")).map((node) => node.id),
    waitingForUserNodeIds: nodes.filter((node) => node.status === "waiting_for_user").map((node) => node.id),
    waitingForApprovalNodeIds: nodes.filter((node) => node.status === "waiting_for_approval").map((node) => node.id),
    degradedNodeIds: nodes.filter((node) => node.status === "degraded").map((node) => node.id),
    skippedNodeIds: nodes.filter((node) => node.status === "skipped").map((node) => node.id),
    cancelledNodeIds: nodes.filter((node) => node.status === "cancelled").map((node) => node.id),
    completedNodeIds: nodes.filter((node) => node.status === "completed" || node.status === "skipped").map((node) => node.id),
    runningNodeIds: nodes.filter((node) => node.status === "running").map((node) => node.id),
    invalidatedNodeIds: nodes.filter((node) => node.status === "invalidated").map((node) => node.id),
    failedNodeIds: nodes.filter((node) => node.status === "failed").map((node) => node.id),
    pendingNodeIds: nodes.filter((node) => node.status === "pending").map((node) => node.id),
    ...overrides,
  };
}

describe("reconcileTaskState", () => {
  it("derives one authoritative waiting task state with progress and primary action", () => {
    const graph = makeGraph([
      makeNode({ id: "setup", status: "completed" }),
      makeNode({ id: "answer", status: "waiting_for_user", blockedReason: "Need operator input" }),
      makeNode({ id: "finish", status: "pending", dependencies: ["answer"] }),
    ]);

    const result = reconcileTaskState({ taskId: "task_1", graph, now: new Date("2026-05-17T00:00:00.000Z") });

    expect(result.summary).toMatchObject({
      taskId: "task_1",
      executionState: "waiting_for_user",
      currentNodeId: "answer",
      graphVersion: 3,
      primaryAction: { type: "provide_input", enabled: true },
      progress: { completed: 1, total: 3, percent: 33 },
      waiting: { reason: "Need operator input", nodeId: "answer" },
    });
    expect(result.nodes.find((node) => node.id === "answer")).toMatchObject({
      status: "waiting_for_user",
      current: true,
      requiresAction: true,
    });
    expect(result.reconciliation).toMatchObject({
      executionState: "waiting_for_user",
      currentNodeId: "answer",
      issues: [],
    });
  });

  it("surfaces degraded state with retry action and contract-safe node status", () => {
    const graph = makeGraph([
      makeNode({ id: "sync", status: "degraded", lastError: "Runtime sync timed out" }),
      makeNode({ id: "finish", status: "pending", dependencies: ["sync"] }),
    ]);

    const result = reconcileTaskState({ taskId: "task_1", graph });

    expect(result.summary).toMatchObject({
      executionState: "degraded",
      currentNodeId: "sync",
      primaryAction: { type: "retry_sync", enabled: true },
      degraded: { reason: "Runtime sync timed out", retryAt: null },
    });
    expect(result.nodes.find((node) => node.id === "sync")).toMatchObject({
      status: "blocked",
      current: true,
      stateReason: "Runtime sync timed out",
    });
  });
});
