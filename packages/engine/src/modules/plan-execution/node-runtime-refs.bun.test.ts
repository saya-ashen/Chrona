import { describe, expect, it } from "bun:test";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { branchBindingForRef, buildNodeRuntimeInput, buildSemanticRefHistory } from "./node-runtime-refs";
import { buildNodeRuntimePrompt, NODE_RUNTIME_TERMINAL_TOOLS } from "./node-runtime-prompts";

function node(input: Partial<EffectivePlanNode> & Pick<EffectivePlanNode, "id" | "title" | "type">): EffectivePlanNode {
  return {
    nodeId: input.nodeId ?? input.id,
    activeLayerId: input.activeLayerId ?? `${input.id}-layer`,
    semanticKey: input.semanticKey ?? input.id,
    localId: input.localId ?? input.id,
    description: input.description ?? null,
    status: input.status ?? "pending",
    result: input.result ?? null,
    config: input.config ?? {},
    definition: input.definition ?? { title: input.title, type: input.type },
    dependencies: input.dependencies ?? [],
    dependents: input.dependents ?? [],
    ...input,
  } as EffectivePlanNode;
}

function graph(nodes: EffectivePlanNode[]): EffectivePlanGraph {
  return {
    graphId: "graph-real-123",
    planId: "plan-real-123",
    basePlanId: "task-real-123",
    resolvedVersion: 1,
    resolvedAt: "2026-05-16T00:00:00.000Z",
    nodes,
    edges: [],
    entryNodeIds: [nodes[0]?.id ?? ""],
    terminalNodeIds: [nodes.at(-1)?.id ?? ""],
    readyNodeIds: [],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    failedNodeIds: [],
    invalidatedNodeIds: [],
    pendingNodeIds: nodes.map((item) => item.id),
  } as unknown as EffectivePlanGraph;
}

describe("node runtime refs", () => {
  it("builds deterministic public refs without backend IDs in runtime input", () => {
    const condition = node({
      id: "condition-real-123",
      title: "Choose path",
      type: "condition",
      config: {
        condition: "Is approved?",
        evaluationBy: "ai",
        branches: [{ label: "yes", nextNodeId: "task-real-456" }],
      },
    });
    const plan = graph([
      condition,
      node({ id: "task-real-456", title: "Do work", type: "task" }),
    ]);

    const input = buildNodeRuntimeInput({
      plan,
      node: condition,
      allowedTerminalTools: [...NODE_RUNTIME_TERMINAL_TOOLS.condition],
    });
    const serialized = JSON.stringify(input);

    expect(input.taskRef).toBe("T20260516-01");
    expect(input.planRef).toBe("P20260516-01");
    expect(input.node.ref).toBe("N20260516-01");
    expect(input.branchOptions).toEqual([{ ref: "B20260516-01-A", key: "A", label: "yes" }]);
    expect(serialized).not.toContain("task-real-123");
    expect(serialized).not.toContain("graph-real-123");
    expect(serialized).not.toContain("condition-real-123");
    expect(serialized).not.toContain("task-real-456");
    expect(serialized).not.toContain("nextNodeId");
  });

  it("resolves only exact branch refs scoped to the current condition node", () => {
    const condition = node({
      id: "condition-real-123",
      title: "Choose path",
      type: "condition",
      config: {
        condition: "Is approved?",
        evaluationBy: "ai",
        branches: [{ label: "yes", nextNodeId: "task-real-456" }],
      },
    });
    const otherCondition = node({
      id: "condition-real-999",
      title: "Other path",
      type: "condition",
      config: {
        condition: "Other?",
        evaluationBy: "ai",
        branches: [{ label: "no", nextNodeId: "task-real-456" }],
      },
    });
    const plan = graph([
      condition,
      node({ id: "task-real-456", title: "Do work", type: "task" }),
      otherCondition,
    ]);

    const binding = branchBindingForRef({ plan, node: condition, branchRef: "B20260516-01-A" });
    expect(binding.nextNodeId).toBe("task-real-456");
    expect(() => branchBindingForRef({ plan, node: otherCondition, branchRef: "B20260516-01-A" })).toThrow("branchRef");
    expect(() => branchBindingForRef({ plan, node: condition, branchRef: "yes" })).toThrow("branchRef");
  });

  it("keeps backend bindings private while prompts forbid real ID generation", () => {
    const current = node({ id: "task-real-123", title: "Do work", type: "task" });
    const plan = graph([current]);
    const history = buildSemanticRefHistory(plan);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(history.nodeRefs[0]?.backendId).toBe("task-real-123");
    expect(JSON.stringify(runtime.runtimeInput)).not.toContain("task-real-123");
    expect(runtime.instructions).toContain("must never invent or emit backend IDs");
    expect(runtime.instructions).toContain("chrona_task_complete");
  });

  it("does not expose checkpoint submit as an AI terminal tool", () => {
    const current = node({ id: "checkpoint-real-123", title: "User approval", type: "checkpoint" });
    const plan = graph([current]);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(runtime.runtimeInput.allowedTerminalTools).toEqual(["chrona_node_block", "chrona_node_fail"]);
    expect(runtime.instructions).not.toContain("chrona_checkpoint_submit");
    expect(runtime.instructions).toContain("Checkpoint submission is performed by the user in the frontend");
  });
});
