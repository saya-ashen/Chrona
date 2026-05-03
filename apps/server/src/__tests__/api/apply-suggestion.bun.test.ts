import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { db } from "@chrona/db";
import { applySuggestionChangesSchema, applySuggestionSingleSchema } from "../../routes/schemas";
import {
  resetTestDb,
  seedWorkspace,
  seedTask,
  expectApiError,
  expectTaskExists,
  json,
} from "../bun-test-helpers";
import { error, internalServerError, json as httpJson } from "../../lib/http";

// ---------------------------------------------------------------------------
// Inline apply-suggestion router
// ---------------------------------------------------------------------------

function createApplySuggestionRouter() {
  const api = new Hono();

  api.post("/ai/apply-suggestion", async (c) => {
    try {
      const body = await c.req.json();

      // Try changes-array format first
      const changesResult = applySuggestionChangesSchema.safeParse(body);
      if (changesResult.success) {
        const { workspaceId, suggestionId, changes } = changesResult.data;

        const taskIds = changes.map((change) => change.taskId);
        const tasks = await db.task.findMany({
          where: { id: { in: taskIds }, workspaceId },
        });

        if (tasks.length !== taskIds.length) {
          return error(c, "Some tasks do not belong to this workspace", 403);
        }

        await db.$transaction(async (tx) => {
          await Promise.all(changes.map((change) => tx.taskProjection.update({
            where: { taskId: change.taskId },
            data: {
              ...(change.scheduledStartAt && { scheduledStartAt: new Date(change.scheduledStartAt) }),
              ...(change.scheduledEndAt && { scheduledEndAt: new Date(change.scheduledEndAt) }),
              updatedAt: new Date(),
            },
          })));
        });

        return httpJson(c, { success: true, appliedChanges: changes.length, suggestionId });
      }

      // Try single-suggestion format
      const singleResult = applySuggestionSingleSchema.safeParse(body);
      if (!singleResult.success) {
        return error(c, singleResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      const { workspaceId, suggestion } = singleResult.data;
      const taskId = randomUUID();
      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.task.create({
          data: {
            id: taskId,
            workspaceId,
            title: suggestion.action.title,
            description: suggestion.action.description || null,
            priority: (suggestion.action.priority ?? "Medium") as any,
            status: "Draft",
            scheduleStatus: suggestion.action.scheduledStartAt ? "Scheduled" : "Unscheduled",
            scheduleSource: "ai",
            scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
            scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
            ownerType: "human",
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx.taskProjection.upsert({
          where: { taskId },
          create: {
            taskId,
            workspaceId,
            persistedStatus: "Draft",
            scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
            scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
            updatedAt: now,
          },
          update: {
            scheduledStartAt: suggestion.action.scheduledStartAt ? new Date(suggestion.action.scheduledStartAt) : null,
            scheduledEndAt: suggestion.action.scheduledEndAt ? new Date(suggestion.action.scheduledEndAt) : null,
            updatedAt: now,
          },
        });
      });

      return httpJson(c, {
        success: true,
        taskId,
        suggestionId: suggestion.id,
        action: suggestion.action.type,
        summary: suggestion.summary,
      });
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/apply-suggestion", cause, "Failed to apply suggestion");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createApplySuggestionRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apply-suggestion endpoint", () => {
  let workspaceId: string;

  beforeEach(async () => {
    await resetTestDb();
    const ws = await seedWorkspace("Suggestion Workspace");
    workspaceId = ws.workspaceId;
  });

  // ──────────────────────────────────────────────
  // Happy path - single suggestion
  // ──────────────────────────────────────────────

  it("POST /ai/apply-suggestion creates Task with create_task action", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-1",
          summary: "Create a new task",
          action: {
            type: "create_task",
            title: "My new task",
            description: "Created from suggestion",
            priority: "High",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ success: boolean; taskId: string }>(res);
    expect(body.success).toBe(true);
    expect(typeof body.taskId).toBe("string");
  });

  it("created task exists in DB with status Draft and ownerType human", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-2",
          action: { type: "create_task", title: "Draft task" },
        },
      }),
    });

    const body = await json<{ taskId: string }>(res);
    const task = await expectTaskExists(body.taskId) as Record<string, unknown>;
    expect(task.status).toBe("Draft");
    expect(task.ownerType).toBe("human");
  });

  it("task with scheduledStartAt/End has scheduleStatus Scheduled and scheduleSource ai", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-3",
          action: {
            type: "create_task",
            title: "Scheduled task",
            scheduledStartAt: "2026-05-10T09:00:00.000Z",
            scheduledEndAt: "2026-05-10T10:00:00.000Z",
          },
        },
      }),
    });

    const body = await json<{ taskId: string }>(res);
    const task = await expectTaskExists(body.taskId) as Record<string, unknown>;
    expect(task.scheduleStatus).toBe("Scheduled");
    expect(task.scheduleSource).toBe("ai");
  });

  it("task without scheduled times has scheduleStatus Unscheduled", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-4",
          action: { type: "create_task", title: "Unscheduled task" },
        },
      }),
    });

    const body = await json<{ taskId: string }>(res);
    const task = await expectTaskExists(body.taskId) as Record<string, unknown>;
    expect(task.scheduleStatus).toBe("Unscheduled");
  });

  // ──────────────────────────────────────────────
  // Happy path - batch changes
  // ──────────────────────────────────────────────

  it("POST /ai/apply-suggestion (changes format) updates TaskProjection schedule times", async () => {
    const { taskId: taskIdA } = await seedTask(workspaceId, { title: "Task A" });
    const { taskId: taskIdB } = await seedTask(workspaceId, { title: "Task B" });

    // Create projections (required for update)
    await db.taskProjection.create({
      data: { taskId: taskIdA, workspaceId, persistedStatus: "Ready" },
    });
    await db.taskProjection.create({
      data: { taskId: taskIdB, workspaceId, persistedStatus: "Ready" },
    });

    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestionId: "sug-batch-1",
        changes: [
          { taskId: taskIdA, scheduledStartAt: "2026-05-10T09:00:00.000Z", scheduledEndAt: "2026-05-10T10:00:00.000Z" },
          { taskId: taskIdB, scheduledStartAt: "2026-05-10T11:00:00.000Z", scheduledEndAt: "2026-05-10T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ success: boolean; appliedChanges: number }>(res);
    expect(body.success).toBe(true);
    expect(body.appliedChanges).toBe(2);

    const projA = await db.taskProjection.findUniqueOrThrow({ where: { taskId: taskIdA } });
    expect(projA.scheduledStartAt?.toISOString()).toBe("2026-05-10T09:00:00.000Z");
    expect(projA.scheduledEndAt?.toISOString()).toBe("2026-05-10T10:00:00.000Z");

    const projB = await db.taskProjection.findUniqueOrThrow({ where: { taskId: taskIdB } });
    expect(projB.scheduledStartAt?.toISOString()).toBe("2026-05-10T11:00:00.000Z");
  });

  // ──────────────────────────────────────────────
  // Negative cases
  // ──────────────────────────────────────────────

  it("changes format: taskId not in workspace returns 403", async () => {
    const otherWs = await seedWorkspace("Other Workspace");
    const { taskId } = await seedTask(otherWs.workspaceId, { title: "Other task" });

    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestionId: "sug-bad",
        changes: [{ taskId, scheduledStartAt: "2026-05-10T09:00:00.000Z" }],
      }),
    });

    await expectApiError(res, 403);
  });

  it("single suggestion: missing workspaceId returns 400 with field in message", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suggestion: {
          id: "sug-no-ws",
          action: { type: "create_task", title: "Bad" },
        },
      }),
    });

    expect(res.status).toBe(400);
    const b = await json<{ error: string }>(res);
    expect(b.error).toBeDefined();
    expect(b.error).toContain("workspaceId");
  });

  it("single suggestion: missing suggestion.action returns 400 with action in message", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, suggestion: {} }),
    });

    expect(res.status).toBe(400);
    const b = await json<{ error: string }>(res);
    expect(b.error).toBeDefined();
    expect(b.error).toMatch(/action/i);
  });

  it("single suggestion: unknown action.type returns 400 with type in message", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-unknown",
          action: { type: "unknown_action" },
        },
      }),
    });

    expect(res.status).toBe(400);
    const b = await json<{ error: string }>(res);
    expect(b.error).toBeDefined();
    expect(b.error).toMatch(/type/i);
  });

  it("single suggestion: missing action.title returns 400", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-no-title",
          action: { type: "create_task" },
        },
      }),
    });

    await expectApiError(res, 400);
  });

  // ──────────────────────────────────────────────
  // Negative cases — changes-format Zod validation
  // ──────────────────────────────────────────────

  it("changes format: missing workspaceId returns 400", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suggestionId: "sug-no-ws",
        changes: [{ taskId: "t-1" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("changes format: missing suggestionId returns 400", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        changes: [{ taskId: "t-1" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("changes format: empty changes array returns 400", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestionId: "sug-empty",
        changes: [],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("changes format: change item missing taskId returns 400", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestionId: "sug-no-taskid",
        changes: [{}],
      }),
    });

    expect(res.status).toBe(400);
  });

  // ──────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────

  it("both Task and TaskProjection exist after successful apply", async () => {
    const res = await app().request("http://local/api/ai/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        suggestion: {
          id: "sug-atomic",
          action: { type: "create_task", title: "Atomic test" },
        },
      }),
    });

    const body = await json<{ taskId: string }>(res);
    const task = await expectTaskExists(body.taskId);
    expect(task).toBeDefined();

    const projection = await db.taskProjection.findUnique({ where: { taskId: body.taskId } });
    expect(projection).toBeDefined();
    expect(projection?.taskId).toBe(body.taskId);
  });
});
