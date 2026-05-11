import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AiRuntimeInvoker,
  executeTaskNodeCapability,
} from "@chrona/engine/modules/plan-execution";
import { aiClientRegistry } from "@chrona/engine/modules/ai/runtime/client-registry";
import { db } from "@chrona/db";
import {
  MemoryScope,
  MemorySourceType,
  MemoryStatus,
  RunStatus,
} from "@chrona/db/generated/prisma/client";
import type { TaskNodeAiResult } from "@chrona/contracts";
import type { BridgeResponse, OpenClawGatewayRequest } from "@chrona/openclaw";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

type TestOpenClawResponseClient = {
  execute(input: {
    request: OpenClawGatewayRequest;
  }): Promise<BridgeResponse>;
};

function createMockOpenClawClient(input: {
  outputMessages: string[];
  runStarted?: boolean;
  structuredResult?: TaskNodeAiResult | null;
}): TestOpenClawResponseClient {
  const messages: Array<{ role: string; content: string }> = [];

  return {
    async execute({ request }) {
      messages.push({ role: "user", content: extractUserText(request) });
      for (const outputContent of input.outputMessages) {
        messages.push({ role: "assistant", content: outputContent });
      }

      const response: BridgeResponse = {
        sessionId: request.sessionKey ?? "mock-session-key",
        responseId: input.runStarted === false ? undefined : `mock-run-ref-${Date.now()}`,
        responseStatus: input.runStarted === false ? "failed" : "completed",
        output: input.outputMessages.at(-1) ?? "",
        usage: null,
        error: input.runStarted === false ? "provider refused to start" : null,
        durationMs: 1,
        structured: input.structuredResult
          ? { ok: true, parsed: input.structuredResult, source: "business_tool" }
          : null,
        feature: null,
      };
      return response;
    },
  };
}

const realGetAiClient = aiClientRegistry.get.bind(aiClientRegistry);

function installMockRegistryClient(openClawClient: TestOpenClawResponseClient) {
  aiClientRegistry.get = (async () =>
    ({
      record: { type: "openclaw" },
      providerClient: openClawClient,
    }) as any) as typeof aiClientRegistry.get;
}

function extractUserText(request: OpenClawGatewayRequest): string {
  const parts = [request.instructions];
  try {
    parts.push(JSON.stringify(request.input, null, 2));
  } catch {
    parts.push(String(request.input));
  }
  return parts.filter(Boolean).join("\n\n");
}

function completedTaskResult(outputContent: string): TaskNodeAiResult {
  return {
    outcome: "completed",
    summary: outputContent,
    outputs: [{ kind: "text", content: outputContent }],
  };
}

function createAiRuntimeInvoker() {
  return new AiRuntimeInvoker();
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
      sessionKey: `agent:openclaw:task-${taskId}`,
      runtimeName: "openclaw",
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
    config: { objective: "Produce a hello-world message" },
    dependencies: [],
    dependents: [],
    status: "pending",
    attempts: 0,
    metadata: {},
    dependenciesSatisfied: true,
    ready: true,
    reachable: true,
  };

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
    planId: memory.id,
    basePlanId: memory.id,
    resolvedAt: now,
    resolvedVersion: 1,
    nodes: [node],
    edges: [],
    entryNodeIds: [node.id],
    terminalNodeIds: [node.id],
    readyNodeIds: [node.id],
    blockedNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: [node.id],
  };

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
    const { taskId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const node = planGraph.nodes[0];
    const openClawClient = createMockOpenClawClient({
      outputMessages: [outputContent],
      structuredResult: completedTaskResult(outputContent),
    });
    installMockRegistryClient(openClawClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: node as any,
      plan: planGraph as any,
      runtimeName: "openclaw",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("done");

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
    expect(run.status).toBe(RunStatus.Completed);
    expect(run.runtimeRunRef).not.toBeNull();
  });

  it("sets run status to Failed when the provider produces no output", async () => {
    const { taskId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const openClawClient = createMockOpenClawClient({
      outputMessages: [],
      structuredResult: null,
    });
    installMockRegistryClient(openClawClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      runtimeName: "openclaw",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("failed");

    const failedResult = result as Extract<typeof result, { status: "failed" }>;
    const entries = await db.conversationEntry.findMany({
      where: { runId: failedResult.evidence?.runId },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe("user");

    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    expect(run.status).toBe(RunStatus.Failed);
  });

  it("treats successful structured output as assistant output when text output is empty", async () => {
    const { taskId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const openClawClient = createMockOpenClawClient({
      outputMessages: [],
      structuredResult: completedTaskResult("Structured task complete."),
    });
    installMockRegistryClient(openClawClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      runtimeName: "openclaw",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("done");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });
    expect(entries.length).toBe(2);
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe("Structured task complete.");

    const run = await db.run.findFirstOrThrow({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    expect(run.status).toBe(RunStatus.Completed);
  });

  it("sets run status to Failed when the provider refuses to start", async () => {
    const { taskId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const openClawClient = createMockOpenClawClient({
      outputMessages: [],
      runStarted: false,
      structuredResult: null,
    });
    installMockRegistryClient(openClawClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0] as any,
      plan: planGraph as any,
      runtimeName: "openclaw",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("failed");
    expect((result as { error: string }).error).toContain("refused to start");
  });

  it("persists the final provider response when a response has multiple deltas", async () => {
    const { taskId, sessionId, sessionKey, planGraph } = await seedFullSetup();
    const node = planGraph.nodes[0];
    const openClawClient = createMockOpenClawClient({
      outputMessages: [
        "Thinking about this...",
        "Step 1 done.",
        "Final answer: task complete.",
      ],
      structuredResult: completedTaskResult("Final answer: task complete."),
    });
    installMockRegistryClient(openClawClient);

    const result = await executeTaskNodeCapability({
      taskId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: node as any,
      plan: planGraph as any,
      runtimeName: "openclaw",
      aiRuntimeInvoker: createAiRuntimeInvoker(),
    });

    expect(result.status).toBe("done");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });

    expect(entries.length).toBe(2);
    expect(entries[0].role).toBe("user");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe("Final answer: task complete.");
  });
});
