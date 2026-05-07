import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { ConditionNodeExecutor } from "./condition-executor";

function makeConditionNode(
  overrides: Partial<EffectivePlanNode> & { id: string },
): EffectivePlanNode {
  const { id, ...rest } = overrides;
  return {
    id,
    localId: "check_inventory",
    type: "condition",
    title: "检查库存",
    config: {
      condition: "库存是否充足",
      evaluationBy: "user",
      branches: [
        { label: "是", nextNodeId: "ship_order" },
        { label: "否", nextNodeId: "restock" },
      ],
      defaultNextNodeId: "restock",
    },
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: true,
    ready: true,
    reachable: true,
    ...rest,
  };
}

function makePlan(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    planId: "plan-1",
    basePlanId: "base-1",
    resolvedVersion: 1,
    nodes,
    edges: [
      { id: "edge-yes", from: "condition-1", to: "compiled-yes", label: "是", active: true },
      { id: "edge-no", from: "condition-1", to: "compiled-no", label: "否", active: true },
    ],
    entryNodeIds: ["condition-1"],
    terminalNodeIds: ["compiled-yes", "compiled-no"],
    readyNodeIds: ["condition-1"],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: ["compiled-yes", "compiled-no"],
  };
}

describe("ConditionNodeExecutor", () => {
  it("waits for explicit user branch selection", async () => {
    const executor = new ConditionNodeExecutor();
    const condition = makeConditionNode({ id: "condition-1" });
    const plan = makePlan([
      condition,
      { ...makeConditionNode({ id: "compiled-yes" }), type: "task", localId: "ship_order", title: "发货", config: {} },
      { ...makeConditionNode({ id: "compiled-no" }), type: "task", localId: "restock", title: "补货", config: {} },
    ]);

    const result = await executor.execute({
      taskId: "task-1",
      planId: "plan-1",
      mainSession: { id: "session-1", taskId: "task-1", sessionKey: "session-key" },
      node: condition,
      plan,
      trigger: "manual",
      runtimeName: "openclaw",
    });

    expect(result.status).toBe("waiting_for_user");
  });

  it("maps selected user branch to compiled target node id", async () => {
    const executor = new ConditionNodeExecutor();
    const condition = makeConditionNode({ id: "condition-1" });
    const yesNode: EffectivePlanNode = {
      id: "compiled-yes",
      localId: "ship_order",
      type: "task",
      title: "发货",
      config: {},
      dependencies: ["condition-1"],
      dependents: [],
      status: "pending",
      attempts: 0,
      metadata: {},
      dependenciesSatisfied: false,
      ready: false,
      reachable: true,
    };
    const noNode: EffectivePlanNode = {
      id: "compiled-no",
      localId: "restock",
      type: "task",
      title: "补货",
      config: {},
      dependencies: ["condition-1"],
      dependents: [],
      status: "pending",
      attempts: 0,
      metadata: {},
      dependenciesSatisfied: false,
      ready: false,
      reachable: true,
    };

    const result = await executor.execute({
      taskId: "task-1",
      planId: "plan-1",
      mainSession: { id: "session-1", taskId: "task-1", sessionKey: "session-key" },
      node: condition,
      plan: makePlan([condition, yesNode, noNode]),
      trigger: "manual",
      runtimeName: "openclaw",
      userInput: "是",
    });

    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.selectedBranch?.label).toBe("是");
      expect(result.selectedBranch?.nextNodeId).toBe("compiled-yes");
    }
  });
});
