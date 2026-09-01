import { describe, expect, it } from "bun:test";
import { decideNodeExecutionSession } from "../session-policy";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";

function node(overrides: Partial<EffectivePlanNode> & { id: string }): EffectivePlanNode {
  const { id, ...rest } = overrides;
  return {
    id,
    nodeId: id,
    activeLayerId: null,
    semanticKey: id,
    definition: {
      title: rest.title ?? id,
      objective: rest.title ?? id,
      semantics: { type: "task" },
    },
    invalidated: false,
    localId: id,
    type: "task",
    title: rest.title ?? id,
    config: {} as EffectivePlanNode["config"],
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: false,
    ready: false,
    reachable: true,
    ...rest,
  };
}

function graph(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    graphId: "graph-1",
    basePlanId: "plan-1",
    resolvedAt: "2026-05-28T10:00:00.000Z",
    resolvedVersion: 1,
    nodes,
    edges: [],
    entryNodeIds: nodes.map((candidate) => candidate.id),
    terminalNodeIds: nodes.map((candidate) => candidate.id),
    readyNodeIds: [],
    blockedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    degradedNodeIds: [],
    skippedNodeIds: [],
    cancelledNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: nodes.map((candidate) => candidate.id),
  };
}

function decide(overrides: Partial<EffectivePlanNode> & { id: string }) {
  const current = node(overrides);
  return decideNodeExecutionSession({ node: current, plan: graph([current]), parentTaskId: "task-1" });
}

describe("execution state invariants", () => {
  it("manual executor nodes never auto-enter approval sessions", () => {
    expect(decide({ id: "manual", executor: "user" })).toMatchObject({ kind: "manual_only" });
  });

  it("checkpoint approve nodes wait for approval independent of estimates", () => {
    expect(decide({
      id: "approve",
      type: "checkpoint",
      estimatedMinutes: 60,
      config: { checkpointType: "approve", prompt: "Ship?", required: true },
    })).toMatchObject({ kind: "wait_for_approval" });
  });

  it("linked subtasks keep main session ownership", () => {
    expect(decide({ id: "child", linkedTaskId: "task-child" })).toMatchObject({ kind: "main_session" });
  });
});
