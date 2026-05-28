import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { createTaskBodySchema, updateTaskBodySchema } from "@chrona/contracts/api";
import { createTask } from "@chrona/engine/modules/tasks/create-task";
import { updateTask } from "@chrona/engine/modules/tasks/update-task";
import { error, internalServerError, toHttpError } from "../../lib/http";
import { expectTaskExists, resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function createTaskValidationRouter() {
  const api = new Hono();

  api.post("/tasks", async (c) => {
    try {
      const parsed = createTaskBodySchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((issue) => issue.message).join("; "), 400);
      }

      const title = parsed.data.title.trim();
      if (!title) return error(c, "title is required", 400);

      const workspace = await db.workspace.findUnique({
        where: { id: parsed.data.workspaceId },
        select: { id: true },
      });
      if (!workspace) return error(c, "Workspace not found", 404);

      return c.json(await createTask({ ...parsed.data, title }), 201 as never);
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) return error(c, httpError.message, httpError.status);
      return internalServerError(c, "POST /api/tasks", cause, "Failed to create task");
    }
  });

  api.patch("/tasks/:taskId", async (c) => {
    try {
      const parsed = updateTaskBodySchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((issue) => issue.message).join("; "), 400);
      }

      return c.json(await updateTask({ taskId: c.req.param("taskId"), ...parsed.data }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to update task";
      if (message.includes("not found") || message.includes("Record to update not found")) {
        return error(c, "Task not found", 404);
      }
      if (message.includes("cannot be empty") || message.includes("executionConfig must be an object")) {
        return error(c, message, 400);
      }
      return internalServerError(c, "PATCH /api/tasks/:taskId", cause, "Failed to update task");
    }
  });

  return api;
}

function app() {
  const server = new Hono();
  server.route("/api", createTaskValidationRouter());
  return server;
}

describe("task validation workflow", () => {
  let workspaceId: string;

  beforeEach(async () => {
    await resetTestDb();
    workspaceId = (await seedWorkspace("Task validation workflow")).workspaceId;
  });

  it("trims create titles before persisting canonical task state", async () => {
    const response = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, title: "  Canonical task  ", description: "Needs validation" }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { taskId: string };
    const task = await expectTaskExists(body.taskId);

    expect(task.title).toBe("Canonical task");
  });

  it("rejects whitespace create titles without creating tasks", async () => {
    const response = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, title: "   " }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("title is required");
    expect(await db.task.count({ where: { workspaceId } })).toBe(0);
  });

  it("rejects invalid runtime config updates without mutating task state", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Runtime config target" });

    const response = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionConfig: [] }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("expected record");
    const task = await expectTaskExists(taskId);
    expect(task.title).toBe("Runtime config target");
    expect(task.executionConfig).toEqual({});
  });

  it("normalizes update titles and rebuilds projection state", async () => {
    const { taskId } = await seedTask(workspaceId, { title: "Before validation" });

    const response = await app().request(`http://local/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  After validation  ", autoExecute: true }),
    });

    expect(response.status).toBe(200);
    const task = await expectTaskExists(taskId);
    const event = await db.event.findFirst({ where: { taskId, eventType: "task.updated" } });

    expect(task.title).toBe("After validation");
    expect(task.autoExecute).toBe(true);
    expect(task.autoPlanGeneration).toBe(true);
    expect(await db.taskProjection.findUnique({ where: { taskId } })).not.toBeNull();
    expect(event?.payload).toMatchObject({ changed_fields: expect.arrayContaining(["title", "autoExecute"]) });
  });
});
