import { describe, expect, it } from "bun:test";
import { detectPlanDrift } from "./replan-detector";
import type { EffectivePlanNode, EffectivePlanGraph } from "@chrona/contracts/ai";
import type { NodeExecutionResult } from "./node-executor";

function makeNode(overrides: Partial<EffectivePlanNode> & { id: string }): EffectivePlanNode {
  const { id, ...rest } = overrides;
  return {
    id,
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
    ...rest,
  };
}

function makePlan(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    planId: "p1",
    basePlanId: "bp-1",
    resolvedVersion: 1,
    nodes,
    edges: [],
    entryNodeIds: nodes.map((n) => n.id),
    terminalNodeIds: nodes.map((n) => n.id),
    readyNodeIds: [],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
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
