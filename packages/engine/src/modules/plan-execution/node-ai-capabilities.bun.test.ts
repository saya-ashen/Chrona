import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { EffectivePlanGraph, EffectivePlanNode, NodeAttempt } from "@chrona/contracts/ai";
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

function makeConditionNode(): EffectivePlanNode {
  return {
    ...makeTaskNode(),
    id: "condition_node",
    nodeId: "condition_node",
    semanticKey: "condition_node",
    localId: "condition_node",
    type: "condition",
    title: "Choose delivery path",
    definition: {
      title: "Choose delivery path",
      objective: "Choose delivery path",
      semantics: { type: "condition" },
    },
    config: {
      condition: "Which delivery path should continue?",
      evaluationBy: "ai",
      branches: [
        { label: "Passed", nextNodeId: "passed_node" },
        { label: "Needs fixes", nextNodeId: "fix_node" },
      ],
    },
  };
}

function makeDownstreamNode(input: { id: string; localId: string; title: string }): EffectivePlanNode {
  return {
    ...makeTaskNode(),
    id: input.id,
    nodeId: input.id,
    semanticKey: input.id,
    localId: input.localId,
    title: input.title,
    definition: {
      title: input.title,
      objective: input.title,
      semantics: { type: "task" },
    },
    dependencies: ["condition_node"],
    dependenciesSatisfied: false,
    ready: false,
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

function makeConditionPlan(input: {
  condition: EffectivePlanNode;
  passed: EffectivePlanNode;
  fixes: EffectivePlanNode;
}): EffectivePlanGraph {
  return {
    ...makePlan(input.condition),
    nodes: [input.condition, input.passed, input.fixes],
    edges: [
      { id: "edge-passed", from: input.condition.id, to: input.passed.id, label: "Passed", active: true },
      { id: "edge-fixes", from: input.condition.id, to: input.fixes.id, label: "Needs fixes", active: true },
    ],
    terminalNodeIds: [input.passed.id, input.fixes.id],
    pendingNodeIds: [input.condition.id, input.passed.id, input.fixes.id],
  };
}

function makeAttempt(input: { taskId: string; graphId: string; nodeId: string }): NodeAttempt {
  return {
    id: `attempt-${input.nodeId}`,
    taskId: input.taskId,
    graphId: input.graphId,
    nodeId: input.nodeId,
    nodeLayerId: input.nodeId,
    executionContextSnapshotId: `snapshot-${input.nodeId}`,
    status: "running",
    idempotencyKey: `${input.graphId}:${input.nodeId}:1`,
    attemptNumber: 1,
    startedAt: "2026-05-22T00:00:00.000Z",
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

  it("fails a completed provider snapshot that did not use a Chrona terminal tool", async () => {
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

    const plan = makePlan(node);
    const result = await runTaskNodeFeature({
      taskId: "task-1",
      mainSession: {
        id: "main-session",
        taskId: "task-1",
        sessionKey: "chrona:task:task-1:plan-1",
      },
      node,
      plan,
      attempt: makeAttempt({ taskId: "task-1", graphId: plan.graphId, nodeId: node.id }),
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
      status: "failed",
      error: "Runtime run runtime-first-entry completed without a Chrona terminal result action for node first_entry: Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
      evidence: {
        sessionId: "main-session",
        runId: "local-run-1",
        runtimeName: "hermes",
        runtimeRunRef: "runtime-first-entry",
        conversationEntryIds: ["conversation-entry-1"],
      },
    });

    const run = await db.run.findUniqueOrThrow({ where: { id: "local-run-1" } });
    expect(run).toMatchObject({
      status: "Failed",
      errorSummary: "Runtime run runtime-first-entry completed without a Chrona terminal result action for node first_entry: Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
    });
  });


  it("accepts a completed task snapshot only when chrona_task_complete was used", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI task terminal tool workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-terminal-tool",
        workspaceId: workspace.id,
        title: "Node AI task terminal tool task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-task-terminal-tool",
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
        runId: "local-run-task-terminal-tool",
        runtimeRunRef: "runtime-task-terminal-tool",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-task-terminal-tool"],
        response: {
          provider: "hermes",
          runId: "runtime-task-terminal-tool",
          nativeRunId: "runtime-task-terminal-tool",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Task complete",
          structuredPayload: { outputs: [{ kind: "text", content: "Task complete" }] },
          raw: { terminalToolName: "chrona_task_complete" },
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const plan = makePlan(node);
    const result = await runTaskNodeFeature({
      taskId: task.id,
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-terminal-tool:plan-1",
      },
      node,
      plan,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: node.id }),
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
      summary: "Task complete",
      output: [{ kind: "text", content: "Task complete" }],
    });
  });
  it("fails provider branchRef structured payload without condition terminal tool", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI condition workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-condition-branch-ref",
        workspaceId: workspace.id,
        title: "Node AI condition task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-condition",
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    const condition = makeConditionNode();
    const passed = makeDownstreamNode({ id: "passed_node", localId: "passed_node", title: "Passed" });
    const fixes = makeDownstreamNode({ id: "fix_node", localId: "fix_node", title: "Needs fixes" });
    const plan = makeConditionPlan({ condition, passed, fixes });
    const aiRuntimeInvoker = {
      invoke: async () => ({
        runId: "local-run-condition",
        runtimeRunRef: "runtime-condition",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-condition"],
        response: {
          provider: "hermes",
          runId: "runtime-condition",
          nativeRunId: "runtime-condition",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "",
          structuredPayload: {
            branchRef: "B20260522-01-B",
            summary: "Needs fixes selected",
            outputs: [{ kind: "text", content: "Fix JSONDecodeError ordering." }],
          },
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const result = await runTaskNodeFeature({
      taskId: task.id,
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-condition-branch-ref:plan-1",
      },
      node: condition,
      plan,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: condition.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      featureSpec: {
        feature: "evaluate_condition_node",
        instructions: "Evaluate the current condition node.",
        inputText: "{}",
        terminalToolName: "chrona_condition_select",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "Runtime run runtime-condition completed without a Chrona terminal result action for node condition_node: Needs fixes selected",
    });
  });

  it("uses chrona_condition_select terminal tool evidence as condition routing authority", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI condition terminal tool workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-condition-terminal-tool",
        workspaceId: workspace.id,
        title: "Node AI condition terminal tool task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-condition-terminal-tool",
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    const condition = makeConditionNode();
    const passed = makeDownstreamNode({ id: "passed_node", localId: "passed_node", title: "Passed" });
    const fixes = makeDownstreamNode({ id: "fix_node", localId: "fix_node", title: "Needs fixes" });
    const plan = makeConditionPlan({ condition, passed, fixes });
    const branchRef = "B20260522-01-B";
    const aiRuntimeInvoker = {
      invoke: async () => ({
        runId: "local-run-condition-terminal-tool",
        runtimeRunRef: "runtime-condition-terminal-tool",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-condition-terminal-tool"],
        response: {
          provider: "hermes",
          runId: "runtime-condition-terminal-tool",
          nativeRunId: "runtime-condition-terminal-tool",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Needs fixes selected",
          structuredPayload: {
            branchRef,
            summary: "Needs fixes selected",
            outputs: [{ kind: "text", content: "Fix JSONDecodeError ordering." }],
          },
          raw: { terminalToolName: "chrona_condition_select" },
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const result = await runTaskNodeFeature({
      taskId: task.id,
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-condition-terminal-tool:plan-1",
      },
      node: condition,
      plan,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: condition.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      featureSpec: {
        feature: "evaluate_condition_node",
        instructions: "Evaluate the current condition node.",
        inputText: "{}",
        terminalToolName: "chrona_condition_select",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "done",
      summary: "Needs fixes selected",
      output: [{ kind: "text", content: "Fix JSONDecodeError ordering." }],
      selectedBranch: {
        label: "Needs fixes",
        nextNodeId: "fix_node",
        source: "ai",
      },
    });
  });

  it("keeps a completed provider run with chrona_node_block as blocked", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI condition blocked workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-condition-blocked",
        workspaceId: workspace.id,
        title: "Node AI condition blocked task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-condition-blocked",
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    const condition = makeConditionNode();
    const passed = makeDownstreamNode({ id: "passed_node", localId: "passed_node", title: "Passed" });
    const fixes = makeDownstreamNode({ id: "fix_node", localId: "fix_node", title: "Needs fixes" });
    const plan = makeConditionPlan({ condition, passed, fixes });
    const aiRuntimeInvoker = {
      invoke: async () => ({
        runId: "local-run-condition-blocked",
        runtimeRunRef: "runtime-condition-blocked",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-condition-blocked"],
        response: {
          provider: "hermes",
          runId: "runtime-condition-blocked",
          nativeRunId: "runtime-condition-blocked",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Need weather data source before selecting a branch.",
          raw: { terminalToolName: "chrona_node_block" },
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const result = await runTaskNodeFeature({
      taskId: task.id,
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-condition-blocked:plan-1",
      },
      node: condition,
      plan,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: condition.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      featureSpec: {
        feature: "evaluate_condition_node",
        instructions: "Evaluate the current condition node.",
        inputText: "{}",
        terminalToolName: "chrona_condition_select",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "Need weather data source before selecting a branch.",
      evidence: {
        sessionId: "main-session",
        runId: "local-run-condition-blocked",
        runtimeName: "hermes",
        runtimeRunRef: "runtime-condition-blocked",
        conversationEntryIds: ["conversation-entry-condition-blocked"],
      },
    });
  });
});
