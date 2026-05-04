/**
 * API tests: POST /run, /retry, /input
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { RunStatus, TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { provideInput, retryRun, startRun } from "@chrona/engine";
import { resetTestDb, seedWorkspace, seedTask, json } from "../../__tests__/bun-test-helpers";

// ---------------------------------------------------------------------------
// Fake OpenClaw adapter for run/input tests (no syncRunFromRuntime called)
// ---------------------------------------------------------------------------
function fakeAdapterForCreateRun() {
  return {
    async createRun(input: { prompt: string; runtimeInput: Record<string, unknown>; runtimeSessionKey?: string }) {
      return {
        runtimeRunRef: "run-bridge-ref-001",
        runtimeSessionKey: input.runtimeSessionKey ?? "agent:main:test",
        runtimeSessionRef: "agent:main:dashboard:bridge-ref-001",
        runStarted: true,
      };
    },
    async sendOperatorMessage() {
      throw new Error("not used in these tests");
    },
    async getRunSnapshot() {
      throw new Error("not used in these tests");
    },
    async readHistory() {
      throw new Error("not used in these tests");
    },
    async listApprovals() {
      return [] as Array<Record<string, unknown>>;
    },
    async waitForApprovalDecision() {
      return null;
    },
    async resumeRun() {
      return { accepted: true };
    },
    async executeTask() {
      throw new Error("not used in these tests");
    },
    async getSessionStatus() {
      throw new Error("not used in these tests");
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Test router
// ---------------------------------------------------------------------------
function createExecutionRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/run", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));
      const adapter = fakeAdapterForCreateRun() as any as Parameters<typeof startRun>[0]["adapter"];
      const result = await startRun({ taskId, prompt: body.prompt, adapter });
      return c.json(result, 201);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/tasks/:taskId/retry", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));
      const adapter = fakeAdapterForCreateRun() as any as Parameters<typeof startRun>[0]["adapter"];
      const result = await retryRun({ taskId, prompt: body.prompt, adapter });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record|has never run/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/tasks/:taskId/input", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { inputText, runId } = body as { inputText?: string; runId?: string };

      if (!inputText || !inputText.trim()) return c.json({ error: "inputText is required" }, 400);

      const targetRunId = runId ?? (await db.run.findFirst({
        where: { taskId, status: RunStatus.WaitingForInput },
        orderBy: { createdAt: "desc" },
      }))?.id;

      if (!targetRunId) return c.json({ error: "No run waiting for input found for this task." }, 400);

      const adapter = {
        ...fakeAdapterForCreateRun(),
        async resumeRun() {
          return { accepted: true };
        },
        async getRunSnapshot() {
          return { runtimeRunRef: "run-bridge-ref-001", runtimeSessionKey: "session-001", status: "Running" } as const;
        },
        async readHistory() {
          return { messages: [] };
        },
      };

      const result = await provideInput({ runId: targetRunId, inputText, adapter: adapter as any });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/no longer exists/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createExecutionRouter());
  return a;
}

// ---------------------------------------------------------------------------
// POST /run
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/run", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a run and returns 201", async () => {
    const { workspaceId } = await seedWorkspace("Run Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Start Run Task",
      status: "Ready",
    });

    // Ensure task is runnable
    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Test prompt" },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await json<{ taskId: string; workspaceId: string; runId: string; runtimeRunRef: string | null }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.runId).toBeTruthy();
    expect(body.runtimeRunRef).toBe("run-bridge-ref-001");
  });

  it("returns 201 with override prompt", async () => {
    const { workspaceId } = await seedWorkspace("Override Prompt");
    const { taskId } = await seedTask(workspaceId, {
      title: "Override Prompt Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Stored prompt" },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Override prompt" }),
    });

    expect(res.status).toBe(201);
  });

  it("returns 404 for a nonexistent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await json<{ error: string }>(res);
    expect(body.error).toBeTruthy();
  });

  it("saves triggeredBy=user in the new run record", async () => {
    const { workspaceId } = await seedWorkspace("Triggered By");
    const { taskId } = await seedTask(workspaceId, {
      title: "Triggered By Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt" },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await json<{ runId: string }>(res);

    const run = await db.run.findUniqueOrThrow({ where: { id: body.runId } });
    expect(run.triggeredBy).toBe("user");
  });

  it("updates task status to Running after start", async () => {
    const { workspaceId } = await seedWorkspace("Status Running");
    const { taskId } = await seedTask(workspaceId, {
      title: "Status Running Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt" },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe(TaskStatus.Running);
  });

  it("records a run.started canonical event", async () => {
    const { workspaceId } = await seedWorkspace("Event Record");
    const { taskId } = await seedTask(workspaceId, {
      title: "Event Record Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt" },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const event = await db.event.findFirst({
      where: { taskId, eventType: "run.started" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.triggered_by).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// POST /retry
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/retry", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("retries a Completed run and returns 200", async () => {
    const { workspaceId } = await seedWorkspace("Retry Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Retry Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt" },
    });

    // Create a completed run first
    await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "prior-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; runId: string; runtimeRunRef: string | null }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBeTruthy();
    expect(body.runtimeRunRef).toBe("run-bridge-ref-001");
  });

  it("retries a Failed run", async () => {
    const { workspaceId } = await seedWorkspace("Retry Failed");
    const { taskId } = await seedTask(workspaceId, {
      title: "Retry Failed Task",
      status: "Ready",
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt" },
    });

    await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "prior-failed-ref",
        status: RunStatus.Failed,
        triggeredBy: "user",
        errorSummary: "Something went wrong",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ runId: string }>(res);
    expect(body.runId).toBeTruthy();
  });

  it("returns 404 when task has no previous run", async () => {
    const { workspaceId } = await seedWorkspace("Retry No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "Never Run Task",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("returns 500 when run is still Running", async () => {
    const { workspaceId } = await seedWorkspace("Retry Running");
    const { taskId } = await seedTask(workspaceId, {
      title: "Still Running Task",
      status: "Running",
    });

    await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "running-ref",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /input
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/input", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("provides input to a WaitingForInput run", async () => {
    const { workspaceId } = await seedWorkspace("Input Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Input Task",
      status: TaskStatus.WaitingForInput,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-input-ref",
        runtimeSessionRef: "session-input-ref",
        status: RunStatus.WaitingForInput,
        triggeredBy: "user",
        pendingInputPrompt: "Enter file path",
        pendingInputType: "text",
      },
    });

    // task session needed for resumeRun
    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-input-ref",
        status: "waiting_for_input",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: "My input", runId: run.id }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(run.id);
  });

  it("returns 400 when inputText is missing", async () => {
    const { workspaceId } = await seedWorkspace("Input Missing");
    const { taskId } = await seedTask(workspaceId, {
      title: "Input Missing Task",
      status: TaskStatus.WaitingForInput,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-input-missing",
        runtimeSessionRef: "session-input-missing",
        status: RunStatus.WaitingForInput,
        triggeredBy: "user",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when inputText is empty", async () => {
    const { workspaceId } = await seedWorkspace("Input Empty");
    const { taskId } = await seedTask(workspaceId, {
      title: "Input Empty Task",
      status: TaskStatus.WaitingForInput,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-input-empty",
        runtimeSessionRef: "session-input-empty",
        status: RunStatus.WaitingForInput,
        triggeredBy: "user",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: "  ", runId: run.id }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when no run is waiting for input (auto-discover)", async () => {
    const { workspaceId } = await seedWorkspace("Input No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "No Input Run",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: "Some input" }),
    });

    expect(res.status).toBe(400);
  });
});
