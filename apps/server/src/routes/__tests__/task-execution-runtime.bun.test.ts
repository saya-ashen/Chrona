/**
 * API tests: POST /message, /resume
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import.
 * Uses mock adapters with syncRunFromRuntime-compatible snapshots.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { RunStatus, TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { resumeRun, sendOperatorMessage } from "@chrona/engine";
import { resetTestDb, seedWorkspace, seedTask, json } from "../../__tests__/bun-test-helpers";

// ---------------------------------------------------------------------------
// Fake adapter that also provides syncRunFromRuntime-compatible methods
// ---------------------------------------------------------------------------
function fakeAdapterForMessage(runRef: string, sessionKey: string) {
  return {
    async createRun() {
      throw new Error("not used");
    },
    async sendOperatorMessage(input: { runtimeSessionKey: string; message: string }) {
      return {
        accepted: true,
        runtimeRunRef: runRef,
        runtimeSessionKey: input.runtimeSessionKey ?? sessionKey,
        runStarted: false,
      };
    },
    async getRunSnapshot() {
      return {
        runtimeRunRef: runRef,
        runtimeSessionKey: sessionKey,
        status: "Running" as const,
      };
    },
    async readHistory() {
      return {
        messages: [
          {
            role: "user",
            content: "Test message",
            timestamp: new Date().toISOString(),
            __openclaw: { seq: 1, id: "msg-001" },
          },
        ],
      };
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
      throw new Error("not used");
    },
    async getSessionStatus() {
      throw new Error("not used");
    },
  } as const;
}

function fakeAdapterForResume(sessionKey: string) {
  return {
    async createRun() {
      throw new Error("not used");
    },
    async sendOperatorMessage() {
      throw new Error("not used");
    },
    async resumeRun() {
      return { accepted: true, runtimeRunRef: "resumed-ref", runtimeSessionKey: sessionKey };
    },
    async getRunSnapshot() {
      return {
        runtimeRunRef: "resumed-ref",
        runtimeSessionKey: sessionKey,
        status: "Running" as const,
      };
    },
    async readHistory() {
      return { messages: [] };
    },
    async listApprovals() {
      return [] as Array<Record<string, unknown>>;
    },
    async waitForApprovalDecision() {
      return null;
    },
    async executeTask() {
      throw new Error("not used");
    },
    async getSessionStatus() {
      throw new Error("not used");
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Test router
// ---------------------------------------------------------------------------
function createRuntimeRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/message", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { message, runId } = body as { message?: string; runId?: string };

      if (!message || !message.trim()) return c.json({ error: "message is required" }, 400);

      const targetRunId = runId ?? (await db.run.findFirst({
        where: {
          taskId,
          status: { in: [RunStatus.Running, RunStatus.WaitingForApproval] },
        },
        orderBy: { createdAt: "desc" },
      }))?.id;

      if (!targetRunId) return c.json({ error: "No active run found for this task." }, 400);

      const targetRun = await db.run.findUniqueOrThrow({ where: { id: targetRunId } });
      const adapter = fakeAdapterForMessage(
        targetRun.runtimeRunRef ?? "run-ref",
        targetRun.runtimeSessionRef ?? "session-ref",
      );

      const result = await sendOperatorMessage({
        runId: targetRunId,
        message,
        adapter: adapter as any,
      });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/no longer exists/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/tasks/:taskId/resume", async (c) => {
    try {
      const _taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { runId, inputText, approvalId } = body as {
        runId?: string;
        inputText?: string;
        approvalId?: string;
      };

      if (!runId) return c.json({ error: "runId is required" }, 400);

      const adapter = fakeAdapterForResume("session-resume-ref");

      const result = await resumeRun({
        runId,
        inputText,
        approvalId,
        adapter: adapter as any,
      });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/no longer exists|Refresh the work page/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createRuntimeRouter());
  return a;
}

// ---------------------------------------------------------------------------
// POST /message
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/message", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("sends operator message to a Running run", async () => {
    const { workspaceId } = await seedWorkspace("Message Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Message Task",
      status: TaskStatus.Running,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-msg-ref",
        runtimeSessionRef: "session-msg-ref",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-msg-ref",
        status: "running",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Keep it concise.", runId: run.id }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(run.id);
  });

  it("records an operator.note_added event", async () => {
    const { workspaceId } = await seedWorkspace("Msg Event");
    const { taskId } = await seedTask(workspaceId, {
      title: "Msg Event Task",
      status: TaskStatus.Running,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-msg-ev-ref",
        runtimeSessionRef: "session-msg-ev-ref",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-msg-ev-ref",
        status: "running",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Check for errors.", runId: run.id }),
    });

    expect(res.status).toBe(200);
    const event = await db.event.findFirst({
      where: { runId: run.id, eventType: "operator.note_added" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.message).toBe("Check for errors.");
    expect((event?.payload as any)?.delivery).toBe("sent_to_runtime");
  });

  it("sends message to a WaitingForApproval run", async () => {
    const { workspaceId } = await seedWorkspace("Msg Approval");
    const { taskId } = await seedTask(workspaceId, {
      title: "Msg Approval Task",
      status: TaskStatus.WaitingForApproval,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-msg-ap-ref",
        runtimeSessionRef: "session-msg-ap-ref",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-msg-ap-ref",
        status: "waiting_for_approval",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Guidance during approval.", runId: run.id }),
    });

    expect(res.status).toBe(200);
  });

  it("returns 400 when message is empty", async () => {
    const { workspaceId } = await seedWorkspace("Msg Empty");
    const { taskId } = await seedTask(workspaceId, {
      title: "Msg Empty Task",
      status: TaskStatus.Running,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-msg-empty",
        runtimeSessionRef: "session-msg-empty",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   ", runId: run.id }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when no active run exists", async () => {
    const { workspaceId } = await seedWorkspace("Msg No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "Msg No Run Task",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello?" }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /resume
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/resume", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("resumes a WaitingForInput run", async () => {
    const { workspaceId } = await seedWorkspace("Resume Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Resume Task",
      status: TaskStatus.WaitingForInput,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-resume-ref",
        runtimeSessionRef: "session-resume-ref",
        status: RunStatus.WaitingForInput,
        triggeredBy: "user",
      },
    });

    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-resume-ref",
        status: "waiting_for_input",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id, inputText: "Here is the input" }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(run.id);
  });

  it("resumes a WaitingForApproval run", async () => {
    const { workspaceId } = await seedWorkspace("Resume Approval");
    const { taskId } = await seedTask(workspaceId, {
      title: "Resume Approval Task",
      status: TaskStatus.WaitingForApproval,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-resume-ap-ref",
        runtimeSessionRef: "session-resume-ap-ref",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-resume-ap-ref",
        status: "waiting_for_approval",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });

    expect(res.status).toBe(200);
  });

  it("updates run status to Running after resume", async () => {
    const { workspaceId } = await seedWorkspace("Resume Status");
    const { taskId } = await seedTask(workspaceId, {
      title: "Resume Status Task",
      status: TaskStatus.WaitingForInput,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-resume-st-ref",
        runtimeSessionRef: "session-resume-st-ref",
        status: RunStatus.WaitingForInput,
        triggeredBy: "user",
      },
    });

    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: "session-resume-st-ref",
        status: "waiting_for_input",
        activeRunId: run.id,
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id, inputText: "Resuming" }),
    });

    expect(res.status).toBe(200);
    const updatedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(updatedRun.status).toBe(RunStatus.Running);
    expect(updatedRun.pendingInputPrompt).toBeNull();
  });

  it("returns 400 when runId is missing", async () => {
    const { workspaceId } = await seedWorkspace("Resume No RunId");
    const { taskId } = await seedTask(workspaceId, {
      title: "No RunId Task",
      status: TaskStatus.WaitingForInput,
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 when run status is not blocked", async () => {
    const { workspaceId } = await seedWorkspace("Resume Not Blocked");
    const { taskId } = await seedTask(workspaceId, {
      title: "Not Blocked Task",
      status: TaskStatus.Running,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-not-blocked",
        runtimeSessionRef: "session-not-blocked",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });

    expect(res.status).toBe(500);
  });

  it("returns 404 when run does not exist", async () => {
    const { workspaceId } = await seedWorkspace("Resume No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "No Run Task",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "nonexistent-run-id" }),
    });

    expect(res.status).toBe(404);
  });
});
