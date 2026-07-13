import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AiRuntimeInvoker,
  evaluateConditionNodeCapability,
  executeTaskNodeCapability,
  reviewCheckpointNodeCapability,
} from "@chrona/engine/modules/plan-execution";
import { aiClientRegistry } from "../../../../../features/ai-clients/server";
import type { EngineAiClient } from "../../../../../features/ai-clients/server";
import { db } from "@chrona/db";
import {
  MemoryScope,
  MemorySourceType,
  MemoryStatus,
  RunStatus,
} from "@chrona/db/generated/prisma/client";
import type {
  AgentProviderClient,
  ProviderRunEvent,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunRef,
  ProviderRunSnapshot,
  ProviderSessionRef,
} from "@chrona/providers-foundation";
import type { EffectivePlanGraph, EffectivePlanNode, NodeAttempt } from "@chrona/contracts/ai";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

type TestProviderResponseClient = AgentProviderClient;

function createMockProviderClient(input: {
  outputMessages: string[];
  runStarted?: boolean;
}): TestProviderResponseClient {
  const messages: Array<{ role: string; content: string }> = [];
  let latestRun: ProviderRunRef | null = null;

  return {
    provider: "test-provider",
    getCapabilities(): ProviderCapabilities {
      return {
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: true,
      };
    },
    async checkHealth(): Promise<ProviderHealth> {
      return {
        provider: "test-provider",
        ok: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async createSession(): Promise<ProviderSessionRef> {
      return {
        provider: "test-provider",
        sessionId: "mock-session-key",
        createdAt: new Date().toISOString(),
      };
    },
    async startRun(request): Promise<ProviderRunRef> {
      messages.push({ role: "user", content: extractUserText(request) });
      for (const outputContent of input.outputMessages) {
        messages.push({ role: "assistant", content: outputContent });
      }

      latestRun = {
        provider: "test-provider",
        runId: input.runStarted === false ? "mock-failed-run" : `mock-run-ref-${Date.now()}`,
        nativeRunId: input.runStarted === false ? undefined : `mock-run-ref-${Date.now()}`,
        sessionId: request.sessionKey ?? "mock-session-key",
        status: input.runStarted === false ? "failed" : "completed",
      };
      return latestRun;
    },
    async *streamRun(request) {
      if (!("runId" in request) || !latestRun || request.runId !== latestRun.runId) {
        throw new Error("Mock provider streamRun requires runId");
      }
      if (input.runStarted === false) {
        yield {
          type: "run_failed" as const,
          run: latestRun,
          error: "provider refused to start",
        };
        return;
      }
      yield {
        type: "run_completed" as const,
        run: { ...latestRun, status: "running" as const },
        outputText: input.outputMessages.at(-1) ?? "",
      };
    },
    async getRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "test-provider",
        runId: "mock-run-ref",
        status: "completed",
      };
    },
    async cancelRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "test-provider",
        runId: "mock-run-ref",
        status: "cancelled",
      };
    },
  };
}

function createThrowingProviderClient(): TestProviderResponseClient {
  return {
    provider: "test-provider",
    getCapabilities(): ProviderCapabilities {
      return {
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: true,
      };
    },
    async checkHealth(): Promise<ProviderHealth> {
      return {
        provider: "test-provider",
        ok: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async createSession(): Promise<ProviderSessionRef> {
      return {
        provider: "test-provider",
        sessionId: "mock-session-key",
        createdAt: new Date().toISOString(),
      };
    },
    async startRun(): Promise<ProviderRunRef> {
      throw new Error("provider setup failed");
    },
    streamRun(): AsyncIterable<ProviderRunEvent> {
      throw new Error("streamRun should not be called after startRun failure");
    },
    async getRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "test-provider",
        runId: "mock-run-ref",
        status: "failed",
        error: "provider setup failed",
      };
    },
    async cancelRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "test-provider",
        runId: "mock-run-ref",
        status: "cancelled",
      };
    },
  };
}

function createMockHermesClient(input: {
  outputContent: string;
}) {
  const calls = {
    startRun: [] as Array<Parameters<AgentProviderClient["startRun"]>[0]>,
    streamRun: [] as Array<Parameters<AgentProviderClient["streamRun"]>[0]>,
  };

  const client: TestProviderResponseClient = {
    provider: "hermes",
    getCapabilities(): ProviderCapabilities {
      return {
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
      };
    },
    async checkHealth(): Promise<ProviderHealth> {
      return {
        provider: "hermes",
        ok: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async createSession(): Promise<ProviderSessionRef> {
      return {
        provider: "hermes",
        sessionId: "hermes-session-key",
        createdAt: new Date().toISOString(),
      };
    },
    async startRun(request): Promise<ProviderRunRef> {
      calls.startRun.push(request);
      return {
        provider: "hermes",
        runId: "hermes-run-1",
        sessionId: request.sessionId,
        status: "running",
      };
    },
    async *streamRun(request) {
      calls.streamRun.push(request);
      if (!("runId" in request) || request.runId !== "hermes-run-1") {
        throw new Error("Mock Hermes streamRun requires runId");
      }
      yield {
        type: "run_completed" as const,
        run: {
          provider: "hermes",
          runId: "hermes-run-1",
          sessionId: "hermes-session-key",
          status: "running" as const,
        },
        outputText: input.outputContent,
      };
    },
    async getRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: "hermes-run-1",
        status: "completed",
      };
    },
    async cancelRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: "hermes-run-1",
        status: "cancelled",
      };
    },
  };

  return { client, calls };
}

function createRecoverableHermesClient() {
  const calls = {
    startRun: [] as Array<Parameters<AgentProviderClient["startRun"]>[0]>,
    streamRun: [] as Array<Parameters<AgentProviderClient["streamRun"]>[0]>,
  };

  let streamAttempts = 0;
  const client: TestProviderResponseClient = {
    provider: "hermes",
    getCapabilities(): ProviderCapabilities {
      return {
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
      };
    },
    async checkHealth(): Promise<ProviderHealth> {
      return {
        provider: "hermes",
        ok: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async createSession(): Promise<ProviderSessionRef> {
      return {
        provider: "hermes",
        sessionId: "hermes-session-key",
        createdAt: new Date().toISOString(),
      };
    },
    async startRun(request): Promise<ProviderRunRef> {
      calls.startRun.push(request);
      return {
        provider: "hermes",
        runId: "hermes-run-recoverable",
        sessionId: request.sessionId,
        status: "running",
      };
    },
    async *streamRun(request): AsyncIterable<ProviderRunEvent> {
      calls.streamRun.push(request);
      streamAttempts += 1;
      if (streamAttempts === 1) {
        throw Object.assign(new Error("Hermes request aborted"), {
          code: "aborted",
          retryable: true,
        });
      }
      yield {
        type: "run_completed" as const,
        run: {
          provider: "hermes",
          runId: "hermes-run-recoverable",
          sessionId: "hermes-session-key",
          status: "running" as const,
        },
        outputText: "Recovered from existing Hermes run",
      };
    },
    async getRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: "hermes-run-recoverable",
        status: "completed",
      };
    },
    async cancelRun(): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: "hermes-run-recoverable",
        status: "cancelled",
      };
    },
  };

  return { client, calls };
}

const realGetAiClient = aiClientRegistry.get.bind(aiClientRegistry);

function installMockRegistryClient(
  providerClient: TestProviderResponseClient,
  clientType = "test-provider",
) {
  const client = {
    record: {
      id: `mock-${clientType}`,
      name: `Mock ${clientType}`,
      type: clientType,
      config: {},
      isDefault: true,
      enabled: true,
    },
    providerClient,
  } satisfies EngineAiClient;
  aiClientRegistry.get = async () => client;
}

function extractUserText(request: Parameters<AgentProviderClient["startRun"]>[0]): string {
  const parts = [request.instructions];
  try {
    parts.push(JSON.stringify(request.input, null, 2));
  } catch {
    parts.push(String(request.input));
  }
  return parts.filter(Boolean).join("\n\n");
}

function createAiRuntimeInvoker() {
  return new AiRuntimeInvoker();
}

function expectStreamedRunIds(
  calls: Array<Parameters<AgentProviderClient["streamRun"]>[0]>,
  runIds: string[],
) {
  expect(calls.map((call) => ("runId" in call ? call.runId : null))).toEqual(runIds);
}

function createNodeAttempt(input: {
  taskId: string;
  planId: string;
  nodeId: string;
}): NodeAttempt {
  return {
    id: `attempt-${input.taskId}-${input.nodeId}`,
    taskId: input.taskId,
    graphId: input.planId,
    nodeId: input.nodeId,
    nodeLayerId: input.nodeId,
    executionContextSnapshotId: `snapshot-${input.nodeId}`,
    status: "running",
    idempotencyKey: `${input.planId}:${input.nodeId}:1`,
    attemptNumber: 1,
    startedAt: new Date().toISOString(),
  };
}

async function seedFullSetup() {
  const { workspaceId } = await seedWorkspace("PlanExecTest");
  const { taskId } = await seedTask(workspaceId, {
    title: "Integration test - verify output persistence",
    status: "Ready",
  });

  const session = await db.taskSession.create({
    data: {
      taskId,
      sessionKey: `agent:test-provider:task-${taskId}`,
      runtimeName: "test-provider",
      label: "Main session",
      status: "idle",
    },
  });

  const now = new Date().toISOString();
  const node = {
    id: "node-1",
    nodeId: "node-1",
    activeLayerId: "node-1",
    semanticKey: "node-1",
    definition: {
      title: "Echo step",
      objective: "Produce a hello-world message",
      semantics: { type: "task" },
    },
    invalidated: false,
    localId: "node-1",
    type: "task",
    title: "Echo step",
    config: {},
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: true,
    ready: true,
    reachable: true,
  } satisfies EffectivePlanNode;

  const memory = await db.memory.create({
    data: {
      workspaceId,
      taskId,
      content: JSON.stringify({
        type: "task_plan_graph_v1",
        status: "accepted",
        revision: 1,
        source: "ai",
        generatedBy: "test-fixture",
        prompt: "Test plan",
        summary: "Run a simple task and verify output is saved",
        changeSummary: null,
        createdAt: now,
        updatedAt: now,
        nodes: [node],
        edges: [],
      }),
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  const planGraph = {
    graphId: memory.id,
    basePlanId: memory.id,
    resolvedAt: now,
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
  } satisfies EffectivePlanGraph;

  return {
    workspaceId,
    taskId,
    planId: memory.id,
    sessionId: session.id,
    sessionKey: session.sessionKey,
    planGraph,
  };
}

describe("executeTaskNodeCapability output persistence", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    aiClientRegistry.get = realGetAiClient;
  });

  it("persists assistant output as conversationEntry records in main_session execution", async () => {
    const outputContent = "Hello from the mock runtime! The task has been completed successfully.";
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const node = planGraph.nodes[0];
    const providerClient = createMockProviderClient({
      outputMessages: [outputContent],
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: node as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: node.id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });

    expect(entries.length).toBe(2);
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toContain("Echo step");
    expect(entries[0].content).toContain("Produce a hello-world message");
    expect(entries[0].content).not.toContain("nodeLayerId");
    expect(entries[0].content).not.toContain("contextSnapshotId");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe(outputContent);

    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    expect(run.status).toBe(RunStatus.Running);
    expect(run.runtimeRunRef).not.toBeNull();


    const task = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { latestRunId: true },
    });
    const session = await db.taskSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { activeRunId: true, lastRunStatus: true },
    });
    const projection = await db.taskProjection.findUniqueOrThrow({
      where: { taskId },
      select: { persistedStatus: true, latestRunStatus: true },
    });
    expect(task.latestRunId).toBe(run.id);
    expect(session.activeRunId).toBe(run.id);
    expect(session.lastRunStatus).toBe(RunStatus.Running);
    expect(projection.persistedStatus).toBe("Running");
    expect(projection.latestRunStatus).toBe(RunStatus.Running);
    const providerEvents = await db.event.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { ingestSequence: "asc" },
    });
    expect(providerEvents.length).toBeGreaterThan(0);
    expect(providerEvents.map((event: { eventType: string }) => event.eventType)).toContain("provider.run_completed");
    expect(providerEvents.at(-1)?.payload).toMatchObject({
      event: {
        type: "run_completed",
        run: expect.objectContaining({ status: "running" }),
      },
    });
  });


  it("rebuilds projection when provider setup fails after run creation", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    installMockRegistryClient(createThrowingProviderClient());

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("failed");
    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    const task = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { latestRunId: true },
    });
    const session = await db.taskSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { activeRunId: true, lastRunStatus: true },
    });
    const projection = await db.taskProjection.findUniqueOrThrow({
      where: { taskId },
      select: { persistedStatus: true, latestRunStatus: true, blockType: true, actionRequired: true },
    });
    expect(run.status).toBe(RunStatus.Failed);
    expect(task.latestRunId).toBe(run.id);
    expect(session.activeRunId).toBeNull();
    expect(session.lastRunStatus).toBe(RunStatus.Failed);
    expect(projection.persistedStatus).toBe("Blocked");
    expect(projection.latestRunStatus).toBe(RunStatus.Failed);
    expect(projection.blockType).toBe("run_failed");
    expect(projection.actionRequired).toBe("Retry Run");
  });
  it("keeps the node running when the provider produces no output", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const providerClient = createMockProviderClient({
      outputMessages: [],
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe("user");

    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    expect(run.status).toBe(RunStatus.Running);
  });

  it("does not require structured output when text output is empty", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const providerClient = createMockProviderClient({
      outputMessages: [],
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });
    expect(entries.length).toBe(1);
    expect((result as { summary: string }).summary).toContain("Runtime run");

    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    expect(run.status).toBe(RunStatus.Running);
  });

  it("derives task running state from the active provider run", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const providerClient = createMockProviderClient({
      outputMessages: [],
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("Running");
  });

  it("sets run status to Failed when the provider refuses to start", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const providerClient = createMockProviderClient({
      outputMessages: [],
      runStarted: false,
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("failed");
    expect((result as { error: string }).error).toContain("refused to start");
  });

  it("persists the final provider response when a response has multiple deltas", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const node = planGraph.nodes[0];
    const providerClient = createMockProviderClient({
      outputMessages: [
        "Thinking about this...",
        "Step 1 done.",
        "Final answer: task complete.",
      ],
    });
    installMockRegistryClient(providerClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: node as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: node.id }),
      runtimeName: "test-provider",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });

    expect(entries.length).toBe(2);
    expect(entries[0].role).toBe("user");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe("Final answer: task complete.");
  });

  it("starts Hermes runs before streaming run events", async () => {
    const outputContent = "Hermes completed the task.";
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const { client, calls } = createMockHermesClient({
      outputContent,
    });
    installMockRegistryClient(client, "hermes");

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");
    expect(calls.startRun).toHaveLength(1);
    expectStreamedRunIds(calls.streamRun, ["hermes-run-1"]);
  });

  it("recovers transient Hermes stream failures by reading the existing run first", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const { client, calls } = createRecoverableHermesClient();
    installMockRegistryClient(client, "hermes");

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    const persistedRun = await db.run.findUniqueOrThrow({
      where: { id: result.evidence?.runId as string },
    });

    expect(result.status).toBe("started");
    expect((result as { summary: string }).summary).toBe("Recovered from existing Hermes run");
    expect(calls.startRun).toHaveLength(1);
    expect((calls.startRun[0] as { idempotencyKey?: string }).idempotencyKey).toStartWith("provider-run:");
    expectStreamedRunIds(calls.streamRun, ["hermes-run-recoverable", "hermes-run-recoverable"]);
    expect(persistedRun.runtimeRunRef).toBe("hermes-run-recoverable");
  });

  it("does not require structured tool result for Hermes task execution", async () => {
    const outputContent = "Hermes advanced the node through Chrona MCP.";
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const { client, calls } = createMockHermesClient({
      outputContent,
    });
    installMockRegistryClient(client, "hermes");

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: planGraph.nodes[0].id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");
    expect((result as { summary: string }).summary).toBe(outputContent);
    expect(calls.startRun[0].structuredOutputSchema).toBeUndefined();
    expect(calls.startRun[0].instructions).toContain("terminal Chrona action");
    expectStreamedRunIds(calls.streamRun, ["hermes-run-1"]);
  });

  it("does not require legacy condition structured output for Hermes condition execution", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const { client, calls } = createMockHermesClient({
      outputContent: "Hermes will select the branch through Chrona MCP.",
    });
    installMockRegistryClient(client, "hermes");

    const conditionNode = {
      ...planGraph.nodes[0],
      type: "condition",
      title: "Choose branch",
      config: {
        condition: "Is the task ready?",
        branches: [{ label: "yes", nextNodeId: "node-2" }],
      },
    };

    const result = await evaluateConditionNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: conditionNode as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: conditionNode.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");
    expect(calls.startRun[0].structuredOutputSchema).toBeUndefined();
    expect(calls.startRun[0].instructions).toContain("terminal Chrona action");
    expect(calls.startRun[0].instructions).not.toContain("evaluate_condition_node_result");
    expectStreamedRunIds(calls.streamRun, ["hermes-run-1"]);
  });

  it("does not require legacy checkpoint structured output for Hermes checkpoint execution", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const { client, calls } = createMockHermesClient({
      outputContent: "Hermes will review the checkpoint through Chrona MCP.",
    });
    installMockRegistryClient(client, "hermes");

    const checkpointNode = {
      ...planGraph.nodes[0],
      type: "checkpoint",
      title: "Review checkpoint",
      config: {
        checkpointType: "approve",
        prompt: "Approve continuing?",
      },
    };

    const result = await reviewCheckpointNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: checkpointNode as any,
      plan: planGraph as any,
      attempt: createNodeAttempt({ taskId, planId, nodeId: checkpointNode.id }),
      runtimeName: "hermes",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("started");
    expect(calls.startRun[0].structuredOutputSchema).toBeUndefined();
    expect(calls.startRun[0].instructions).toContain("terminal Chrona action");
    expect(calls.startRun[0].instructions).not.toContain("review_checkpoint_node_result");
    expectStreamedRunIds(calls.streamRun, ["hermes-run-1"]);
  });
});
