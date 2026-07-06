import { describe, expect, it } from "bun:test";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
} from "@chrona/contracts/ai";
import {
  branchBindingForRef,
  buildNodeRuntimeInput,
  buildSemanticRefHistory,
} from "./runtime/node-runtime-refs";
import { buildNodeRuntimePrompt } from "./runtime/node-runtime-prompts";

function node(
  input: Partial<EffectivePlanNode> &
    Pick<EffectivePlanNode, "id" | "title" | "type">,
): EffectivePlanNode {
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
    });
    const serialized = JSON.stringify(input);

    expect(input.node.ref).toBe("N20260516-01");
    expect(input.context.relevantPreviousResults).toEqual([]);
    expect(input.branchOptions).toEqual([
      { ref: "B20260516-01-A", key: "A", label: "yes" },
    ]);
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
      },
    ]);
    expect(input.context.globalSummary).toBe(
      "Prepare workspace: Workspace is ready.",
    );
    expect(input.branchOptions).toBeUndefined();
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

    const binding = branchBindingForRef({
      plan,
      node: condition,
      branchRef: "B20260516-01-A",
    });
    expect(binding.nextNodeId).toBe("task-real-456");
    expect(() =>
      branchBindingForRef({
        plan,
        node: otherCondition,
        branchRef: "B20260516-01-A",
      }),
    ).toThrow("branchRef");
    expect(() =>
      branchBindingForRef({ plan, node: condition, branchRef: "yes" }),
    ).toThrow("branchRef");
  });

  it("keeps backend bindings private while prompts forbid real ID generation", () => {
    const current = node({
      id: "task-real-123",
      title: "Do work",
      type: "task",
    });
    const plan = graph([current]);
    const history = buildSemanticRefHistory(plan);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(history.nodeRefs[0]?.backendId).toBe("task-real-123");
    expect(JSON.stringify(runtime.runtimeInput)).not.toContain("task-real-123");
    expect(runtime.instructions).not.toContain(
      "Chrona tools available for the current node",
    );
    expect(runtime.instructions).not.toContain("current-node available tools");
    expect(runtime.instructions).not.toContain("available tools");
    expect(runtime.instructions).not.toContain("terminal MCP tool");
    expect(runtime.instructions).not.toContain("Allowed Chrona terminal tools");
    expect(runtime.instructions).toContain(
      "Do not call chrona_node_read or chrona_execution_read by default",
    );
    expect(runtime.instructions).toContain("Call chrona_node_read only when");
    expect(runtime.instructions).toContain(
      "Call chrona_execution_read only after",
    );
  });

  it("prompts task nodes to patch shared json-render specs", () => {
    const current = node({
      id: "task-real-789",
      title: "Render result",
      type: "task",
      description: "Create a visible result.",
    });
    const plan = graph([current]);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(runtime.instructions).toContain("CATALOG_UI_SPEC");
    expect(runtime.instructions).toContain("RFC 6902 SpecStream patches");
    expect(runtime.instructions).toContain("Current Node Context JSON.context.planOutput");
    expect(runtime.instructions).toContain("context.planOutput.hasSpec is false");
    expect(runtime.instructions).toContain("root MUST equal one element id");
    expect(runtime.instructions).not.toContain("SCHEMA LAB OVERRIDE:");
    expect(runtime.instructions).not.toContain("Submit the complete Spec as the chrona_plan_output tool argument");
    expect(runtime.runtimeInput.context.planOutput).toEqual({
      revision: 0,
      hasSpec: false,
      root: null,
      rootChildren: [],
      elementIds: [],
      updatedAt: null,
    });
    expect(runtime.instructions).toContain("current working directory as the workspace root");
    expect(runtime.instructions).toContain(".chrona/outputs/N20260516-01/");
    expect(runtime.instructions).toContain("FileView or FileRef");
    expect(runtime.instructions).toContain("Do not use absolute paths, .. segments");
  });
  it("passes existing accumulated plan output into task prompts", () => {
    const current = node({
      id: "task-real-790",
      title: "Append result",
      type: "task",
      description: "Append to visible result.",
    });
    const plan = graph([current]);
    const planOutput = {
      revision: 1,
      spec: {
        root: "existingRoot",
        elements: {
          existingRoot: { type: "Stack", props: { gap: "sm" }, children: ["firstSection"] },
          firstSection: { type: "Markdown", props: { content: "First section" }, children: [] },
        },
      },
      updatedAt: "2026-05-16T00:01:00.000Z",
      updatedByNodeId: "first-task",
      history: [
        {
          id: "plan_output_1",
          nodeId: "first-task",
          summary: "First section",
          patches: [{ op: "add" as const, path: "/root", value: "existingRoot" }],
          createdAt: "2026-05-16T00:01:00.000Z",
        },
      ],
    };

    const runtime = buildNodeRuntimePrompt({ plan, node: current, planOutput });

    expect(runtime.runtimeInput.context.planOutput).toEqual({
      revision: 1,
      hasSpec: true,
      root: "existingRoot",
      rootChildren: ["firstSection"],
      elementIds: ["existingRoot", "firstSection"],
      updatedAt: "2026-05-16T00:01:00.000Z",
      lastSummary: "First section",
    });
    expect(runtime.instructions).toContain('"revision": 1');
    expect(runtime.instructions).toContain('"root": "existingRoot"');
    expect(runtime.instructions).toContain('"rootChildren": [');
    expect(runtime.instructions).toContain('"lastSummary": "First section"');
    expect(runtime.instructions).not.toContain('"spec":');
    expect(runtime.instructions).not.toContain('"revision": 0');
    expect(runtime.instructions).not.toContain('"history":');
    expect(runtime.instructions).not.toContain('"patches":');
  });
  it("spells out file-backed table props for json-render outputs", () => {
    const current = node({
      id: "task-real-456",
      title: "Render table",
      type: "task",
    });
    const plan = graph([current]);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(runtime.instructions).toContain("File-backed data table");
    expect(runtime.instructions).toContain("do not inline rows");
    expect(runtime.instructions).toContain("pageSize");
    expect(runtime.instructions).toContain("RFC 6902");
    expect(runtime.instructions).not.toContain("Spec shape for chrona_plan_output tool arguments: { root: string, elements: Array<");
  });

  it("does not expose checkpoint submit as an AI terminal tool", () => {
    const current = node({
      id: "checkpoint-real-123",
      title: "User approval",
      type: "checkpoint",
    });
    const plan = graph([current]);
    const runtime = buildNodeRuntimePrompt({ plan, node: current });

    expect(runtime.instructions).not.toContain("chrona_checkpoint_submit");
    expect(runtime.instructions).toContain(
      "Checkpoint submission is performed by the user in the frontend",
    );
  });
});
