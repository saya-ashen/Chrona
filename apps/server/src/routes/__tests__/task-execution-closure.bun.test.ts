/**
 * API tests: POST /complete, /reopen, /result/accept
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { RunStatus, TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { acceptTaskResult } from "@chrona/engine/modules/tasks/accept-task-result";
import { markTaskDone } from "@chrona/engine/modules/tasks/mark-task-done";
import { reopenTask } from "@chrona/engine/modules/tasks/reopen-task";
import { resetTestDb, seedWorkspace, seedTask, json } from "../../__tests__/bun-test-helpers";

function createClosureRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/complete", async (c) => {
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

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createClosureRouter());
  return a;
}

describe("POST /api/tasks/:taskId/complete", () => {
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

    const res = await app().request(`http://local/api/tasks/${taskId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(workspaceId);
  });
});

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

    await db.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });

    const res = await app().request(`http://local/api/tasks/${taskId}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; status: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.status).toBe("Ready");
  });
});

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

    const res = await app().request(`http://local/api/tasks/${taskId}/result/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await json<{ taskId: string; workspaceId: string; runId: string }>(res);
    expect(body.taskId).toBe(taskId);
    expect(body.runId).toBe(run.id);
  });
});
