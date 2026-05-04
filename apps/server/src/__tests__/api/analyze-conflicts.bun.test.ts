/**
 * API route tests for POST /api/ai/analyze-conflicts.
 *
 * Validates route-layer logic: required fields, projection fetching with
 * dependencies, delegation to analyzeConflictsSmart (rules-based with
 * LLM enhancement skipped in test environments).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { analyzeConflictsSmart } from "@chrona/runtime/modules/ai/conflict-analyzer";
import type { ScheduledTaskInfo } from "@chrona/contracts/ai";
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

function createAnalyzeConflictsRouter() {
  const api = new Hono();

  api.post("/ai/analyze-conflicts", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceId, date } = body;

      if (!workspaceId) {
        return error(c, "workspaceId is required", 400);
      }

      let startDate: Date;
      let endDate: Date;
      if (date) {
        startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
      } else {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7);
      }

      const projections = await db.taskProjection.findMany({
        where: {
          workspaceId,
          scheduledStartAt: { gte: startDate, lt: endDate },
        },
        include: {
          task: {
            include: {
              dependencies: { select: { dependsOnTaskId: true } },
            },
          },
        },
      });

      const validProjections = projections.filter(
        (p) => p.scheduledStartAt !== null && p.scheduledEndAt !== null && p.task !== null,
      );

      const tasks: ScheduledTaskInfo[] = validProjections.map((p) => ({
        taskId: p.taskId,
        title: p.task.title,
        priority: p.task.priority,
        scheduledStartAt: p.scheduledStartAt!,
        scheduledEndAt: p.scheduledEndAt!,
        dueAt: p.task.dueAt,
        estimatedMinutes: Math.round(
          (p.scheduledEndAt!.getTime() - p.scheduledStartAt!.getTime()) / 60000,
        ),
        dependencies: p.task.dependencies.map((dep) => dep.dependsOnTaskId),
      }));

      return httpJson(c, await analyzeConflictsSmart(tasks));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/analyze-conflicts", cause, "Failed to analyze conflicts");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createAnalyzeConflictsRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Seed helper: create a task with projection and scheduled times
// ---------------------------------------------------------------------------

async function seedScheduledTask(
  workspaceId: string,
  overrides?: {
    title?: string;
    priority?: string;
    dueAt?: Date;
    scheduledStartAt?: Date;
    scheduledEndAt?: Date;
    persistedStatus?: string;
    scheduleStatus?: string;
  },
) {
  const { taskId } = await seedTask(workspaceId, {
    title: overrides?.title ?? "Scheduled Task",
    priority: overrides?.priority ?? "Medium",
      dueAt: overrides?.dueAt ?? undefined,
      scheduledStartAt: overrides?.scheduledStartAt ?? undefined,
      scheduledEndAt: overrides?.scheduledEndAt ?? undefined,
  });

  await db.taskProjection.create({
    data: {
      taskId,
      workspaceId,
      persistedStatus: overrides?.persistedStatus ?? "Ready",
      scheduleStatus: overrides?.scheduleStatus ?? "Unscheduled",
      scheduledStartAt: overrides?.scheduledStartAt ?? null,
      scheduledEndAt: overrides?.scheduledEndAt ?? null,
    },
  });

  return { taskId, workspaceId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/ai/analyze-conflicts", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns analysis summary with zero conflicts for empty schedule", async () => {
    const ws = await seedWorkspace();

    const res = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<{
      conflicts: unknown[];
      suggestions: unknown[];
      summary: { totalConflicts: number; highSeverityCount: number; mediumSeverityCount: number; lowSeverityCount: number; affectedTaskCount: number };
    }>(res);
    expect(body.conflicts).toBeInstanceOf(Array);
    expect(body.suggestions).toBeInstanceOf(Array);
    expect(body.summary.totalConflicts).toBe(0);
    expect(body.summary.highSeverityCount).toBe(0);
  });

  it("returns analysis for scheduled tasks with no overlaps", async () => {
    const ws = await seedWorkspace();
    // 90-min tasks avoid fragmentation detection (threshold: <90min each)
    const start1 = new Date("2026-05-01T09:00:00Z");
    const end1 = new Date("2026-05-01T10:30:00Z");
    const start2 = new Date("2026-05-01T11:00:00Z");
    const end2 = new Date("2026-05-01T12:30:00Z");

    const t1 = await seedScheduledTask(ws.workspaceId, {
      title: "Morning task",
      scheduledStartAt: start1,
      scheduledEndAt: end1,
    });
    const t2 = await seedScheduledTask(ws.workspaceId, {
      title: "Afternoon task",
      scheduledStartAt: start2,
      scheduledEndAt: end2,
    });

    await db.taskProjection.update({
      where: { taskId: t1.taskId },
      data: { scheduledStartAt: start1, scheduledEndAt: end1 },
    });
    await db.taskProjection.update({
      where: { taskId: t2.taskId },
      data: { scheduledStartAt: start2, scheduledEndAt: end2 },
    });

    const res = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, date: "2026-05-01" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.summary.totalConflicts).toBe(0);
  });

  it("detects time overlap between two tasks", async () => {
    const ws = await seedWorkspace();
    const start1 = new Date("2026-05-01T09:00:00Z");
    const end1 = new Date("2026-05-01T11:00:00Z");
    const start2 = new Date("2026-05-01T10:00:00Z");
    const end2 = new Date("2026-05-01T12:00:00Z");

    const t1 = await seedScheduledTask(ws.workspaceId, {
      title: "Task A",
      priority: "High",
      scheduledStartAt: start1,
      scheduledEndAt: end1,
    });
    const t2 = await seedScheduledTask(ws.workspaceId, {
      title: "Task B",
      priority: "Low",
      scheduledStartAt: start2,
      scheduledEndAt: end2,
    });

    await db.taskProjection.update({
      where: { taskId: t1.taskId },
      data: { scheduledStartAt: start1, scheduledEndAt: end1 },
    });
    await db.taskProjection.update({
      where: { taskId: t2.taskId },
      data: { scheduledStartAt: start2, scheduledEndAt: end2 },
    });

    const res = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, date: "2026-05-01" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.summary.totalConflicts).toBeGreaterThan(0);
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it("filters tasks outside the requested date range", async () => {
    const ws = await seedWorkspace();
    const farStart = new Date("2025-01-01T09:00:00Z");
    const farEnd = new Date("2025-01-01T10:00:00Z");

    await seedScheduledTask(ws.workspaceId, {
      title: "Old task",
      scheduledStartAt: farStart,
      scheduledEndAt: farEnd,
    });
    await seedTask(ws.workspaceId, { title: "Unscheduled task" });

    const res = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    // No tasks in the default 7-day window = zero conflicts
    expect(body.summary.totalConflicts).toBe(0);
  });

  // ── Negative cases ────────────────────────────────────────────────────

  it("returns 400 when workspaceId is missing", async () => {
    const res = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    await expectApiError(res, 400);
  });

  it("accepts a specific date to narrow the conflict window", async () => {
    const ws = await seedWorkspace();
    const startA = new Date("2026-05-01T09:00:00Z");
    const endA = new Date("2026-05-01T11:00:00Z");
    const startB = new Date("2026-05-01T10:00:00Z");
    const endB = new Date("2026-05-01T12:00:00Z");

    const t1 = await seedScheduledTask(ws.workspaceId, {
      title: "C-A",
      scheduledStartAt: startA,
      scheduledEndAt: endA,
    });
    const t2 = await seedScheduledTask(ws.workspaceId, {
      title: "C-B",
      scheduledStartAt: startB,
      scheduledEndAt: endB,
    });

    await db.taskProjection.update({
      where: { taskId: t1.taskId },
      data: { scheduledStartAt: startA, scheduledEndAt: endA },
    });
    await db.taskProjection.update({
      where: { taskId: t2.taskId },
      data: { scheduledStartAt: startB, scheduledEndAt: endB },
    });

    // Use date=2026-05-02 which should exclude both tasks
    const resOther = await app().request(
      "http://local/api/ai/analyze-conflicts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.workspaceId, date: "2026-05-02" }),
      },
    );

    expect(resOther.status).toBe(200);
    const bodyOther = await json<any>(resOther);
    expect(bodyOther.summary.totalConflicts).toBe(0);
  });
});
