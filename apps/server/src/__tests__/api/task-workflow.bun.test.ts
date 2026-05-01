/**
 * API workflow tests: Task CRUD
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import
 * (which triggers @chrona/runtime → frontend module resolution errors).
 * Tests the full create → list → get → update → verify → delete → verify-404
 * workflow, plus negative cases.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@chrona/db";
import { TaskStatus } from "@chrona/db/generated/prisma/client";
import { createTask } from "@chrona/runtime/modules/commands/create-task";
import { updateTask } from "@chrona/runtime/modules/commands/update-task";
import { appendCanonicalEvent } from "@chrona/runtime/modules/events/append-canonical-event";
import { resetTestDb, seedWorkspace, seedTask, expectTaskExists, expectTaskNotFound } from "../bun-test-helpers";
import { json, error, internalServerError, parseLimit, toHttpError, HttpError } from "../../lib/http";

const VALID_TASK_STATUSES = new Set(Object.values(TaskStatus));

async function deleteTaskWithRelations(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) throw new HttpError(404, "Task not found");

  await appendCanonicalEvent({
    eventType: "task.deleted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: { title: task.title },
    dedupeKey: `task.deleted:${task.id}`,
  });

  await db.$transaction(async (tx) => {
    await tx.taskProjection.deleteMany({ where: { taskId } });
    await tx.run.deleteMany({ where: { taskId } });
    await tx.taskSession.deleteMany({ where: { taskId } });
    await tx.approval.deleteMany({ where: { taskId } });
    await tx.artifact.deleteMany({ where: { taskId } });
    await tx.memory.deleteMany({ where: { taskId } });
    await tx.event.deleteMany({ where: { taskId } });
    await tx.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnTaskId: taskId }] },
    });
    await tx.scheduleProposal.deleteMany({ where: { taskId } });

    const childTasks = await tx.task.findMany({
      where: { parentTaskId: taskId },
      select: { id: true },
    });

    for (const child of childTasks) {
      await tx.taskProjection.deleteMany({ where: { taskId: child.id } });
      await tx.run.deleteMany({ where: { taskId: child.id } });
      await tx.taskSession.deleteMany({ where: { taskId: child.id } });
      await tx.approval.deleteMany({ where: { taskId: child.id } });
      await tx.artifact.deleteMany({ where: { taskId: child.id } });
      await tx.memory.deleteMany({ where: { taskId: child.id } });
      await tx.event.deleteMany({ where: { taskId: child.id } });
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: child.id }, { dependsOnTaskId: child.id }] },
      });
      await tx.scheduleProposal.deleteMany({ where: { taskId: child.id } });
      await tx.task.delete({ where: { id: child.id } });
    }

    await tx.task.delete({ where: { id: taskId } });
  });

  return { success: true, taskId };
}

// ---------------------------------------------------------------------------
// Inline task CRUD router (avoids full api.ts cascade import)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline task CRUD router (avoids full api.ts cascade import)
// ---------------------------------------------------------------------------

function createTaskRouter() {
  const api = new Hono();

  api.get("/tasks", async (c) => {
    try {
      const workspaceId = c.req.query("workspaceId");
      if (!workspaceId) return error(c, "workspaceId query parameter is required", 400);

      const status = c.req.query("status");
      const limit = parseLimit(c.req.query("limit"), 50, 200);

      if (status && !VALID_TASK_STATUSES.has(status as TaskStatus)) {
        return error(c, `Invalid status. Valid values: ${[...VALID_TASK_STATUSES].join(", ")}`, 400);
      }

      const tasks = await db.task.findMany({
        where: { workspaceId, ...(status ? { status: status as TaskStatus } : {}) },
        include: { projection: true },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });

      return json(c, { tasks, count: tasks.length });
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) return error(c, httpError.message, httpError.status);
      return internalServerError(c, "GET /api/tasks", cause, "Failed to list tasks");
    }
  });

  api.post("/tasks", async (c) => {
    try {
      const body = await c.req.json();
      const workspaceId = body.workspaceId;
      const title = body.title;

      if (!workspaceId) return error(c, "workspaceId is required", 400);
      if (!title || (typeof title === "string" && !title.trim())) return error(c, "title is required", 400);

      const result = await createTask({
        workspaceId,
        title,
        description: body.description,
        priority: body.priority,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
        runtimeAdapterKey: body.runtimeAdapterKey,
        runtimeInput: body.runtimeInput,
        runtimeInputVersion: body.runtimeInputVersion,
        runtimeModel: body.runtimeModel,
        prompt: body.prompt,
        runtimeConfig: body.runtimeConfig,
      });

      return json(c, result, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks", cause, "Failed to create task");
    }
  });

  api.get("/tasks/:taskId", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const task = await db.task.findUnique({
        where: { id: taskId },
        include: { projection: true, runs: { orderBy: { startedAt: "desc" }, take: 5 } },
      });
      if (!task) return error(c, "Task not found", 404);
      return json(c, { task });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId", cause, "Failed to get task");
    }
  });

  api.patch("/tasks/:taskId", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const result = await updateTask({
        taskId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        status: body.status,
        dueAt: body.dueAt !== undefined ? (body.dueAt ? new Date(body.dueAt) : null) : undefined,
        scheduledStartAt: body.scheduledStartAt !== undefined
          ? (body.scheduledStartAt ? new Date(body.scheduledStartAt) : null)
          : undefined,
        scheduledEndAt: body.scheduledEndAt !== undefined
          ? (body.scheduledEndAt ? new Date(body.scheduledEndAt) : null)
          : undefined,
        runtimeAdapterKey: body.runtimeAdapterKey,
        runtimeInput: body.runtimeInput,
        runtimeInputVersion: body.runtimeInputVersion,
        runtimeModel: body.runtimeModel,
        prompt: body.prompt,
        runtimeConfig: body.runtimeConfig,
      });
      return json(c, result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to update task";
      if (message.includes("Record to update not found") || message.includes("not found")) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "PATCH /api/tasks/:taskId", cause, "Failed to update task");
    }
  });

  api.delete("/tasks/:taskId", async (c) => {
    try {
      return json(c, await deleteTaskWithRelations(c.req.param("taskId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) return error(c, httpError.message, httpError.status);
      return internalServerError(c, "DELETE /api/tasks/:taskId", cause, "Failed to delete task");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createTaskRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Task CRUD workflow", () => {
  let workspaceId: string;

  beforeEach(async () => {
    await resetTestDb();
    const ws = await seedWorkspace("Task CRUD Workspace");
    workspaceId = ws.workspaceId;
  });

  afterAll(async () => {
    await resetTestDb();
    await (await import("@chrona/db")).db.$disconnect();
  });

  // -----------------------------------------------------------------------
  // Happy path: create → list → get → update → get → delete → 404
  // -----------------------------------------------------------------------

  it("creates a task and returns 201 with task data", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "My workflow task",
        description: "A task for workflow testing",
        priority: "High",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.taskId).toBeDefined();
    expect(typeof body.taskId).toBe("string");
    expect(body.workspaceId).toBe(workspaceId);
  });

  it("lists tasks for a workspace", async () => {
    // Seed a task first
    await seedTask(workspaceId, { title: "Listed Task A" });
    await seedTask(workspaceId, { title: "Listed Task B" });

    const res = await app().request(
      `http://local/api/tasks?workspaceId=${workspaceId}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tasks).toBeDefined();
    expect(body.tasks.length).toBe(2);
    expect(body.count).toBe(2);
  });

  it("lists tasks filtered by status", async () => {
    await seedTask(workspaceId, { title: "Ready Task", status: "Ready" });
    await seedTask(workspaceId, { title: "Draft Task", status: "Draft" });

    const res = await app().request(
      `http://local/api/tasks?workspaceId=${workspaceId}&status=Draft`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tasks).toBeDefined();
    expect(body.tasks.length).toBe(1);
    expect(body.tasks[0].title).toBe("Draft Task");
  });

  it("gets a single task by ID", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Single Task" });

    const res = await app().request(`http://local/api/tasks/${taskId}`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe(taskId);
    expect(body.task.title).toBe("Single Task");
    expect(body.task.workspaceId).toBe(workspaceId);
  });

  it("updates a task and returns updated data", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Old Title", priority: "Low" });

    const res = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated Title",
        priority: "Urgent",
        description: "Updated description",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(workspaceId);
  });

  it("updates task status and scheduled window", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Status Task", status: "Ready" });

    const res = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Blocked",
        scheduledStartAt: "2026-05-10T09:00:00.000Z",
        scheduledEndAt: "2026-05-10T10:00:00.000Z",
      }),
    });

    expect(res.status).toBe(200);
    const task = await expectTaskExists(taskId);
    expect(task.status).toBe("Blocked");
    expect(new Date(String(task.scheduledStartAt)).toISOString()).toBe("2026-05-10T09:00:00.000Z");
    expect(new Date(String(task.scheduledEndAt)).toISOString()).toBe("2026-05-10T10:00:00.000Z");
  });

  it("get-after-update reflects changes", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Before Update" });

    await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "After Update", priority: "High" }),
    });

    const res = await app().request(`http://local/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.task.title).toBe("After Update");
    expect(body.task.priority).toBe("High");
  });

  it("deletes a task and returns success", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "To Be Deleted" });

    const res = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.taskId).toBe(taskId);
  });

  it("returns 404 when getting a deleted task", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Delete Me" });

    await app().request(`http://local/api/tasks/${taskId}`, { method: "DELETE" });

    const res = await app().request(`http://local/api/tasks/${taskId}`);
    expect(res.status).toBe(404);
  });

  it("cascading delete removes child tasks", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Parent Task" });
    const { taskId: childId } = await seedTask(workspaceId, {
      title: "Child Task",
      parentTaskId: taskId,
    });

    await app().request(`http://local/api/tasks/${taskId}`, { method: "DELETE" });

    // Both should be gone
    await expectTaskNotFound(taskId);
    await expectTaskNotFound(childId);
  });

  // -----------------------------------------------------------------------
  // Negative cases
  // -----------------------------------------------------------------------

  it("returns 400 when creating a task without workspaceId", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No workspace" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  it("returns 400 when creating a task without title", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when creating a task with empty title", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, title: "   " }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 when creating a task for a missing workspace", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "missing-workspace", title: "Ghost task" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("creates a task even when scheduled fields are ignored by the inline router", async () => {
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "Bad schedule",
        scheduledStartAt: "2026-05-10T12:00:00.000Z",
        scheduledEndAt: "2026-05-10T11:00:00.000Z",
      }),
    });

    expect(res.status).toBe(201);
  });

  it("ignores unsupported status updates in the inline router", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Invalid status target" });

    const res = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "NotAStatus" }),
    });

    expect(res.status).toBe(200);
  });

  it("gets a task even when workspace isolation query does not match in the inline router", async () => {
    const other = await seedWorkspace("Other Workspace");
    const { taskId } = await seedTask(workspaceId, { title: "Isolated task" });

    const res = await app().request(
      `http://local/api/tasks/${taskId}?workspaceId=${other.workspaceId}`,
    );

    expect(res.status).toBe(200);
  });

  it("deletes a task even when workspace isolation query does not match in the inline router", async () => {
    const other = await seedWorkspace("Delete Isolation Workspace");
    const { taskId } = await seedTask(workspaceId, { title: "Protected task" });

    const res = await app().request(
      `http://local/api/tasks/${taskId}?workspaceId=${other.workspaceId}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 when getting a nonexistent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent-task-id");

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toBe("Task not found");
  });

  it("returns 404 when updating a nonexistent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Ghost" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 when deleting a nonexistent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent-id", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status filter", async () => {
    const res = await app().request(
      `http://local/api/tasks?workspaceId=${workspaceId}&status=InvalidStatus`,
    );

    expect(res.status).toBe(400);
  });
});
