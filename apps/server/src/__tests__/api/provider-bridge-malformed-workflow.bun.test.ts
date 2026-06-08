import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { RunStatus } from "@chrona/db/generated/prisma/client";
import type { CompiledPlan, TaskConfig } from "@chrona/contracts/ai";
import { createChronaEngine } from "@chrona/engine";
import { aiClientRegistry } from "@chrona/engine/modules/ai/runtime/client-registry";
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
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

const realGetAiClient = aiClientRegistry.get.bind(aiClientRegistry);

type ResultEvent = { event: string; data: Record<string, unknown> };

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

function parseSseEvents(text: string): ResultEvent[] {
  return text
    .trim()
    .split(/\n\n+/)
    .map((chunk) => {
      const event = chunk.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      return data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((entry): entry is ResultEvent => entry !== null);
}

function singleTaskPlan(id: string): CompiledPlan {
  return {
    id: `${id}-compiled`,
    editablePlanId: id,
    sourceVersion: 1,
    title: "Malformed provider bridge plan",
    goal: "Exercise provider failure boundaries through the public execution API",
    assumptions: [],
    nodes: [{
      id: "provider-task",
      localId: "provider-task",
      type: "task",
      title: "Call malformed provider",
      description: "The provider returns a failed stream event.",
      config: { expectedOutput: "Provider output" } satisfies TaskConfig,
      dependencies: [],
      dependents: [],
      executor: "ai",
      mode: "auto",
    }],
    edges: [],
    entryNodeIds: ["provider-task"],
    terminalNodeIds: ["provider-task"],
    topologicalOrder: ["provider-task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function createMalformedProviderClient(message: string) {
  const calls = {
    startRun: [] as Array<Parameters<AgentProviderClient["startRun"]>[0]>,
    streamRun: [] as Array<Parameters<AgentProviderClient["streamRun"]>[0]>,
  };
  let run: ProviderRunRef | null = null;

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
      return { provider: "hermes", ok: true, checkedAt: new Date().toISOString() };
    },
    async createSession(): Promise<ProviderSessionRef> {
      return { provider: "hermes", sessionId: "malformed-provider-session", createdAt: new Date().toISOString() };
    },
    async startRun(request): Promise<ProviderRunRef> {
      calls.startRun.push(request);
      run = {
        provider: "hermes",
        runId: "malformed-provider-run",
        nativeRunId: "native-malformed-provider-run",
        sessionId: request.sessionId,
        status: "running",
      };
      return run;
    },
    async *streamRun(request): AsyncIterable<ProviderRunEvent> {
      calls.streamRun.push(request);
      if (!run) throw new Error("Provider run was not started");

      yield {
        type: "run_failed",
        provider: "hermes",
        runId: run.runId,
        nativeRunId: run.nativeRunId,
        sessionId: run.sessionId,
        sequence: 1,
        timestamp: new Date().toISOString(),
        run: { ...run, status: "failed" },
        error: message,
      };
    },
    async getRun(input): Promise<ProviderRunSnapshot> {
      return { provider: "hermes", runId: input.runId, sessionId: input.sessionId, status: "failed", error: message };
    },
    async cancelRun(input): Promise<ProviderRunSnapshot> {
      return { provider: "hermes", runId: input.runId, sessionId: input.sessionId, status: "cancelled" };
    },
  };

  return { client, calls };
}

function installProviderClient(providerClient: AgentProviderClient) {
  aiClientRegistry.get = (async () => ({
    record: { type: "hermes" },
    providerClient,
  }) as any) as typeof aiClientRegistry.get;
}

async function seedAcceptedPlan() {
  const { workspaceId } = await seedWorkspace("Malformed provider bridge workflow");
  const { taskId } = await seedTask(workspaceId, { title: "Malformed provider task", status: "Ready" });
  await saveCompiledPlan({
    workspaceId,
    taskId,
    compiledPlan: singleTaskPlan("malformed-provider-plan"),
    status: "accepted",
    prompt: "Malformed provider prompt",
    summary: "Malformed provider summary",
    generatedBy: "provider-bridge-malformed-test",
  });
  return { taskId };
}

describe("provider bridge malformed response workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    aiClientRegistry.get = realGetAiClient;
  });

  it("surfaces malformed provider failures through execution SSE without completing the task", async () => {
    const { taskId } = await seedAcceptedPlan();
    const provider = createMalformedProviderClient("malformed provider payload");
    installProviderClient(provider.client);

    const response = await app().request(`http://local/api/tasks/${taskId}/execution/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ action: "start_manual" }),
    });
    const events = parseSseEvents(await response.text());
    const result = events.find((entry) => entry.event === "result")?.data.result as { status?: string; error?: string } | undefined;

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ status: "failed" });
    expect(JSON.stringify(result)).toContain("malformed provider payload");
    expect(provider.calls.startRun).toHaveLength(1);
    expect(provider.calls.streamRun).toHaveLength(1);

    const run = await db.run.findFirstOrThrow({ where: { taskId }, orderBy: { createdAt: "desc" } });
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const providerEvent = await db.event.findFirstOrThrow({ where: { taskId, eventType: "provider.run_failed" } });

    expect(run.status).toBe(RunStatus.Failed);
    expect(task.status).toBe("Blocked");
    expect(providerEvent.payload).toMatchObject({ event: { type: "run_failed", error: "malformed provider payload" } });
  });
});
