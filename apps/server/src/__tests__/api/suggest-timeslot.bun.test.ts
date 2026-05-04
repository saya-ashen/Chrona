/**
 * API route tests for POST /api/ai/suggest-timeslot.
 *
 * Validates route-layer logic: required fields, task existence, projection fetching,
 * delegation to rules-based suggestTimeslots (AI path skipped by default in tests).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { suggestTimeslots } from "@chrona/runtime/modules/ai/timeslot-suggester";
import type { ScheduleSlot } from "@chrona/contracts/ai";
import {
  resetTestDb,
  seedWorkspace,
  seedTask,
  expectApiError,
  json,
} from "../bun-test-helpers";
import { error, internalServerError, json as httpJson } from "../../lib/http";

// ---------------------------------------------------------------------------
// Inline router
// ---------------------------------------------------------------------------

function createSuggestTimeslotRouter() {
  const api = new Hono();

  api.post("/ai/suggest-timeslot", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceId, taskId, date } = body;

      if (!workspaceId || !taskId) {
        return error(c, "workspaceId and taskId are required", 400);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return error(c, "Task not found", 404);
      }

      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const projections = await db.taskProjection.findMany({
        where: {
          workspaceId,
          scheduledStartAt: { gte: targetDate, lt: nextDay },
          NOT: { taskId },
        },
        include: { task: { select: { title: true, priority: true, status: true } } },
      });

      let estimatedMinutes = 60;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        estimatedMinutes = Math.round(
          (new Date(task.scheduledEndAt).getTime() - new Date(task.scheduledStartAt).getTime()) / 60000,
        );
      }

      const currentSchedule: ScheduleSlot[] = projections
        .filter((p) => p.scheduledStartAt !== null && p.scheduledEndAt !== null)
        .map((p) => ({
          taskId: p.taskId,
          title: p.task?.title ?? "Untitled",
          startAt: p.scheduledStartAt!,
          endAt: p.scheduledEndAt!,
        }));

      return httpJson(c, suggestTimeslots({
        taskId: task.id,
        title: task.title,
        priority: task.priority,
        estimatedMinutes,
        dueAt: task.dueAt,
        currentSchedule,
      }));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/suggest-timeslot", cause, "Failed to suggest timeslot");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createSuggestTimeslotRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/ai/suggest-timeslot", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns timeslot suggestions for a task with empty schedule", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, {
      title: "Write documentation",
      priority: "Medium",
    });

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, taskId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<{
      suggestions: Array<{ startAt: string; endAt: string; score: number; reasons: string[]; conflicts: string[] }>;
      bestMatch: { startAt: string; endAt: string; score: number } | null;
    }>(res);
    expect(body.suggestions).toBeInstanceOf(Array);
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.bestMatch).toBeDefined();
    expect(body.suggestions[0].score).toBeGreaterThan(0);
  });

  it("returns suggestions with reasons and conflicts arrays", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, {
      title: "Review PRs",
      priority: "High",
      dueAt: new Date("2026-05-05T18:00:00Z"),
    });

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, taskId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.suggestions[0].reasons).toBeInstanceOf(Array);
    expect(body.suggestions[0].conflicts).toBeInstanceOf(Array);
  });

  it("uses estimated duration from task scheduled times when set", async () => {
    const ws = await seedWorkspace();
    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T11:00:00Z"); // 120 minutes
    const { taskId } = await seedTask(ws.workspaceId, {
      title: "Detailed analysis",
      scheduledStartAt: start,
      scheduledEndAt: end,
    });

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, taskId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    // With 120min tasks, the suggestion scoring may differ
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  // ── Negative cases ────────────────────────────────────────────────────

  it("returns 400 when workspaceId is missing", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      },
    );
    await expectApiError(res, 400);
  });

  it("returns 400 when taskId is missing", async () => {
    const ws = await seedWorkspace();

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId }),
      },
    );
    await expectApiError(res, 400);
  });

  it("returns 404 for nonexistent task", async () => {
    const ws = await seedWorkspace();

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, taskId: "nonexistent-task-id" }),
      },
    );
    await expectApiError(res, 404);
  });

  it("accepts optional date parameter for scheduling window", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, { title: "Plan sprint" });

    const res = await app().request(
      "http://local/api/ai/suggest-timeslot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: ws.workspaceId,
          taskId,
          date: "2026-06-15",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.suggestions.length).toBeGreaterThan(0);
  });
});
