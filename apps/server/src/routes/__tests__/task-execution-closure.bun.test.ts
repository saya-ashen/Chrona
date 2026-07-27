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
        runtimeName: "hermes",
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

  it("reopens a Done task without an accepted plan back to Draft", async () => {
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
    expect(body.status).toBe("Draft");
  });
});

describe("POST /api/tasks/:taskId/result/accept", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("accepts a completed run result without changing task execution state", async () => {
    const { workspaceId } = await seedWorkspace("Accept Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Accept Task",
      status: TaskStatus.Completed,
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
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

    const acceptedTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(acceptedTask.status).toBe(TaskStatus.Completed);
    expect(await db.event.count({
      where: { taskId, runId: run.id, eventType: "task.result_accepted" },
    })).toBe(1);
    expect(await db.event.count({
      where: { taskId, runId: run.id, eventType: "task.done" },
    })).toBe(0);
  });

  it("replays a legacy accepted result without mutating task execution state", async () => {
    const { workspaceId } = await seedWorkspace("Legacy Accept Test");
    const { taskId } = await seedTask(workspaceId, {
      title: "Legacy Accepted Task",
      status: TaskStatus.Completed,
    });
    const endedAt = new Date("2026-07-21T12:00:00.000Z");
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeRunRef: "run-legacy-accept-ref",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date("2026-07-21T11:59:00.000Z"),
        endedAt,
      },
    });
    await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
    await db.event.create({
      data: {
        eventType: "task.result_accepted",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "user",
        source: "ui",
        payload: { accepted_at: "2026-07-21T12:01:00.000Z" },
        dedupeKey: `task.result_accepted:${taskId}:${run.id}`,
        ingestSequence: 1,
      },
    });

    const first = await app().request(`http://local/api/tasks/${taskId}/result/accept`, { method: "POST" });
    const second = await app().request(`http://local/api/tasks/${taskId}/result/accept`, { method: "POST" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      status: TaskStatus.Completed,
      completedAt: null,
    });
    expect(await db.event.count({
      where: { taskId, runId: run.id, eventType: "task.result_accepted" },
    })).toBe(1);
    expect(await db.event.count({
      where: { taskId, runId: run.id, eventType: "task.done" },
    })).toBe(0);
  });
});
