import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import {
  listSchedulerEvents,
  recordSchedulerEvent,
} from "@/modules/orchestration/scheduler-event-repository";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createTask() {
  const workspace = await db.workspace.create({
    data: { name: "Scheduler Event Workspace", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Run orchestrator",
      status: "Ready",
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run orchestrator" },
    },
  });
  return { workspace, task };
}

describe("scheduler event repository", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("persists scheduler event history in creation order", async () => {
    const { workspace, task } = await createTask();

    await recordSchedulerEvent({
      workspaceId: workspace.id,
      taskId: task.id,
      eventType: "lease_acquired",
      graphVersion: 1,
      reason: "due_start",
      payload: { nodeId: "node-a" },
    });
    await recordSchedulerEvent({
      workspaceId: workspace.id,
      taskId: task.id,
      eventType: "tick_completed",
      graphVersion: 1,
      payload: { started: 1 },
    });

    const events = await listSchedulerEvents(task.id);

    expect(events.map((event) => event.eventType)).toEqual(["lease_acquired", "tick_completed"]);
    expect(events[0]).toMatchObject({ graphVersion: 1, reason: "due_start", payload: { nodeId: "node-a" } });
  });

  it("redacts secret-like payload fields recursively", async () => {
    const { workspace, task } = await createTask();

    const event = await recordSchedulerEvent({
      workspaceId: workspace.id,
      taskId: task.id,
      eventType: "external_run_started",
      payload: {
        apiKey: "key-123",
        nested: {
          accessToken: "token-123",
          password: "pw-123",
          safeValue: "visible",
        },
      },
    });

    expect(event.payload).toEqual({
      apiKey: "[redacted]",
      nested: {
        accessToken: "[redacted]",
        password: "[redacted]",
        safeValue: "visible",
      },
    });
  });
});
