import { describe, expect, it } from "bun:test";
import type {
  PublicEffectivePlanGraph,
  PublicEffectivePlanNode,
} from "@chrona/contracts/ai";
import { readAiExecutionView, readAiNodeView } from "./ai-execution-view";

function node(
  input: Pick<PublicEffectivePlanNode, "id" | "title" | "type"> &
    Partial<PublicEffectivePlanNode>,
): PublicEffectivePlanNode {
  return {
    ...input,
    id: input.id,
    nodeId: input.nodeId ?? input.id,
    semanticKey: input.semanticKey ?? input.id,
    invalidated: input.invalidated ?? false,
    localId: input.localId ?? input.id,
    type: input.type,
    title: input.title,
    config: input.config ?? {},
    dependencies: input.dependencies ?? [],
    dependents: input.dependents ?? [],
    status: input.status ?? "pending",
    attempts: input.attempts ?? 0,
    dependenciesSatisfied: input.dependenciesSatisfied ?? true,
    ready: input.ready ?? false,
    reachable: input.reachable ?? true,
  } as PublicEffectivePlanNode;
}

function graph(nodes: PublicEffectivePlanNode[]): PublicEffectivePlanGraph {
  return {
    graphId: "backend-graph-id",
    basePlanId: "backend-plan-id",
    resolvedAt: "2026-08-19T00:00:00.000Z",
    resolvedVersion: 1,
    nodes,
    edges: [],
    entryNodeIds: [nodes[0]!.id],
    terminalNodeIds: [nodes.at(-1)!.id],
    readyNodeIds: [],
    blockedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    degradedNodeIds: [],
    skippedNodeIds: [],
    cancelledNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [nodes[0]!.id],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: nodes.slice(1).map((item) => item.id),
  };
}

describe("readAiExecutionView", () => {
  it("reads public plan nodes without internal definition fields", () => {
    const nodes = [
      node({
        id: "backend-task-node",
        title: "Collect data",
        type: "task",
        status: "running",
        description: "Collect the verified dataset.",
        config: {
          expectedOutput: "One dataset",
          completionCriteria: "All rows verified",
        },
      }),
      node({
        id: "backend-condition-node",
        title: "Choose path",
        description: "Choose the supported branch.",
        type: "condition",
        config: {
          condition: "Is the dataset complete?",
          evaluationBy: "ai",
          branches: [{ label: "Yes", nextNodeId: "backend-checkpoint-node" }],
        },
      }),
      node({
        id: "backend-checkpoint-node",
        title: "Review result",
        type: "checkpoint",
        config: {
          checkpointType: "approval",
          prompt: "Approve result",
          required: true,
        },
      }),
      node({
        id: "backend-wait-node",
        title: "Wait for source",
        type: "wait",
        config: { waitFor: "Source available" },
      }),
    ];
    const value = {
      task: {
        title: "Research task",
        status: "Running",
        priority: "Medium",
        savedPlan: {
          status: "accepted",
          revision: 2,
          summary: "Verified plan",
          effectivePlan: graph(nodes),
        },
      },
    };

    const result = readAiExecutionView(value) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      execution: {
        currentNode: {
          ref: "N20260819-01",
          objective: "Collect the verified dataset.",
          expectedOutput: "One dataset",
          completionCriteria: "All rows verified",
        },
      },
      nodes: [
        { ref: "N20260819-01", objective: "Collect the verified dataset." },
        {
          ref: "N20260819-02",
          objective: "Choose the supported branch.",
          condition: "Is the dataset complete?",
          branchOptions: [{ ref: "B20260819-02-A", key: "A", label: "Yes" }],
        },
        { ref: "N20260819-03", objective: "Review result" },
        { ref: "N20260819-04", objective: "Wait for source" },
      ],
    });
    expect(serialized).not.toContain("backend-");
    expect(serialized).not.toContain("definition");
  });

  it("reads bounded semantic result content through an AI-visible node ref", () => {
    const completed = node({
      id: "backend-menu-node",
      title: "Prepare menu",
      type: "task",
      status: "completed",
      result: {
        outputSummary: "Menu prepared",
        findings: [
          {
            key: "dinner.menu",
            title: "Dinner menu",
            content: "Chickpea stew for six with four cans of chickpeas.",
            importance: "primary",
          },
        ],
      },
    });
    const value = {
      task: {
        title: "Dinner task",
        status: "Running",
        priority: "Medium",
        savedPlan: {
          status: "accepted",
          revision: 1,
          summary: "Dinner plan",
          effectivePlan: graph([completed]),
        },
      },
    };

    const read = readAiNodeView(value, { ref: "N20260819-01" }) as {
      result: { content: string; nextOffset: number | null };
    };
    expect(JSON.parse(read.result.content)).toMatchObject({
      summary: "Menu prepared",
      findings: [
        {
          key: "dinner.menu",
          content: "Chickpea stew for six with four cans of chickpeas.",
        },
      ],
    });
    expect(read.result.nextOffset).toBeNull();
    expect(JSON.stringify(read)).not.toContain("backend-menu-node");
  });

  it("paginates node result content and rejects backend node identities", () => {
    const completed = node({
      id: "backend-long-node",
      title: "Long result",
      type: "task",
      status: "completed",
      result: {
        outputSummary: "Long result ready",
        findings: [{ key: "long", content: "x".repeat(200) }],
      },
    });
    const value = {
      task: {
        savedPlan: {
          status: "accepted",
          revision: 1,
          effectivePlan: graph([completed]),
        },
      },
    };

    const first = readAiNodeView(value, {
      ref: "N20260819-01",
      maxChars: 80,
    }) as { result: { content: string; nextOffset: number | null } };
    expect(first.result.content).toHaveLength(80);
    expect(first.result.nextOffset).toBe(80);
    expect(() => readAiNodeView(value, { ref: "backend-long-node" })).toThrow(
      "Node ref",
    );
  });
});
