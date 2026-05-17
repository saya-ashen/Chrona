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
  it("builds slim deterministic public refs without backend IDs in runtime input", () => {
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
      currentNodeResultActionNames: [...NODE_RUNTIME_TERMINAL_TOOLS.condition],
    });
    const serialized = JSON.stringify(input);

    expect(input.node.ref).toBe("N20260516-01");
    expect(input.context.relevantPreviousResults).toEqual([]);
    expect(input.branchOptions).toEqual([{ ref: "B20260516-01-A", key: "A", label: "yes" }]);
    expect(input.currentNodeResultActions.actionNames).toEqual(["chrona_condition_select", "chrona_node_block", "chrona_node_fail"]);
    expect(input.currentNodeResultActions.conditionSelectSchema).toEqual({ branchRef: "branchOptions[].ref", summary: "string" });
    expect(serialized).not.toContain("task-real-123");
    expect(serialized).not.toContain("graph-real-123");
    expect(serialized).not.toContain("condition-real-123");
    expect(serialized).not.toContain("task-real-456");
    expect(serialized).not.toContain("nextNodeId");
    expect(serialized).not.toContain("taskRef");
    expect(serialized).not.toContain("planRef");
    expect(serialized).not.toContain("allowedTerminalTools");
    expect(serialized).not.toContain("currentNodeAvailableTools");
    expect(serialized).not.toContain("currentNodeAvailableToolNames");
    expect(serialized).not.toContain("terminalActionToolNames");
    expect(serialized).not.toContain("terminalActions");
    expect(serialized).not.toContain("availableToolNames");
    expect(serialized).not.toContain("availableTools");
    expect(serialized).not.toContain('"terminal"');
    expect(serialized).not.toContain('"tools"');
    expect(serialized).not.toContain('"names"');
    expect(serialized).not.toContain("previousResults");
    expect(serialized).not.toContain("status");
    expect(serialized).not.toContain("config");
  });

  it("includes only direct dependency results plus compact global summary", () => {
    const dependency = node({
      id: "dependency-real-123",
      title: "Confirm requirements",
      type: "task",
      status: "completed",
      result: {
        nodeId: "dependency-real-123",
        status: "completed",
        outputSummary: "Weather script requirements confirmed.",
        outputs: [{ kind: "json", value: { location: "Beijing" } }],
      } as unknown as EffectivePlanNode["result"],
    });
    const unrelated = node({
      id: "unrelated-real-123",
      title: "Prepare workspace",
      type: "task",
      status: "completed",
      result: {
        nodeId: "unrelated-real-123",
        status: "completed",
        outputSummary: "Workspace is ready.",
      } as unknown as EffectivePlanNode["result"],
    });
    const current = node({
      id: "task-real-456",
      title: "Write script spec",
      type: "task",
      dependencies: [dependency.id],
      config: {
        expectedOutput: "A weather script spec.",
        completionCriteria: "Inputs, outputs, and dependencies are clear.",
      },
    });
    const input = buildNodeRuntimeInput({
      plan: graph([dependency, unrelated, current]),
      node: current,
      currentNodeResultActionNames: [...NODE_RUNTIME_TERMINAL_TOOLS.task],
    });

    expect(input.node).toMatchObject({
      ref: "N20260516-03",
      type: "task",
      title: "Write script spec",
      expectedOutput: "A weather script spec.",
      completionCriteria: "Inputs, outputs, and dependencies are clear.",
    });
    expect(input.context.relevantPreviousResults).toEqual([
      {
        nodeRef: "N20260516-01",
        title: "Confirm requirements",
        summary: "Weather script requirements confirmed.",
        outputs: [{ kind: "json", value: { location: "Beijing" } }],
      },
    ]);
    expect(input.context.globalSummary).toBe("Prepare workspace: Workspace is ready.");
    expect(input.branchOptions).toBeUndefined();
    expect(input.currentNodeResultActions.completeSchema).toEqual({ summary: "string", outputs: [{ kind: "json", value: {} }] });
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
    expect(runtime.instructions).toContain("Chrona node result submission actions");
    expect(runtime.instructions).toContain("only report the final outcome of this Chrona node");
    expect(runtime.instructions).toContain("not execution capabilities");
    expect(runtime.instructions).toContain("not filesystem access");
    expect(runtime.instructions).toContain("not shell access");
    expect(runtime.instructions).toContain("not code execution");
    expect(runtime.instructions).toContain("not the provider's full capability inventory");
    expect(runtime.instructions).toContain("Do not infer runtime capabilities from this list");
    expect(runtime.instructions).toContain("call chrona_node_block instead of chrona_task_complete");
    expect(runtime.instructions).toContain("After a Chrona result submission action succeeds");
    expect(runtime.instructions).not.toContain("Chrona tools available for the current node");
    expect(runtime.instructions).not.toContain("current-node available tools");
    expect(runtime.instructions).not.toContain("available tools");
    expect(runtime.instructions).not.toContain("terminal MCP tool");
    expect(runtime.instructions).not.toContain("Allowed Chrona terminal tools");
    expect(runtime.instructions).toContain("Do not call chrona_node_read or chrona_execution_read by default");
    expect(runtime.instructions).toContain("Call chrona_node_read only when");
    expect(runtime.instructions).toContain("Call chrona_execution_read only after");
  });

  it("does not expose checkpoint submit as an AI terminal tool", () => {
    const current = node({ id: "checkpoint-real-123", title: "User approval", type: "checkpoint" });
    const plan = graph([current]);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(runtime.runtimeInput.currentNodeResultActions.actionNames).toEqual(["chrona_node_block", "chrona_node_fail"]);
    expect(runtime.instructions).not.toContain("chrona_checkpoint_submit");
    expect(runtime.instructions).toContain("Checkpoint submission is performed by the user in the frontend");
  });
});
