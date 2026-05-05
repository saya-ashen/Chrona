/**
 * API tests: POST /done, /reopen, /result/accept, /follow-up, /approvals/resolve
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ApprovalStatus, RunStatus, TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import {
  acceptTaskResult,
  createFollowUpTask,
  markTaskDone,
  reopenTask,
  resolveApproval,
} from "@chrona/engine";
import { resetTestDb, seedAcceptedPlan, seedWorkspace, seedTask, json } from "../../__tests__/bun-test-helpers";

// ---------------------------------------------------------------------------
// Fake adapter for resolveApproval rejection path
// ---------------------------------------------------------------------------
function fakeAdapterForReject() {
  return {
    async createRun() {
      throw new Error("not used");
    },
    async sendOperatorMessage() {
      throw new Error("not used");
    },
    async resumeRun(input: { approvalId?: string; decision?: string }) {
      expect(input.decision).toBe("reject");
      return { accepted: true };
    },
    async getRunSnapshot() {
      return { runtimeRunRef: "run-ref", runtimeSessionKey: "session-ref", status: "Running" as const };
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
  } as const;
}

function fakeAdapterForApprove(sessionKey: string) {
  return {
    async createRun() {
      throw new Error("not used");
    },
    async sendOperatorMessage() {
      throw new Error("not used");
    },
    async resumeRun() {
      return { accepted: true, runtimeRunRef: "approved-ref", runtimeSessionKey: sessionKey };
    },
    // Return WaitingForApproval so syncRunFromRuntime's pending-approval
    // resolution logic (which calls waitForApprovalDecision) is skipped.
    async getRunSnapshot() {
      return { runtimeRunRef: "approved-ref", runtimeSessionKey: sessionKey, status: "WaitingForApproval" as const };
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
function createClosureRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/done", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const result = await markTaskDone({ taskId });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  api.post("/tasks/:taskId/reopen", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const result = await reopenTask({ taskId });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/tasks/:taskId/result/accept", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const result = await acceptTaskResult({ taskId });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  api.post("/tasks/:taskId/follow-up", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { title, dueAt, priority } = body as {
        title?: string;
        dueAt?: string;
        priority?: "Low" | "Medium" | "High" | "Urgent";
      };

      if (!title || !title.trim()) return c.json({ error: "title is required" }, 400);

      const result = await createFollowUpTask({
        taskId,
        title,
        dueAt: dueAt ? new Date(dueAt) : undefined,
        priority,
      });
      return c.json(result, 201);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/not found|No 'Task' record|No 'Run' record/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      const { decision, resolutionNote, editedContent } = body as {
        decision: "Approved" | "Rejected" | "EditedAndApproved";
        resolutionNote?: string;
        editedContent?: string;
      };

      if (!decision || !["Approved", "Rejected", "EditedAndApproved"].includes(decision)) {
        return c.json({ error: "decision is required and must be Approved, Rejected, or EditedAndApproved" }, 400);
      }

      const adapter = decision === "Rejected"
        ? fakeAdapterForReject()
        : fakeAdapterForApprove("session-approve");

      const result = await resolveApproval({
        approvalId,
        decision,
        resolutionNote,
        editedContent,
        adapter: adapter as any,
      });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/no longer exists/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createClosureRouter());
  return a;
}

// ---------------------------------------------------------------------------
// POST /done
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/done", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("marks task as Done when latest run is Completed", async () => {
    const { workspaceId } = await seedWorkspace("Done Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Done Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-done-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });

    const res = await app().request("http://local/api/tasks/" + taskId + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(workspaceId);
  });

  it("sets task status to Done and completedAt", async () => {
    const { workspaceId } = await seedWorkspace("Done Status");
    const { taskId } = await seedTask(workspaceId, {
      title: "Done Status Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-done-st-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });

    const res = await app().request("http://local/api/tasks/" + taskId + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe(TaskStatus.Done);
    expect(task.completedAt).not.toBeNull();
  });

  it("records a task.done canonical event", async () => {
    const { workspaceId } = await seedWorkspace("Done Event");
    const { taskId } = await seedTask(workspaceId, {
      title: "Done Event Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-done-ev-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });

    const res = await app().request("http://local/api/tasks/" + taskId + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const event = await db.event.findFirst({
      where: { taskId, eventType: "task.done" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.next_status).toBe("Done");
  });

  it("returns 400 when no completed run exists", async () => {
    const { workspaceId } = await seedWorkspace("Done No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "Done No Run Task",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /reopen
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/reopen", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("reopens a Done task back to Ready", async () => {
    const { workspaceId } = await seedWorkspace("Reopen Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Reopen Task",
      status: TaskStatus.Done,
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt", completedAt: new Date() },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; status: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.status).toBe("Ready");
  });

  it("clears completedAt on reopen", async () => {
    const { workspaceId } = await seedWorkspace("Reopen Clear");
    const { taskId } = await seedTask(workspaceId, {
      title: "Reopen Clear Task",
      status: TaskStatus.Done,
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt", completedAt: new Date() },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe(TaskStatus.Ready);
    expect(task.completedAt).toBeNull();
  });

  it("records a task.reopened canonical event", async () => {
    const { workspaceId } = await seedWorkspace("Reopen Event");
    const { taskId } = await seedTask(workspaceId, {
      title: "Reopen Event Task",
      status: TaskStatus.Done,
    });

    await db.task.update({
      where: { id: taskId },
      data: { runtimeModel: "gpt-5.4", prompt: "Prompt", completedAt: new Date() },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const event = await db.event.findFirst({
      where: { taskId, eventType: "task.reopened" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.previous_status).toBe("Done");
    expect((event?.payload as any)?.next_status).toBe("Ready");
  });
});

// ---------------------------------------------------------------------------
// POST /result/accept
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/result/accept", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("accepts a completed run result", async () => {
    const { workspaceId } = await seedWorkspace("Accept Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Accept Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-accept-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });

    const res = await app().request("http://local/api/tasks/" + taskId + "/result/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(run.id);
  });

  it("records a task.result_accepted event", async () => {
    const { workspaceId } = await seedWorkspace("Accept Event");
    const { taskId } = await seedTask(workspaceId, {
      title: "Accept Event Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-accept-ev-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });

    const res = await app().request("http://local/api/tasks/" + taskId + "/result/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const event = await db.event.findFirst({
      where: { taskId, eventType: "task.result_accepted" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.accepted_run_id).toBe(run.id);
  });

  it("returns 400 when no completed run exists", async () => {
    const { workspaceId } = await seedWorkspace("Accept No Run");
    const { taskId } = await seedTask(workspaceId, {
      title: "Accept No Run Task",
      status: "Ready",
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/result/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /follow-up
// ---------------------------------------------------------------------------
describe("POST /api/tasks/:taskId/follow-up", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a follow-up task with inherited config", async () => {
    const { workspaceId } = await seedWorkspace("FollowUp Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Parent Task",
      status: TaskStatus.Completed,
    });

    await db.task.update({
      where: { id: taskId },
      data: {
        runtimeAdapterKey: "openclaw",
        runtimeModel: "gpt-5.4",
        prompt: "Parent prompt",
        runtimeConfig: { temperature: 0.5 },
        runtimeInput: {
          model: "gpt-5.4",
          prompt: "Parent prompt",
          temperature: 0.5,
          sessionStrategy: "per_subtask",
          toolMode: "workspace-write",
          approvalPolicy: "never",
        },
        runtimeInputVersion: "openclaw-legacy-v1",
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Follow up remaining polish",
        priority: "High",
      }),
    });

    expect(res.status).toBe(201);
    const body = await json<{ taskId: string; workspaceId: string; followUpTaskId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.followUpTaskId).toBeTruthy();
  });

  it("inherits parent runtime config", async () => {
    const { workspaceId } = await seedWorkspace("FollowUp Inherit");
    const { taskId } = await seedTask(workspaceId, {
      title: "Inherit Parent",
      status: TaskStatus.Completed,
    });

    await db.task.update({
      where: { id: taskId },
      data: {
        runtimeAdapterKey: "openclaw",
        prompt: "Parent prompt",
        runtimeConfig: { temperature: 0.7 },
      },
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Inherited follow-up" }),
    });

    expect(res.status).toBe(201);
    const body = await json<{ followUpTaskId: string }>(res);
    const followUp = await db.task.findUniqueOrThrow({ where: { id: body.followUpTaskId } });
    expect(followUp.parentTaskId).toBe(taskId);
    expect(followUp.prompt).toBe("Parent prompt");
    expect(followUp.runtimeAdapterKey).toBe("openclaw");
    expect(followUp.status).toBe(TaskStatus.Ready);
    expect(followUp.scheduleStatus).toBe("Unscheduled");
  });

  it("returns 400 when title is missing", async () => {
    const { workspaceId } = await seedWorkspace("FollowUp No Title");
    const { taskId } = await seedTask(workspaceId, {
      title: "No Title Parent",
      status: TaskStatus.Completed,
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when title is empty", async () => {
    const { workspaceId } = await seedWorkspace("FollowUp Empty Title");
    const { taskId } = await seedTask(workspaceId, {
      title: "Empty Title Parent",
      status: TaskStatus.Completed,
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });

    expect(res.status).toBe(400);
  });

  it("records task.created and task.follow_up_created events", async () => {
    const { workspaceId } = await seedWorkspace("FollowUp Events");
    const { taskId } = await seedTask(workspaceId, {
      title: "Events Parent",
      status: TaskStatus.Completed,
    });

    const res = await app().request("http://local/api/tasks/" + taskId + "/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Follow-up with events" }),
    });

    expect(res.status).toBe(201);
    const body = await json<{ followUpTaskId: string }>(res);

    const createdEvent = await db.event.findFirst({
      where: { taskId: body.followUpTaskId, eventType: "task.created" },
    });
    expect(createdEvent).not.toBeNull();

    const followUpEvent = await db.event.findFirst({
      where: { taskId, eventType: "task.follow_up_created" },
    });
    expect(followUpEvent).not.toBeNull();
    expect((followUpEvent?.payload as any)?.follow_up_task_id).toBe(body.followUpTaskId);
  });
});

// ---------------------------------------------------------------------------
// POST /approvals/:approvalId/resolve
// ---------------------------------------------------------------------------
describe("POST /api/approvals/:approvalId/resolve", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  async function seedApproval(workspaceId: string, decision?: "Approved" | "Rejected") {
    const { taskId } = await seedTask(workspaceId, {
      title: `Approval ${decision ?? "Test"} Task`,
      status: TaskStatus.WaitingForApproval,
    });
    await seedAcceptedPlan(taskId, workspaceId);

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: `run-approval-${decision ?? "test"}`,
        runtimeSessionRef: `session-approval-${decision ?? "test"}`,
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
    await db.taskSession.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        sessionKey: `session-approval-${decision ?? "test"}`,
        status: "waiting_for_approval",
        activeRunId: run.id,
      },
    });

    const approval = await db.approval.create({
      data: {
        id: `approval-${decision ?? "test"}`,
        workspaceId,
        taskId,
        runId: run.id,
        type: "exec",
        title: "Approve operation",
        summary: "This operation needs approval",
        riskLevel: "medium",
        status: ApprovalStatus.Pending,
        requestedAt: new Date(),
      },
    });

    return { taskId, runId: run.id, approvalId: approval.id, sessionKey: `session-approval-${decision ?? "test"}` };
  }

  it("rejects a pending approval and marks run as Failed, task as Blocked", async () => {
    const { workspaceId } = await seedWorkspace("Reject Test");
    const { taskId, runId, approvalId } = await seedApproval(workspaceId, "Rejected");

    const res = await app().request("http://local/api/approvals/" + approvalId + "/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "Rejected",
        resolutionNote: "Unsafe change detected",
      }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(runId);

    const storedApproval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(storedApproval.status).toBe("Rejected");
    expect(storedApproval.resolutionNote).toBe("Unsafe change detected");

    const storedRun = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(storedRun.status).toBe(RunStatus.Failed);
    expect(storedRun.retryable).toBe(true);

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(storedTask.status).toBe(TaskStatus.Blocked);
  });

  it("records approval.resolved on approve", async () => {
    const { workspaceId } = await seedWorkspace("Approve Event");
    const { taskId, approvalId } = await seedApproval(workspaceId, "Approved");

    const res = await app().request("http://local/api/approvals/" + approvalId + "/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "Approved" }),
    });

    expect(res.status).toBe(200);

    const event = await db.event.findFirst({
      where: { taskId, eventType: "approval.resolved" },
      orderBy: { ingestSequence: "desc" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as any)?.approval_id).toBe(approvalId);
    expect((event?.payload as any)?.resolution).toBe("approved");
  });

  it("returns 400 for non-pending approval", async () => {
    const { workspaceId } = await seedWorkspace("Non Pending");
    const { approvalId } = await seedApproval(workspaceId, "Approved");

    // First approve it
    await app().request("http://local/api/approvals/" + approvalId + "/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "Approved" }),
    });

    // Try approving again
    const res = await app().request("http://local/api/approvals/" + approvalId + "/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "Approved" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent approval", async () => {
    const res = await app().request("http://local/api/approvals/nonexistent/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "Approved" }),
    });

    expect(res.status).toBe(404);
  });
});
