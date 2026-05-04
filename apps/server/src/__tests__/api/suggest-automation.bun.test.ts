/**
 * API route tests for POST /api/ai/suggest-automation.
 *
 * Validates the two modes (taskId-from-DB and ad-hoc fields), input validation,
 * and error handling. Uses the real suggestAutomationSmart which falls back to
 * rules-based suggestion when AI is unavailable — the route layer is the focus.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { suggestAutomationSmart } from "@chrona/engine";
import type { TaskAutomationInput } from "@chrona/contracts/ai";
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

function createSuggestAutomationRouter() {
  const api = new Hono();

  api.post("/ai/suggest-automation", async (c) => {
    try {
      const body = await c.req.json();
      const { taskId, title, description, priority, dueAt, scheduledStartAt, scheduledEndAt, isRunnable, runnabilityState, ownerType } = body;

      if (!taskId && !title) {
        return error(c, "Either taskId or title is required", 400);
      }

      if (taskId && !title) {
        const task = await db.task.findUnique({ where: { id: taskId } });
        if (!task) {
          return error(c, "Task not found", 404);
        }
        return httpJson(c, await suggestAutomationSmart({
          taskId: task.id,
          title: task.title,
          description: task.description ?? "",
          priority: task.priority,
          dueAt: task.dueAt,
          scheduledStartAt: task.scheduledStartAt,
          scheduledEndAt: task.scheduledEndAt,
          isRunnable: !!task.runtimeAdapterKey,
          runnabilityState: task.status ?? "",
          ownerType: task.ownerType ?? "",
        }));
      }

      const input: TaskAutomationInput = {
        taskId: taskId ?? "",
        title,
        description: description ?? "",
        priority: priority ?? "Medium",
        dueAt: dueAt ? new Date(dueAt) : null,
        scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
        scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : null,
        isRunnable: isRunnable ?? false,
        runnabilityState: runnabilityState ?? "",
        ownerType: ownerType ?? "",
      };

      return httpJson(c, await suggestAutomationSmart(input));
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/suggest-automation", cause, "Failed to suggest automation");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createSuggestAutomationRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/ai/suggest-automation", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // ── Happy path: taskId mode ───────────────────────────────────────────

  it("returns automation suggestion when taskId is provided", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, {
      title: "Write report",
      priority: "High",
      dueAt: new Date("2026-06-01T10:00:00Z"),
    });

    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<{
      executionMode: string;
      reminderStrategy: { advanceMinutes: number; frequency: string; channels: string[] };
      preparationSteps: string[];
      contextSources: Array<{ type: string; description: string }>;
      confidence: string;
    }>(res);
    expect(["immediate", "scheduled", "recurring", "manual"]).toContain(body.executionMode);
    expect(body.reminderStrategy).toBeDefined();
    expect(["low", "medium", "high"]).toContain(body.confidence);
  });

  it("fetches task from DB when taskId mode is used", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, {
      title: "Urgent bug fix",
      priority: "Urgent",
    });

    // Give it a runtime adapter so it's runnable
    await db.task.update({ where: { id: taskId }, data: { runtimeAdapterKey: "openclaw", description: "Critical production issue" } });

    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.executionMode).toBe("immediate");
    expect(["low", "medium", "high"]).toContain(body.confidence);
  });

  // ── Happy path: ad-hoc mode ───────────────────────────────────────────

  it("returns automation suggestion for ad-hoc task fields", async () => {
    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Weekly review",
          description: "Review team progress and blockers",
          priority: "Medium",
          dueAt: new Date("2026-05-10T18:00:00Z").toISOString(),
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.executionMode).toBeDefined();
    expect(body.preparationSteps).toBeInstanceOf(Array);
  });

  it("defaults missing optional fields in ad-hoc mode", async () => {
    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Simple task",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(["immediate", "scheduled", "recurring", "manual"]).toContain(body.executionMode);
  });

  // ── Recurring task detection ──────────────────────────────────────────

  it("detects recurring tasks by title keywords", async () => {
    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Daily standup meeting",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.executionMode).toBe("recurring");
    expect(body.reminderStrategy.frequency).toBe("recurring");
  });

  // ── Negative cases ────────────────────────────────────────────────────

  it("returns 400 when neither taskId nor title is provided", async () => {
    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Missing required fields" }),
      },
    );
    await expectApiError(res, 400);
  });

  it("returns 404 when taskId references a nonexistent task", async () => {
    const res = await app().request(
      "http://local/api/ai/suggest-automation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "nonexistent-task-id" }),
      },
    );
    await expectApiError(res, 404);
  });
});
