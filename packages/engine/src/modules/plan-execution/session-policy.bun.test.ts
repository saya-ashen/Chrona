import { describe, expect, it } from "bun:test";
import { decideNodeExecutionSession } from "./session-policy";
import type { EffectivePlanNode, EffectivePlanGraph } from "@chrona/contracts/ai";

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
    graphId: "graph-1",
    basePlanId: "bp-1",
    resolvedAt: "2026-04-20T09:00:00.000Z",
    resolvedVersion: 1,
    nodes,
    edges: [],
    entryNodeIds: nodes.map((n) => n.id),
    terminalNodeIds: nodes.map((n) => n.id),
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
    pendingNodeIds: nodes.map((n) => n.id),
  };
}

function decide(nodeOverrides: Partial<EffectivePlanNode> & { id: string }): ReturnType<typeof decideNodeExecutionSession> {
  const node = makeNode(nodeOverrides);
  const plan = makePlan([node]);
  return decideNodeExecutionSession({ node, plan, parentTaskId: "parent-1" });
}

describe("decideNodeExecutionSession", () => {
  it("short auto node -> main_session", () => {
    const d = decide({ id: "a", estimatedMinutes: 5 });
    expect(d.kind).toBe("main_session");
  });

  it("executor user -> manual completion path", () => {
    const d = decide({ id: "a", executor: "user" });
    expect(d.kind).toBe("manual_only");
  });

  it("mode manual -> manual_only", () => {
    const d = decide({ id: "a", mode: "manual" });
    expect(d.kind).toBe("manual_only");
  });

  it("type checkpoint with approve config -> wait_for_approval", () => {
    const d = decide({
      id: "a",
      type: "checkpoint",
      config: { checkpointType: "approve", prompt: "", required: true },
    });
    expect(d.kind).toBe("wait_for_approval");
  });

  it("executor user -> manual_only", () => {
    const d = decide({ id: "a", executor: "user", mode: "manual" });
    expect(d.kind).toBe("manual_only");
  });

  it("estimatedMinutes >= 20 -> main_session", () => {
    const d = decide({ id: "a", estimatedMinutes: 20 });
    expect(d.kind).toBe("main_session");
  });

  it("metadata sessionStrategy per_subtask -> main_session", () => {
    const d = decide({ id: "a", metadata: { sessionStrategy: "per_subtask" }, config: { sessionStrategy: "per_subtask" } as unknown as EffectivePlanNode["config"] });
    expect(d.kind).toBe("main_session");
  });

  it("type task -> main_session when short (estimatedMinutes=0)", () => {
    const d = decide({ id: "a", type: "task", estimatedMinutes: 0 });
    expect(d.kind).toBe("main_session");
  });

  it("type task -> main_session when long enough", () => {
    const d = decide({ id: "a", type: "task", estimatedMinutes: 20 });
    expect(d.kind).toBe("main_session");
  });

  it("node with linkedTaskId -> main_session", () => {
    const d = decide({ id: "a", linkedTaskId: "child-1" });
    expect(d.kind).toBe("main_session");
  });

  it("already done node -> main_session", () => {
    const d = decide({ id: "a", status: "completed" });
    expect(d.kind).toBe("main_session");
  });

  it("already in_progress node -> main_session", () => {
    const d = decide({ id: "a", status: "running" });
    expect(d.kind).toBe("main_session");
  });

  it("multi-step looking node -> main_session", () => {
    const d = decide({ id: "a", title: "Implement the new authentication system" });
    expect(d.kind).toBe("main_session");
  });
});
