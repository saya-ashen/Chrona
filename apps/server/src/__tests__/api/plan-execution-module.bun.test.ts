import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import type { ConversationEntry, Event, Run } from "@chrona/db/generated/prisma/client";
import { createChronaEngine } from "@chrona/engine";
import { aiClientRegistry } from "../../../../../features/ai-clients/server";
import { saveCompiledPlan } from "@chrona/engine/modules/plan-execution/persistence/compiled-plan-store";
import type {
  AgentProviderClient,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
  ProviderSessionRef,
} from "@chrona/providers-foundation";
import type {
  CheckpointConfig,
  CompiledPlan,
  ConditionConfig,
  TaskConfig,
} from "@chrona/contracts/ai";

import { createApiRouter } from "../../routes/api";
import { json, resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

type SseEntry = { event: string; data: Record<string, unknown> };
type RuntimeInput = {
  node?: { title?: unknown; type?: unknown };
  branchOptions?: Array<{ ref?: unknown; label?: unknown }>;
};

const realGetAiClient = aiClientRegistry.get.bind(aiClientRegistry);

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

function parseSseEvents(text: string): SseEntry[] {
  return text
    .trim()
    .split(/\n\n+/)
    .map((chunk) => {
      const event = chunk.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      return data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((entry): entry is SseEntry => entry !== null);
}

async function seedAcceptedCompiledPlan(input: {
  workspaceId: string;
  taskId: string;
  compiledPlan: CompiledPlan;
}) {
  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    compiledPlan: input.compiledPlan,
    status: "accepted",
    prompt: input.compiledPlan.title,
    summary: input.compiledPlan.goal,
    generatedBy: "plan-execution-module-test",
  });
}

function makeSingleTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Single task module plan ${editablePlanId}`,
    goal: "Execute one provider-backed task through the public API",
    assumptions: [],
    nodes: [
      {
        id: "task_node",
        localId: "task_node",
        type: "task",
        title: "Execute module task node",
        description: "Provider-backed single task",
        config: { expectedOutput: "Single provider result" } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: ["task_node"],
    terminalNodeIds: ["task_node"],
    topologicalOrder: ["task_node"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeTwoTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Sequential task module plan ${editablePlanId}`,
    goal: "Complete one provider-backed task before the next",
    assumptions: [],
    nodes: [
      {
        id: "first_task",
        localId: "first_task",
        type: "task",
        title: "Collect script requirements",
        description: "First provider-backed task",
        config: { expectedOutput: "Requirements collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: ["second_task"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "second_task",
        localId: "second_task",
        type: "task",
        title: "Finalize script specification",
        description: "Second provider-backed task",
        config: { expectedOutput: "Executable script specification" } satisfies TaskConfig,
        dependencies: ["first_task"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_first_to_second", from: "first_task", to: "second_task" }],
    entryNodeIds: ["first_task"],
    terminalNodeIds: ["second_task"],
    topologicalOrder: ["first_task", "second_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeTwoEntryTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Parallel entry module plan ${editablePlanId}`,
    goal: "Run independent provider-backed entry tasks without duplication",
    assumptions: [],
    nodes: [
      {
        id: "first_entry",
        localId: "first_entry",
        type: "task",
        title: "Collect architecture facts",
        description: "First independent entry",
        config: { expectedOutput: "Architecture facts collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "second_entry",
        localId: "second_entry",
        type: "task",
        title: "Collect documentation facts",
        description: "Second independent entry",
        config: { expectedOutput: "Documentation facts collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: ["first_entry", "second_entry"],
    terminalNodeIds: ["first_entry", "second_entry"],
    topologicalOrder: ["first_entry", "second_entry"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeAiConditionBranchPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `AI branch module plan ${editablePlanId}`,
    goal: "Route through an AI condition branch and skip the alternate path",
    assumptions: [],
    nodes: [
      {
        id: "prepare_task",
        localId: "prepare_task",
        type: "task",
        title: "Prepare execution context",
        description: "Initial provider task",
        config: { expectedOutput: "Preparation complete" } satisfies TaskConfig,
        dependencies: [],
        dependents: ["route_condition"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "route_condition",
        localId: "route_condition",
        type: "condition",
        title: "Choose execution route",
        description: "AI selects the approval path",
        config: {
          condition: "Which route should the plan take?",
          evaluationBy: "ai",
          branches: [
            { label: "approve", nextNodeId: "approved_task" },
            { label: "skip", nextNodeId: "skipped_task" },
          ],
        } satisfies ConditionConfig,
        dependencies: ["prepare_task"],
        dependents: ["approved_task", "skipped_task"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "approved_task",
        localId: "approved_task",
        type: "task",
        title: "Run approved branch",
        description: "Selected branch task",
        config: { expectedOutput: "Approved branch output" } satisfies TaskConfig,
        dependencies: ["route_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "skipped_task",
        localId: "skipped_task",
        type: "task",
        title: "Skipped alternate branch",
        description: "Unselected branch task",
        config: { expectedOutput: "Should not execute" } satisfies TaskConfig,
        dependencies: ["route_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [
      { id: "edge_prepare_to_condition", from: "prepare_task", to: "route_condition" },
      { id: "edge_condition_to_approved", from: "route_condition", to: "approved_task", label: "approve" },
      { id: "edge_condition_to_skipped", from: "route_condition", to: "skipped_task", label: "skip" },
    ],
    entryNodeIds: ["prepare_task"],
    terminalNodeIds: ["approved_task", "skipped_task"],
    topologicalOrder: ["prepare_task", "route_condition", "approved_task", "skipped_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeInputCheckpointThenTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Checkpoint module plan ${editablePlanId}`,
    goal: "Pause for user input, then continue provider-backed execution",
    assumptions: [],
    nodes: [
      {
        id: "requirements_checkpoint",
        localId: "requirements_checkpoint",
        type: "checkpoint",
        title: "Confirm requirements",
        description: "Collect required user input before execution",
        config: {
          checkpointType: "input",
          prompt: "Confirm script requirements",
          required: true,
          inputFields: [
            { name: "location_scope", label: "Location scope", type: "text", required: true },
            { name: "output_format", label: "Output format", type: "text", required: true },
          ],
        } satisfies CheckpointConfig,
        dependencies: [],
        dependents: ["spec_task"],
      },
      {
        id: "spec_task",
        localId: "spec_task",
        type: "task",
        title: "Finalize checkpoint-driven specification",
        description: "Provider task after checkpoint input",
        config: { expectedOutput: "Executable script specification" } satisfies TaskConfig,
        dependencies: ["requirements_checkpoint"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_checkpoint_to_spec", from: "requirements_checkpoint", to: "spec_task" }],
    entryNodeIds: ["requirements_checkpoint"],
    terminalNodeIds: ["spec_task"],
    topologicalOrder: ["requirements_checkpoint", "spec_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function runtimeInputFromRequest(request: Parameters<AgentProviderClient["startRun"]>[0]): RuntimeInput {
  return request.input && typeof request.input === "object" && !Array.isArray(request.input)
    ? request.input as RuntimeInput
    : {};
}

function outputForNode(title: string) {
  return `${title} completed by module provider`;
}

function structuredPayloadForRequest(request: Parameters<AgentProviderClient["startRun"]>[0]) {
  const runtimeInput = runtimeInputFromRequest(request);
  if (runtimeInput.node?.type !== "condition") {
    return { terminalToolName: request.terminalToolName, summary: outputForNode(String(runtimeInput.node?.title ?? "Node")) };
  }

  const branch = runtimeInput.branchOptions?.find((option) => option.label === "approve")
    ?? runtimeInput.branchOptions?.[0];
  return {
    terminalToolName: request.terminalToolName,
    branchRef: typeof branch?.ref === "string" ? branch.ref : undefined,
    summary: "Condition selected approve branch",
  };
}

function createScriptedProviderClient() {
  const calls = {
    startRun: [] as Array<Parameters<AgentProviderClient["startRun"]>[0]>,
    streamRun: [] as Array<Parameters<AgentProviderClient["streamRun"]>[0]>,
    nodeTitles: [] as string[],
  };
  const requestsByRunId = new Map<string, Parameters<AgentProviderClient["startRun"]>[0]>();
  let runCounter = 0;

  const client: AgentProviderClient = {
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
        sessionId: `module-provider-session-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
    },
    async startRun(request): Promise<ProviderRunRef> {
      runCounter += 1;
      const runId = `module-provider-run-${runCounter}`;
      const runtimeInput = runtimeInputFromRequest(request);
      calls.startRun.push(request);
      calls.nodeTitles.push(String(runtimeInput.node?.title ?? "Unknown node"));
      requestsByRunId.set(runId, request);
      return {
        provider: "hermes",
        runId,
        nativeRunId: `native-${runId}`,
        sessionId: request.sessionId,
        status: "running",
      };
    },
    async *streamRun(request): AsyncIterable<ProviderRunEvent> {
      calls.streamRun.push(request);
      if (!("runId" in request) || !request.runId) {
        throw new Error("streamRun requires runId");
      }

      const startRequest = requestsByRunId.get(request.runId);
      if (!startRequest) {
        throw new Error(`No scripted request for ${request.runId}`);
      }

      const runtimeInput = runtimeInputFromRequest(startRequest);
      const nodeTitle = String(runtimeInput.node?.title ?? "Unknown node");
      const run = {
        provider: "hermes",
        runId: request.runId,
        nativeRunId: `native-${request.runId}`,
        sessionId: request.sessionId ?? startRequest.sessionId,
        status: "completed" as const,
      };
      const timestamp = new Date().toISOString();
      const outputText = outputForNode(nodeTitle);
      const structuredPayload = structuredPayloadForRequest(startRequest);

      yield { type: "run_started", provider: "hermes", runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, sequence: 1, timestamp, run };
      yield { type: "text_delta", provider: "hermes", runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, sequence: 2, timestamp, text: outputText };
      yield { type: "tool_completed", provider: "hermes", runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, sequence: 3, timestamp, toolName: startRequest.terminalToolName };
      yield {
        type: "run_completed",
        provider: "hermes",
        runId: run.runId,
        nativeRunId: run.nativeRunId,
        sessionId: run.sessionId,
        sequence: 4,
        timestamp,
        run,
        outputText,
        structuredPayload,
      };
    },
    async getRun(input): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: input.runId,
        sessionId: input.sessionId,
        status: "completed",
        outputText: "Recovered module provider output",
      };
    },
    async cancelRun(input): Promise<ProviderRunSnapshot> {
      return {
        provider: "hermes",
        runId: input.runId,
        sessionId: input.sessionId,
        status: "cancelled",
      };
    },
  };

  return { client, calls };
}

function installMockRegistryClient(providerClient: AgentProviderClient) {
  aiClientRegistry.get = (async () =>
    ({
      record: { type: "hermes" },
      providerClient,
    }) as any) as typeof aiClientRegistry.get;
}

async function postExecutionAction(server: Hono, taskId: string, body: Record<string, unknown>) {
  const response = await server.request(`http://local/api/tasks/${taskId}/execution/actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return parseSseEvents(await response.text());
}

async function postCheckpointAction(
  server: Hono,
  taskId: string,
  checkpointId: string,
  body: Record<string, unknown>,
) {
  const response = await server.request(
    `http://local/api/tasks/${taskId}/execution/checkpoint/${checkpointId}/actions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    },
  );
  expect(response.status).toBe(200);
  return parseSseEvents(await response.text());
}

function resultFrom(events: SseEntry[]) {
  const result = events.find((entry) => entry.event === "result")?.data.result;
  expect(result).toBeDefined();
  return result as { status: string; currentNodeId: string | null; checkpoint?: { id: string; kind: string; nodeId: string | null; form?: unknown } | null };
}

function expectExecutionSse(events: SseEntry[], expectedStatus: string) {
  expect(events.map((entry) => entry.event)).toContain("status");
  expect(events.map((entry) => entry.event)).toContain("state");
  expect(events.map((entry) => entry.event)).toContain("result");
  expect(events.at(-1)?.event).toBe("done");
  expect(resultFrom(events).status).toBe(expectedStatus);

  const state = events.find((entry) => entry.event === "state")?.data;
  expect(state).toMatchObject({
    type: "state",
    effectivePlan: expect.objectContaining({ nodes: expect.any(Array) }),
  });
}

function expectRuntimeSseForNodes(events: SseEntry[], nodeIds: string[]) {
  const runtimeEvents = events
    .filter((entry) => entry.event === "runtime_event")
    .map((entry) => entry.data as { nodeId?: string; event?: { type?: string; status?: string; text?: string } });
  expect(runtimeEvents.length).toBeGreaterThan(0);

  for (const nodeId of nodeIds) {
    const nodeEvents = runtimeEvents.filter((entry) => entry.nodeId === nodeId);
    expect(nodeEvents.map((entry) => entry.event?.type)).toContain("assistant_text_delta");
    expect(nodeEvents).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: "run_status", status: "completed" }) }));
  }
}

async function expectProviderEvents(taskId: string, nodeIds: string[]) {
  const events = await db.event.findMany({
    where: { taskId, source: "provider" },
    orderBy: { ingestSequence: "asc" },
  });
  expect(events.length).toBeGreaterThanOrEqual(nodeIds.length * 4);
  expect(new Set(events.map((event: Event) => event.dedupeKey)).size).toBe(events.length);

  for (const event of events) {
    expect(event.actorType).toBe("runtime");
    expect(event.actorId).toBe("hermes");
    const payload = event.payload as { event?: { type?: string }; runId?: string; nativeRunId?: string; provider?: string };
    expect(payload.provider).toBe("hermes");
    expect(typeof payload.runId).toBe("string");
    expect(typeof payload.nativeRunId).toBe("string");
    expect(payload.event?.type).toBe(event.eventType.replace("provider.", ""));
  }

  for (const nodeId of nodeIds) {
    const nodeEvents = events.filter((event: Event) => event.nodeId === nodeId);
    expect(nodeEvents.map((event: Event) => event.eventType)).toEqual(expect.arrayContaining([
      "provider.run_started",
      "provider.text_delta",
      "provider.tool_completed",
      "provider.run_completed",
    ]));
    expect(nodeEvents.every((event: Event) => event.nodeTitle && event.runId)).toBe(true);
  }
}

async function expectNoProviderEventsForNode(taskId: string, nodeId: string) {
  const count = await db.event.count({ where: { taskId, source: "provider", nodeId } });
  expect(count).toBe(0);
}

async function expectConversationHistory(taskId: string, expectedAssistantTexts: string[]) {
  const runs = await db.run.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  expect(runs.length).toBeGreaterThanOrEqual(expectedAssistantTexts.length);

  const entries = await db.conversationEntry.findMany({
    where: { runId: { in: runs.map((run: Run) => run.id) } },
    orderBy: [{ runId: "asc" }, { sequence: "asc" }],
  });
  expect(entries.filter((entry: ConversationEntry) => entry.role === "user").length).toBeGreaterThanOrEqual(expectedAssistantTexts.length);

  const assistantContents = entries
    .filter((entry: ConversationEntry) => entry.role === "assistant")
    .map((entry: ConversationEntry) => entry.content);
  for (const text of expectedAssistantTexts) {
    expect(assistantContents).toContain(text);
  }
}

async function getCurrentExecution(server: Hono, taskId: string) {
  const response = await server.request(`http://local/api/tasks/${taskId}/execution/current`);
  expect(response.status).toBe(200);
  return json<{ status: string; currentNodeId: string | null; checkpoint: unknown | null; executionSessionId?: string | null; message?: string; ui?: { currentOperationSpec?: unknown | null } }>(response);
}

async function setupModuleExecutionTest(compiledPlan: CompiledPlan, title: string) {
  const { workspaceId } = await seedWorkspace(title);
  const { taskId } = await seedTask(workspaceId, { title, status: "Ready" });
  await seedAcceptedCompiledPlan({ workspaceId, taskId, compiledPlan });
  const provider = createScriptedProviderClient();
  installMockRegistryClient(provider.client);
  return { server: app(), workspaceId, taskId, provider };
}

describe("task execution module API integration", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    aiClientRegistry.get = realGetAiClient;
  });

  it("reports accepted plans as ready to start before any execution session exists", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeSingleTaskPlan("module_ready_to_start"),
      "Module ready-to-start task",
    );

    const current = await getCurrentExecution(server, taskId);

    expect(current).toMatchObject({
      status: "started",
      currentNodeId: "task_node",
      checkpoint: null,
      message: "No active execution session.",
    });
    expect(current.executionSessionId ?? null).toBeNull();
    expect(provider.calls.startRun).toHaveLength(0);
  });

  it("executes a single task through API and records provider events, SSE, history, and current state", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeSingleTaskPlan("module_single_task"),
      "Module single task",
    );

    const events = await postExecutionAction(server, taskId, { action: "start_manual" });

    expectExecutionSse(events, "completed");
    expectRuntimeSseForNodes(events, ["task_node"]);
    expect(resultFrom(events).currentNodeId).toBeNull();
    expect(provider.calls.nodeTitles).toEqual(["Execute module task node"]);
    await expectProviderEvents(taskId, ["task_node"]);
    await expectConversationHistory(taskId, ["Execute module task node completed by module provider"]);
    await expect(getCurrentExecution(server, taskId)).resolves.toMatchObject({
      status: "completed",
      currentNodeId: null,
      checkpoint: null,
    });
  });

  it("executes dependent task chains in order and records each provider run", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeTwoTaskPlan("module_two_task"),
      "Module sequential task",
    );

    const events = await postExecutionAction(server, taskId, { action: "start_manual" });

    expectExecutionSse(events, "completed");
    expect(provider.calls.nodeTitles).toEqual([
      "Collect script requirements",
      "Finalize script specification",
    ]);
    await expectProviderEvents(taskId, ["first_task", "second_task"]);
    await expectConversationHistory(taskId, [
      "Collect script requirements completed by module provider",
      "Finalize script specification completed by module provider",
    ]);
    await expect(getCurrentExecution(server, taskId)).resolves.toMatchObject({ status: "completed" });
  });

  it("executes independent entry tasks once each without duplicate provider starts", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeTwoEntryTaskPlan("module_two_entry"),
      "Module independent entries",
    );

    const events = await postExecutionAction(server, taskId, { action: "start_manual" });

    expectExecutionSse(events, "completed");
    expect(provider.calls.nodeTitles.toSorted((left, right) => left.localeCompare(right))).toEqual([
      "Collect architecture facts",
      "Collect documentation facts",
    ]);
    expect(new Set(provider.calls.nodeTitles).size).toBe(2);
    await expectProviderEvents(taskId, ["first_entry", "second_entry"]);
    await expect(getCurrentExecution(server, taskId)).resolves.toMatchObject({ status: "completed" });
  });

  it("routes AI condition branches by branchRef and does not call provider for skipped branches", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeAiConditionBranchPlan("module_ai_branch"),
      "Module AI branch",
    );

    const events = await postExecutionAction(server, taskId, { action: "start_manual" });

    expectExecutionSse(events, "completed");
    expect(provider.calls.nodeTitles).toEqual([
      "Prepare execution context",
      "Choose execution route",
      "Run approved branch",
    ]);
    expect(provider.calls.nodeTitles).not.toContain("Skipped alternate branch");
    await expectProviderEvents(taskId, ["prepare_task", "route_condition", "approved_task"]);
    await expectNoProviderEventsForNode(taskId, "skipped_task");
    await expectConversationHistory(taskId, [
      "Prepare execution context completed by module provider",
      "Choose execution route completed by module provider",
      "Run approved branch completed by module provider",
    ]);
  });

  it("pauses on input checkpoint then resumes through checkpoint API into provider-backed work", async () => {
    const { server, taskId, provider } = await setupModuleExecutionTest(
      makeInputCheckpointThenTaskPlan("module_checkpoint"),
      "Module checkpoint flow",
    );

    const initialEvents = await postExecutionAction(server, taskId, { action: "start_manual" });

    expectExecutionSse(initialEvents, "waiting_for_user");
    const initialResult = resultFrom(initialEvents);
    const checkpointId = initialResult.checkpoint?.id;
    expect(typeof checkpointId).toBe("string");
    expect(initialResult).toMatchObject({
      currentNodeId: "requirements_checkpoint",
      checkpoint: expect.objectContaining({
        kind: "user_input",
        nodeId: "requirements_checkpoint",
        form: expect.objectContaining({ inputFields: expect.any(Array) }),
      }),
    });
    expect(provider.calls.nodeTitles).toEqual([]);

    const currentBeforeInput = await getCurrentExecution(server, taskId);
    expect(currentBeforeInput).toMatchObject({ status: "waiting_for_user", currentNodeId: "requirements_checkpoint" });
    expect(currentBeforeInput.checkpoint).toMatchObject({
      id: checkpointId,
      kind: "user_input",
      nodeId: "requirements_checkpoint",
    });
    expect(currentBeforeInput.ui?.currentOperationSpec).toMatchObject({ root: "root", elements: expect.any(Object) });

    const checkpointEvents = await postCheckpointAction(server, taskId, checkpointId!, {
      action: "submit_input",
      payload: {
        inputFields: {
          location_scope: "Berlin",
          output_format: "Markdown",
        },
      },
    });

    expectExecutionSse(checkpointEvents, "completed");
    expectRuntimeSseForNodes(checkpointEvents, ["spec_task"]);
    expect(provider.calls.nodeTitles).toEqual(["Finalize checkpoint-driven specification"]);
    await expectProviderEvents(taskId, ["spec_task"]);
    await expectConversationHistory(taskId, ["Finalize checkpoint-driven specification completed by module provider"]);
    await expect(getCurrentExecution(server, taskId)).resolves.toMatchObject({
      status: "completed",
      currentNodeId: null,
      checkpoint: null,
    });
  });
});
