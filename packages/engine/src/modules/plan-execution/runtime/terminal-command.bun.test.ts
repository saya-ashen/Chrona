import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { EngineError } from "../../../errors";
import { selectedBranchForTerminalCommand, summaryForTerminalCommand, validateTerminalCommand } from "./terminal-command";

function node(overrides: Partial<EffectivePlanNode> = {}): EffectivePlanNode {
  return {
    id: "node-1",
    localId: "node-1",
    nodeId: "node-1",
    layerId: "layer-1",
    type: "checkpoint",
    title: "Review output",
    description: null,
    config: {},
    definition: {},
    dependencies: [],
    dependents: [],
    reachable: true,
    status: "waiting_for_approval",
    result: null,
    ...overrides,
  } as EffectivePlanNode;
}

function plan(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    graphId: "graph-1",
    basePlanId: "plan-1",
    resolvedVersion: 1,
    id: "plan-1",
    nodes,
    edges: [],
    entryNodeIds: [nodes[0]?.id ?? "node-1"],
    terminalNodeIds: [nodes.at(-1)?.id ?? "node-1"],
    readyNodeIds: [],
    runningNodeIds: [],
    completedNodeIds: [],
    blockedNodeIds: [],
    failedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    skippedNodeIds: [],
    invalidatedNodeIds: [],
    status: "paused",
    graphStatus: "paused",
    resolvedAt: "2030-01-02T00:00:00.000Z",
  } as unknown as EffectivePlanGraph;
}

describe("terminal runtime command validation", () => {
  it("uses explicit summary before node result and fallback text", () => {
    expect(summaryForTerminalCommand({
      command: { type: "complete_manual_node", terminalKind: "checkpoint", summary: " Approved " },
      node: node({ result: { outputSummary: "Previous" } as EffectivePlanNode["result"] }),
    })).toBe("Approved");
  });

  it("requires checkpoint completion summary", () => {
    expect(() => validateTerminalCommand({
      plan: plan([node()]),
      node: node(),
      command: { type: "complete_manual_node", terminalKind: "checkpoint", decision: "completed" },
    })).toThrow(EngineError);
  });

  it("requires feedback or prompt when checkpoint needs input", () => {
    expect(() => validateTerminalCommand({
      plan: plan([node()]),
      node: node(),
      command: { type: "complete_manual_node", terminalKind: "checkpoint", decision: "needs_input" },
    })).toThrow("checkpoint needs_input requires feedback or prompt");
  });

  it("rejects terminal kind that does not match current node type", () => {
    expect(() => validateTerminalCommand({
      plan: plan([node({ type: "task" })]),
      node: node({ type: "task" }),
      command: { type: "complete_manual_node", terminalKind: "checkpoint", decision: "completed", summary: "done" },
    })).toThrow("checkpoint terminal tool cannot complete current task node");
  });

  it("resolves condition branch refs to the next node binding", () => {
    const condition = node({
      id: "condition-1",
      localId: "condition-1",
      nodeId: "condition-1",
      type: "condition",
      title: "Choose path",
      config: {
        condition: "Ready to ship?",
        evaluationBy: "ai",
        branches: [
          { label: "Ship", nextNodeId: "task-2" },
          { label: "Stop", nextNodeId: "task-3" },
        ],
      },
      dependents: ["task-2", "task-3"],
    });
    const task2 = node({ id: "task-2", localId: "task-2", nodeId: "task-2", type: "task", title: "Ship" });
    const task3 = node({ id: "task-3", localId: "task-3", nodeId: "task-3", type: "task", title: "Stop" });
    const branch = selectedBranchForTerminalCommand({
      plan: plan([condition, task2, task3]),
      node: condition,
      command: { type: "complete_manual_node", terminalKind: "condition", branchRef: "B20300102-01-A" },
    });

    expect(branch).toMatchObject({
      key: "A",
      ref: "B20300102-01-A",
      label: "Ship",
      nextNodeId: "task-2",
      source: "ai",
    });
  });
});
