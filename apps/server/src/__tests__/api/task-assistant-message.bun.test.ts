import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import {
  resetTestDb,
  seedWorkspace,
  seedTask,
  expectApiError,
  json,
} from "../bun-test-helpers";
import { error, internalServerError, json as httpJson } from "../../lib/http";

function createAssistantMessageRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/assistant/messages", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { role, content, proposal } = body as {
        role: string;
        content: string;
        proposal?: Record<string, unknown> | null;
      };

      if (!role || !content) {
        return error(c, "role and content are required", 400);
      }
      if (role !== "user" && role !== "assistant") {
        return error(c, "role must be 'user' or 'assistant'", 400);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const lastMsg = await db.taskAssistantMessage.findFirst({
        where: { taskId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (lastMsg?.sequence ?? -1) + 1;

      const message = await db.taskAssistantMessage.create({
        data: {
          taskId,
          role,
          content,
          proposal: (proposal ?? null) as any,
          sequence,
        },
      });

      return httpJson(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ?? null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks/:taskId/assistant/messages", cause, "Failed to save message");
    }
  });

  api.get("/tasks/:taskId/assistant/messages", async (c) => {
    try {
      const taskId = c.req.param("taskId");

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const messages = await db.taskAssistantMessage.findMany({
        where: { taskId },
        orderBy: { sequence: "asc" },
      });

      return httpJson(c, {
        messages: messages.map((m) => ({
          id: m.id,
          taskId: m.taskId,
          role: m.role,
          content: m.content,
          proposal: m.proposal ?? null,
          applied: m.applied,
          appliedAt: m.appliedAt,
          sequence: m.sequence,
          createdAt: m.createdAt,
        })),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId/assistant/messages", cause, "Failed to fetch messages");
    }
  });

  api.patch("/tasks/:taskId/assistant/messages/:messageId/apply", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const messageId = c.req.param("messageId");

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const existing = await db.taskAssistantMessage.findFirst({
        where: { id: messageId, taskId },
      });
      if (!existing) return error(c, "Message not found", 404);

      const message = await db.taskAssistantMessage.update({
        where: { id: messageId },
        data: { applied: true, appliedAt: new Date() },
      });

      return httpJson(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ?? null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      });
    } catch (cause) {
      return internalServerError(c, "PATCH /api/tasks/:taskId/assistant/messages/:messageId/apply", cause, "Failed to mark applied");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createAssistantMessageRouter());
  return a;
}

describe("TaskAssistantMessage", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // ── Happy path: POST create messages ──────────────────────────────────

  it("creates a user message and returns 201", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: "Hello, can you help?" }),
      },
    );

    expect(res.status).toBe(201);
    const body = await json<{
      id: string; taskId: string; role: string; content: string;
      proposal: unknown; applied: boolean; appliedAt: string | null;
      sequence: number; createdAt: string;
    }>(res);
    expect(body.id).toBeDefined();
    expect(body.taskId).toBe(taskId);
    expect(body.role).toBe("user");
    expect(body.content).toBe("Hello, can you help?");
    expect(body.applied).toBe(false);
    expect(body.appliedAt).toBeNull();
    expect(body.sequence).toBe(0);
  });

  it("creates an assistant message with proposal", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const proposal = { summary: "Move task to afternoon", confidence: "high", requiresConfirmation: true };
    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: "I suggest rescheduling.", proposal }),
      },
    );

    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body.role).toBe("assistant");
    expect(body.proposal).toEqual(proposal);
  });

  it("auto-increments sequence per task", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const r1 = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content: "msg1" }) },
    );
    const b1 = await json<any>(r1);
    expect(b1.sequence).toBe(0);

    const r2 = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant", content: "msg2" }) },
    );
    const b2 = await json<any>(r2);
    expect(b2.sequence).toBe(1);
  });

  // ── Happy path: GET list messages ─────────────────────────────────────

  it("lists all messages for a task ordered by sequence asc", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content: "First" }) },
    );
    await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant", content: "Second" }) },
    );

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    const body = await json<{ messages: Array<{ sequence: number; content: string }> }>(res);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe("First");
    expect(body.messages[1].content).toBe("Second");
  });

  it("returns empty message list for task with no messages", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    const body = await json<{ messages: unknown[] }>(res);
    expect(body.messages).toEqual([]);
  });

  // ── Happy path: PATCH apply message ───────────────────────────────────

  it("marks a message as applied", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant", content: "Suggestion" }) },
    );
    const msg = await json<{ id: string }>(createRes);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages/${msg.id}/apply`,
      { method: "PATCH" },
    );

    expect(res.status).toBe(200);
    const body = await json<{ applied: boolean; appliedAt: string }>(res);
    expect(body.applied).toBe(true);
    expect(body.appliedAt).toBeDefined();
    expect(new Date(body.appliedAt).getTime()).toBeGreaterThan(0);
  });

  // ── Negative cases ────────────────────────────────────────────────────

  it("returns 400 when role or content are missing", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
    );
    await expectApiError(res, 400);
  });

  it("returns 400 when role is invalid", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin", content: "test" }) },
    );
    await expectApiError(res, 400);
  });

  it("returns 404 for nonexistent task on POST", async () => {
    const res = await app().request(
      "http://local/api/tasks/nonexistent/assistant/messages",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content: "test" }) },
    );
    await expectApiError(res, 404);
  });

  it("returns 404 for nonexistent task on GET", async () => {
    const res = await app().request(
      "http://local/api/tasks/nonexistent/assistant/messages",
      { method: "GET" },
    );
    await expectApiError(res, 404);
  });

  it("returns 404 for nonexistent task on PATCH apply", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content: "msg" }) },
    );
    const msg = await json<{ id: string }>(createRes);

    const res = await app().request(
      `http://local/api/tasks/nonexistent/assistant/messages/${msg.id}/apply`,
      { method: "PATCH" },
    );
    await expectApiError(res, 404);
  });

  it("returns 404 when message does not belong to task on PATCH", async () => {
    const ws = await seedWorkspace();
    const { taskId: taskA } = await seedTask(ws.workspaceId, { title: "Task A" });
    const { taskId: taskB } = await seedTask(ws.workspaceId, { title: "Task B" });

    const createRes = await app().request(
      `http://local/api/tasks/${taskA}/assistant/messages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content: "msg" }) },
    );
    const msg = await json<{ id: string }>(createRes);

    const res = await app().request(
      `http://local/api/tasks/${taskB}/assistant/messages/${msg.id}/apply`,
      { method: "PATCH" },
    );
    await expectApiError(res, 404);
  });
});
