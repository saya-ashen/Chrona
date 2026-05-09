import { describe, expect, it } from "bun:test";
import { detectPlanDrift } from "./replan-detector";
import type { EffectivePlanNode, EffectivePlanGraph } from "@chrona/contracts/ai";
import type { NodeExecutionResult } from "./node-executor";

function makeNode(overrides: Partial<EffectivePlanNode> & { id: string }): EffectivePlanNode {
  const { id, ...rest } = overrides;
  return {
    id,
    nodeId: id,
    activeLayerId: null,
    semanticKey: id,
    definition: {
      title: `Node ${id}`,
      objective: `Node ${id}`,
      semantics: { type: "task" },
    },
    invalidated: false,
    localId: id,
    type: "task",
    title: `Node ${id}`,
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

function makePlan(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    graphId: "g1",
    planId: "p1",
    basePlanId: "bp-1",
    resolvedAt: "2026-04-20T09:00:00.000Z",
    resolvedVersion: 1,
    nodes,
    edges: [],
    entryNodeIds: nodes.map((n) => n.id),
    terminalNodeIds: nodes.map((n) => n.id),
    readyNodeIds: [],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: nodes.map((n) => n.id),
  };
}

describe("detectPlanDrift", () => {
  it("no drift when node completes normally", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = { status: "done", summary: "ok", evidence: {} };
    const plan = makePlan([node]);
    const d = detectPlanDrift({ node, nodeResult: result, plan });
    expect(d.needsReplan).toBe(false);
  });

  it("replan_required result triggers replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "replan_required",
      reason: "Plan is outdated",
      evidence: {},
    };
    const plan = makePlan([node]);
    const d = detectPlanDrift({ node, nodeResult: result, plan });
    expect(d.needsReplan).toBe(true);
    if (d.needsReplan) {
      expect(d.risk).toBe("medium");
      expect(d.requiresUserConfirmation).toBe(true);
    }
  });

  it("failed node triggers replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "failed",
      error: "Execution error",
      evidence: {},
    };
    const plan = makePlan([node]);
    const d = detectPlanDrift({ node, nodeResult: result, plan });
    expect(d.needsReplan).toBe(true);
    if (d.needsReplan) {
      expect(d.risk).toBe("high");
    }
  });

  it("waiting_for_user does not trigger replan", () => {
    const node = makeNode({ id: "a" });
    const result: NodeExecutionResult = {
      status: "waiting_for_user",
      prompt: "What is your name?",
      reason: "Needs user input",
    };
    const plan = makePlan([node]);
    const d = detectPlanDrift({ node, nodeResult: result, plan });
    expect(d.needsReplan).toBe(false);
  });
});
