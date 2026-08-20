import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db, TaskStatus } from "@chrona/db";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeAttempt,
} from "@chrona/contracts/ai";
import {
  __nodeAiCapabilityTestHooks,
  executeTaskNodeCapability,
  runTaskNodeFeature,
} from "./runtime/node-ai-capabilities";
import type { AiRuntimeInvoker } from "./ai-runtime-invoker";
function nodeRequest(input: {
  kind: "execute" | "evaluate" | "review";
  attempt: NodeAttempt;
  terminalToolName: string;
}) {
  return {
    protocolVersion: 1 as const,
    kind: input.kind,
    clientOperationId: `node-capability:${input.kind}:${input.attempt.idempotencyKey}`,
    instructions: "Execute the current node.",
    runtimeInput: {},
    terminalToolName: input.terminalToolName,
  };
}

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

function makeDownstreamNode(input: {
  id: string;
  localId: string;
  title: string;
}): EffectivePlanNode {
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
      {
        id: "edge-passed",
        from: input.condition.id,
        to: input.passed.id,
        label: "Passed",
        active: true,
      },
      {
        id: "edge-fixes",
        from: input.condition.id,
        to: input.fixes.id,
        label: "Needs fixes",
        active: true,
      },
    ],
    terminalNodeIds: [input.passed.id, input.fixes.id],
    pendingNodeIds: [input.condition.id, input.passed.id, input.fixes.id],
  };
}

function makeAttempt(input: {
  taskId: string;
  graphId: string;
  nodeId: string;
}): NodeAttempt {
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
describe("node capability protocol", () => {
  it("requires a versioned request and stable client operation identity", () => {
    expect(
      __nodeAiCapabilityTestHooks.parseRequest({
        protocolVersion: 1,
        kind: "execute",
        clientOperationId: "node-capability:execute:graph-1:node-1:1",
        instructions: "Execute the current node.",
        runtimeInput: {},
        terminalToolName: "chrona_node_complete",
      }),
    ).toMatchObject({
      kind: "execute",
      clientOperationId: "node-capability:execute:graph-1:node-1:1",
    });
    expect(() =>
      __nodeAiCapabilityTestHooks.parseRequest({
        protocolVersion: 1,
        kind: "execute",
        instructions: "Execute the current node.",
        runtimeInput: {},
        terminalToolName: "chrona_node_complete",
      }),
    ).toThrow();
  });

  it("rejects malformed provider response status before node result persistence", () => {
    expect(() =>
      __nodeAiCapabilityTestHooks.parseResponse({ status: "unknown" }),
    ).toThrow();
  });
});

describe("runTaskNodeFeature", () => {
  beforeEach(async () => {
    await resetNodeAiCapabilitiesDb();
  });

  afterAll(async () => {
    await resetNodeAiCapabilitiesDb();
  });

  it("[RUN-021] does not treat empty provider output without the terminal tool as success", async () => {
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
          outputText: "",
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
      attempt: makeAttempt({
        taskId: "task-1",
        graphId: plan.graphId,
        nodeId: node.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "execute",
        attempt: makeAttempt({
          taskId: "task-1",
          graphId: plan.graphId,
          nodeId: node.id,
        }),
        terminalToolName: "chrona_node_complete",
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      error:
        "Runtime run runtime-first-entry completed without a Chrona terminal result action for node first_entry",
      evidence: {
        sessionId: "main-session",
        runId: "local-run-1",
        runtimeName: "hermes",
        provider: "omp",
        runtimeRunRef: "runtime-first-entry",
        conversationEntryIds: ["conversation-entry-1"],
      },
    });

    const run = await db.run.findUniqueOrThrow({
      where: { id: "local-run-1" },
    });
    expect(run).toMatchObject({
      status: "Running",
      errorSummary: null,
      endedAt: null,
    });
  });

  it("[RUN-021] converts malformed provider stream events into a failed node result", async () => {
    const node = makeTaskNode();
    const plan = makePlan(node);
    const attempt = makeAttempt({
      taskId: "task-malformed-stream",
      graphId: plan.graphId,
      nodeId: node.id,
    });
    const aiRuntimeInvoker = {
      invoke: async () => {
        throw new Error("Provider stream event failed schema validation");
      },
    } satisfies Pick<AiRuntimeInvoker, "invoke">;

    const result = await runTaskNodeFeature({
      taskId: "task-malformed-stream",
      mainSession: {
        id: "main-session",
        taskId: "task-malformed-stream",
        sessionKey: "chrona:task:task-malformed-stream:plan-1",
      },
      node,
      plan,
      attempt,
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "execute",
        attempt,
        terminalToolName: "chrona_node_complete",
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      error:
        "Failed to execute AI capability for node first_entry: Provider stream event failed schema validation",
    });
  });

  it("returns provider cancellation as a failed node candidate without terminalizing the Run", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI cancelled workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
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
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-cancelled-provider:plan-1",
      },
      node,
      plan,
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: node.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "execute",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: node.id,
        }),
        terminalToolName: "chrona_node_complete",
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "Provider cancelled runtime run runtime-cancelled",
    });
    const run = await db.run.findUniqueOrThrow({
      where: { id: "local-run-cancelled" },
    });
    expect(run.status).toBe("Running");
    expect(run.endedAt).toBeNull();
    expect(run.errorSummary).toBeNull();
  });

  it("sends non-null accumulated plan output to the runtime invoker", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Node AI plan output workspace",
        status: "Active",
        defaultRuntime: "hermes",
      },
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
        findings: [
          {
            key: "first-finding",
            content: "First finding",
            sourceNodeRef: "N20260522-01",
          },
        ],
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
      mainSession: {
        id: "main-session",
        taskId: task.id,
        sessionKey: "chrona:task:task-plan-output-context:plan-1",
      },
      node,
      plan,
      planOutput,
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: node.id,
      }),
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
    const invocation = invocations[0] as {
      clientOperationId: string;
      runtimeInput: { context: { resultManifest: unknown } };
      instructions: string;
      terminalToolName: string;
    };
    expect(invocation.clientOperationId).toBe(
      `node-capability:execute:${plan.graphId}:${node.id}:1`,
    );
    expect(invocation.runtimeInput.context.resultManifest).toEqual(
      expectedResultManifest,
    );
    expect(invocation.terminalToolName).toBe("chrona_node_complete");
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
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: node.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "execute",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: node.id,
        }),
        terminalToolName: "chrona_node_complete",
      }),
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
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: node.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "execute",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: node.id,
        }),
        terminalToolName: "chrona_node_complete",
      }),
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
    const passed = makeDownstreamNode({
      id: "passed_node",
      localId: "passed_node",
      title: "Passed",
    });
    const fixes = makeDownstreamNode({
      id: "fix_node",
      localId: "fix_node",
      title: "Needs fixes",
    });
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
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: condition.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "evaluate",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: condition.id,
        }),
        terminalToolName: "chrona_condition_select",
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      error:
        "Runtime run runtime-condition completed without a Chrona terminal result action for node condition_node: Needs fixes selected",
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
    const passed = makeDownstreamNode({
      id: "passed_node",
      localId: "passed_node",
      title: "Passed",
    });
    const fixes = makeDownstreamNode({
      id: "fix_node",
      localId: "fix_node",
      title: "Needs fixes",
    });
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
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: condition.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "evaluate",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: condition.id,
        }),
        terminalToolName: "chrona_condition_select",
      }),
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
    const passed = makeDownstreamNode({
      id: "passed_node",
      localId: "passed_node",
      title: "Passed",
    });
    const fixes = makeDownstreamNode({
      id: "fix_node",
      localId: "fix_node",
      title: "Needs fixes",
    });
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
      attempt: makeAttempt({
        taskId: task.id,
        graphId: plan.graphId,
        nodeId: condition.id,
      }),
      runtimeName: "hermes",
      aiRuntimeInvoker: aiRuntimeInvoker as AiRuntimeInvoker,
      request: nodeRequest({
        kind: "evaluate",
        attempt: makeAttempt({
          taskId: task.id,
          graphId: plan.graphId,
          nodeId: condition.id,
        }),
        terminalToolName: "chrona_condition_select",
      }),
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
