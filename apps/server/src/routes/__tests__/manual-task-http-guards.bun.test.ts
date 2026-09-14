import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { resetTestDb } from "@chrona/db/test-support";
import { createChronaEngine } from "@chrona/engine";
import { createTasksRoutes } from "../tasks/crud.routes";
import { createPlansRoutes } from "../tasks/plan.routes";
import { createExecutionRoutes } from "../tasks/execution.routes";
import { createTaskLifecycleRoutes } from "../tasks/lifecycle.routes";

beforeEach(resetTestDb);

function app() {
  const server = new Hono();
  const engine = createChronaEngine();
  server.route("/api", createTasksRoutes(engine));
  server.route("/api", createPlansRoutes(engine));
  server.route("/api", createExecutionRoutes(engine));
  server.route("/api", createTaskLifecycleRoutes(engine));
  return server;
}

describe("manual task HTTP boundaries", () => {
  it("uses scoped CAS receipts for actual HTTP manual lifecycle calls", async () => {
    const workspace = await db.workspace.create({ data: { name: "Manual HTTP", status: "Active" } });
    const otherWorkspace = await db.workspace.create({ data: { name: "Other manual HTTP", status: "Active" } });
    const server = app();
    const createdResponse = await server.request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, title: "Call landlord", taskExecutionMode: "manual", aiClientId: null }),
    });
    expect(createdResponse.status).toBe(201);
    const { taskId } = await createdResponse.json() as { taskId: string };
    const createdTask = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { taskExecutionMode: true, aiClientId: true, configRevision: true } });
    expect(createdTask).toMatchObject({ taskExecutionMode: "manual", aiClientId: null });

    const requestId = crypto.randomUUID();
    const completeBody = { expectedRevision: `config-v1:${createdTask.configRevision}`, requestId };
    const post = (path: string, body: object) => server.request(`http://local/api/tasks/${taskId}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const injectedWorkspace = await post("/manual/complete", { ...completeBody, workspaceId: otherWorkspace.id });
    expect(injectedWorkspace.status).toBe(400);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true } })).toMatchObject({ status: "Ready" });
    const completed = await post("/manual/complete", completeBody);
    const firstReceipt = await completed.json() as { completedAt: string; revision: string; replayed: boolean };
    const replay = await post("/manual/complete", completeBody);
    const replayReceipt = await replay.json() as { completedAt: string; revision: string; replayed: boolean };
    expect(completed.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replayReceipt).toMatchObject({ completedAt: firstReceipt.completedAt, revision: firstReceipt.revision, replayed: true });
    const noop = await post("/manual/complete", { expectedRevision: firstReceipt.revision, requestId: crypto.randomUUID() });
    expect(await noop.json()).toMatchObject({ applied: false, completedAt: firstReceipt.completedAt, revision: firstReceipt.revision });
    expect(await db.event.count({ where: { taskId, eventType: "task.done" } })).toBe(1);

    const stale = await post("/manual/reopen", { expectedRevision: completeBody.expectedRevision, requestId: crypto.randomUUID() });
    const collision = await post("/manual/reopen", completeBody);
    expect(stale.status).toBe(409);
    expect(collision.status).toBe(409);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, completedAt: true } })).toMatchObject({ status: "Done", completedAt: new Date(firstReceipt.completedAt) });

    const reopened = await post("/manual/reopen", { expectedRevision: firstReceipt.revision, requestId: crypto.randomUUID() });
    const reopenedReceipt = await reopened.json() as { revision: string; replayed: boolean };
    const reopenReplay = await post("/manual/reopen", { expectedRevision: firstReceipt.revision, requestId: (await db.event.findFirstOrThrow({ where: { taskId, eventType: "task.reopened" } })).dedupeKey!.split(":").at(-1)! });
    expect(reopened.status).toBe(200);
    expect(reopenedReceipt.replayed).toBe(false);
    expect(reopenReplay.status).toBe(200);
    expect(await db.event.count({ where: { taskId, eventType: "task.reopened" } })).toBe(1);

    const legacyComplete = await server.request(`http://local/api/tasks/${taskId}/complete`, { method: "POST" });
    const legacyReopen = await server.request(`http://local/api/tasks/${taskId}/reopen`, { method: "POST" });
    expect(legacyComplete.status).toBe(400);
    expect(legacyReopen.status).toBe(400);
  });

  it("returns canonical manual Ready and Done header documents without plan controls", async () => {
    const workspace = await db.workspace.create({ data: { name: "Manual header", status: "Active" } });
    const task = await db.task.create({ data: { workspaceId: workspace.id, title: "Header task", taskExecutionMode: "manual", status: "Ready", priority: "Medium", executionConfig: {} } });
    const server = app();
    const header = async () => (await server.request(`http://local/api/tasks/${task.id}/workspace/header`)).json() as Promise<{ spec: { elements: Record<string, unknown> } }>;
    const ready = await header();
    expect(ready.spec.elements["action:manual_complete"]).toBeDefined();
    expect(ready.spec.elements["action:generate-plan"]).toBeUndefined();
    expect((ready.spec.elements.summary as { props: { text: string } }).props.text).toBe("Manual task");

    const complete = await server.request(`http://local/api/tasks/${task.id}/manual/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: "config-v1:0", requestId: crypto.randomUUID() }),
    });
    expect(complete.status).toBe(200);
    const done = await header();
    expect((done.spec.elements["badge:primary-state"] as { props: { text: string } }).props.text).toBe("Done");
    expect(done.spec.elements["action:manual_reopen"]).toBeDefined();
    expect(done.spec.elements["action:start"]).toBeUndefined();
  });

  it("denies HTTP plan and execution commands without writing AI state", async () => {
    const workspace = await db.workspace.create({ data: { name: "Manual HTTP guards", status: "Active" } });
    const task = await db.task.create({ data: { workspaceId: workspace.id, title: "No AI", taskExecutionMode: "manual", status: "Ready", priority: "Medium", executionConfig: {} } });
    const server = app();
    const plan = await server.request(`http://local/api/tasks/${task.id}/plan/generations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
    expect(plan.status).toBe(400);
    const execution = await server.request(`http://local/api/tasks/${task.id}/execution/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start_manual", idempotencyKey: crypto.randomUUID() }) });
    expect(await execution.text()).toContain("Manual tasks cannot use AI planning or execution.");
    expect(await db.taskPlan.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.aiFeatureRun.count({ where: { subjectId: task.id } })).toBe(0);
    expect(await db.run.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.executionSession.count({ where: { taskId: task.id } })).toBe(0);
  });
});
