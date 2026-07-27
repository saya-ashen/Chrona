import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { EffectivePlanGraph, EffectivePlanNode, NodeAttempt } from "@chrona/contracts/ai";
import { executeTaskNodeCapability, runTaskNodeFeature } from "./runtime/node-ai-capabilities";
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

async function resetNodeAiCapabilitiesDb() {
  await db.toolInvocation.deleteMany();
  await db.rawEventLog.deleteMany();
  await db.executionSession.deleteMany();
  await db.taskPlanProviderRun.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskSession.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("runTaskNodeFeature", () => {
  beforeEach(async () => {
    await resetNodeAiCapabilitiesDb();
  });

  afterAll(async () => {
    await resetNodeAiCapabilitiesDb();
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
        controlRunToken: null,
        providerName: "omp",
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
        terminalToolName: "chrona_node_complete",
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
        provider: "omp",
        runtimeRunRef: "runtime-first-entry",
        conversationEntryIds: ["conversation-entry-1"],
      },
    });

    const run = await db.run.findUniqueOrThrow({ where: { id: "local-run-1" } });
    expect(run).toMatchObject({
      status: "Failed",
      errorSummary: "Runtime run runtime-first-entry completed without a Chrona terminal result action for node first_entry: Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
    });
    expect(run.endedAt).not.toBeNull();
  });

  it("marks unexpected provider cancellation as a failed Run", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Node AI cancelled workspace", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        id: "task-cancelled-provider",
        workspaceId: workspace.id,
        title: "Node AI cancelled task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-cancelled",
        taskId: task.id,
        runtimeName: "hermes",
        runtimeRunRef: "runtime-cancelled",
        runtimeSessionRef: "main-session",
        status: "Running",
        syncStatus: "healthy",
        triggeredBy: "system",
        startedAt: new Date(),
      },
    });

    const node = makeTaskNode();
    const aiRuntimeInvoker = {
      invoke: async () => ({
        runId: "local-run-cancelled",
        runtimeRunRef: "runtime-cancelled",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-cancelled"],
        providerName: "codex",
        response: {
          provider: "codex",
          runId: "runtime-cancelled",
          nativeRunId: "runtime-cancelled",
          sessionId: "main-session",
          status: "cancelled" as const,
          error: null,
        },
      }),
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const plan = makePlan(node);
    const result = await runTaskNodeFeature({
      taskId: task.id,
      mainSession: { id: "main-session", taskId: task.id, sessionKey: "chrona:task:task-cancelled-provider:plan-1" },
      node,
      plan,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: node.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      featureSpec: {
        feature: "execute_task_node",
        instructions: "Execute the current task node.",
        inputText: "{}",
        terminalToolName: "chrona_node_complete",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "Provider cancelled runtime run runtime-cancelled",
    });
    const run = await db.run.findUniqueOrThrow({ where: { id: "local-run-cancelled" } });
    expect(run.status).toBe("Failed");
    expect(run.endedAt).toBeInstanceOf(Date);
    expect(run.errorSummary).toBe("Provider cancelled runtime run runtime-cancelled");
  });

  it("sends non-null accumulated plan output to the runtime invoker", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Node AI plan output workspace", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        id: "task-plan-output-context",
        workspaceId: workspace.id,
        title: "Node AI plan output task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-plan-output-context",
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });
    const planOutput = {
      manifest: {
        schemaVersion: 1 as const,
        sourceRevision: 1,
        outcome: { title: "Research", summary: "First section" },
        readiness: { status: "partial" as const, summary: "More work remains" },
        sections: [],
        deliverables: [],
        findings: [{ key: "first-finding", content: "First finding", sourceNodeRef: "N20260522-01" }],
        decisions: [],
        caveats: [],
        nextActions: [],
        evidence: [],
      },
      finalizedResult: null,
      finalization: { status: "Pending" as const, sourceRevision: 1 },
      revision: 1,
      updatedAt: "2026-05-22T00:01:00.000Z",
      updatedByNodeId: "first_entry",
    };
    const invocations: unknown[] = [];
    const aiRuntimeInvoker = {
      invoke: async (input) => {
        invocations.push(input);
        return {
          runId: "local-run-plan-output-context",
          runtimeRunRef: "runtime-plan-output-context",
          runtimeSessionKey: "main-session",
          conversationEntryIds: ["conversation-entry-plan-output-context"],
          providerName: "codex",
          response: {
            provider: "codex",
            runId: "runtime-plan-output-context",
            nativeRunId: "runtime-plan-output-context",
            sessionId: "main-session",
            status: "running" as const,
            error: null,
          },
        };
      },
    } satisfies Pick<AiRuntimeInvoker, "invoke">;
    const node = makeTaskNode();
    const plan = makePlan(node);

    await executeTaskNodeCapability({
      taskId: task.id,
      mainSession: { id: "main-session", taskId: task.id, sessionKey: "chrona:task:task-plan-output-context:plan-1" },
      node,
      plan,
      planOutput,
      attempt: makeAttempt({ taskId: task.id, graphId: plan.graphId, nodeId: node.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
    });

    const expectedResultManifest = {
      sourceRevision: 1,
      outcome: { title: "Research", summary: "First section" },
      currentDeliverableKeys: [],
      findingKeys: ["first-finding"],
      decisionKeys: [],
      caveatKeys: [],
      nextActionKeys: [],
    };
    const invocation = invocations[0] as { runtimeInput: { context: { resultManifest: unknown } }; instructions: string; featureSpec: { inputText: string } };
    expect(invocation.runtimeInput.context.resultManifest).toEqual(expectedResultManifest);
    expect(JSON.parse(invocation.featureSpec.inputText).context.resultManifest).toEqual(expectedResultManifest);
    expect(invocation.instructions).toContain('"sourceRevision": 1');
    expect(invocation.instructions).not.toContain('"spec":');
  });


  it("accepts a completed task snapshot only when chrona_node_complete was used", async () => {
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
        controlRunToken: null,
        providerName: "claude_code",
        response: {
          provider: "hermes",
          runId: "runtime-task-terminal-tool",
          nativeRunId: "runtime-task-terminal-tool",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Task complete",
          raw: { terminalToolName: "chrona_node_complete" },
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
        terminalToolName: "chrona_node_complete",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "done",
      summary: "Task complete",
    });
  });

  it("does not treat chrona_node_complete with failed structured status as success", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI false complete workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
    });
    const task = await db.task.create({
      data: {
        id: "task-false-complete",
        workspaceId: workspace.id,
        title: "Node AI false complete task",
        status: TaskStatus.Running,
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        id: "local-run-false-complete",
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
        runId: "local-run-false-complete",
        runtimeRunRef: "runtime-false-complete",
        runtimeSessionKey: "main-session",
        conversationEntryIds: ["conversation-entry-false-complete"],
        controlRunToken: null,
        providerName: "omp",
        response: {
          provider: "hermes",
          runId: "runtime-false-complete",
          nativeRunId: "runtime-false-complete",
          sessionId: "main-session",
          status: "completed" as const,
          outputText: "Could not fetch GitHub Trending.",
          structuredPayload: {
            completed: false,
            status: "failed",
            error: "Missing network/browser capability.",
          },
          raw: { terminalToolName: "chrona_node_complete" },
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
        sessionKey: "chrona:task:task-false-complete:plan-1",
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
        terminalToolName: "chrona_node_complete",
        structuredOutputSchema: undefined,
      },
      providerInput: {},
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "Missing network/browser capability.",
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
        controlRunToken: null,
        providerName: "claude_code",
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
        controlRunToken: null,
        providerName: "claude_code",
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
        controlRunToken: null,
        providerName: "claude_code",
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
