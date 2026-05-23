import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { runTaskNodeFeature } from "./node-ai-capabilities";
import type { AiRuntimeInvoker } from "./ai-runtime-invoker";

function makeTaskNode(): EffectivePlanNode {
  return {
    id: "first_entry",
    nodeId: "first_entry",
    activeLayerId: null,
    semanticKey: "first_entry",
    definition: {
      title: "Collect facts",
      objective: "Collect facts",
      semantics: { type: "task" },
    },
    invalidated: false,
    localId: "first_entry",
    type: "task",
    title: "Collect facts",
    config: {},
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: true,
    ready: true,
    reachable: true,
  };
}

function makePlan(node: EffectivePlanNode): EffectivePlanGraph {
  return {
    graphId: "graph_two_entry_provider_completion_gap",
    basePlanId: "graph_two_entry_provider_completion_gap",
    resolvedAt: "2026-05-22T00:00:00.000Z",
    resolvedVersion: 1,
    nodes: [node],
    edges: [],
    entryNodeIds: [node.id],
    terminalNodeIds: [node.id],
    readyNodeIds: [node.id],
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
    pendingNodeIds: [node.id],
  };
}

describe("runTaskNodeFeature", () => {
  beforeEach(async () => {
    await db.run.deleteMany();
    await db.task.deleteMany();
    await db.workspace.deleteMany();
  });

  afterAll(async () => {
    await db.run.deleteMany();
    await db.task.deleteMany();
    await db.workspace.deleteMany();
  });

  it("treats a completed provider snapshot with final text as a done node result", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI capabilities workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-1",
        workspaceId: workspace.id,
        title: "Node AI capabilities task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-1",
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    const node = makeTaskNode();
    const aiRuntimeInvoker = {
      invoke: async () => ({
        runId: "local-run-1",
        runtimeRunRef: "runtime-first-entry",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-1"],
        response: {
          provider: "hermes",
          runId: "runtime-first-entry",
          nativeRunId: "runtime-first-entry",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const result = await runTaskNodeFeature({
      taskId: "task-1",
      mainSession: {
        id: "main-session",
        taskId: "task-1",
        sessionKey: "chrona:task:task-1:plan-1",
      },
      node,
      plan: makePlan(node),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      featureSpec: {
        feature: "execute_task_node",
        instructions: "Execute the current task node.",
        inputText: "{}",
        terminalToolName: "chrona_task_complete",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "done",
      summary: "Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
      evidence: {
        sessionId: "main-session",
        runId: "local-run-1",
        runtimeName: "hermes",
        runtimeRunRef: "runtime-first-entry",
        conversationEntryIds: ["conversation-entry-1"],
      },
      output: {
        runtimeRunRef: "runtime-first-entry",
        runtimeName: "hermes",
        provider: "hermes",
        outputText: "Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
      },
    });
  });
});
