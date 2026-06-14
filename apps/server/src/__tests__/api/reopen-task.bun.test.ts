import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { reopenTask } from "@chrona/engine/modules/tasks/reopen-task";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// reopenTask — engine-layer unit for the task-reopen primitive.
// The HTTP surface POST /api/tasks/:taskId/reopen is covered by
// routes/__tests__/task-execution-closure; this file pins the engine
// contract on the bare atomic operation:
//
// - completedAt is nulled
// - blockReason is cleared
// - status is re-derived from deriveTaskStaticState — with the
//   default hermes runtime and no executionConfig, the static state
//   has missing required config → persistedStatus = "Draft"
// - a task.reopened canonical event is emitted with the previous →
//   next status pair

describe("reopenTask (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("resets completedAt and blockReason on a Done task", async () => {
    const { workspaceId } = await seedWorkspace("Reopen done basic");
    const { taskId } = await seedTask(workspaceId, { title: "Done task" });
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Done",
        completedAt: new Date("2030-09-01T00:00:00.000Z"),
        blockReason: { kind: "needs_review" } as never,
      },
    });

    const result = await reopenTask({ taskId });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);
    // Default hermes runtime requires config that the test seed doesn't
    // provide, so the re-derived status is Draft.
    expect(result.status).toBe("Draft");

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.completedAt).toBeNull();
    expect(task.blockReason).toBeNull();
    expect(task.status).toBe("Draft");
  });

  it("emits a task.reopened event with the previous → next status pair", async () => {
    const { workspaceId } = await seedWorkspace("Reopen done event");
    const { taskId } = await seedTask(workspaceId, { title: "Reopen event task" });
    await db.task.update({
      where: { id: taskId },
      data: { status: "Done" },
    });

    await reopenTask({ taskId });

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.reopened" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as {
      previous_status: string;
      next_status: string;
    };
    expect(payload.previous_status).toBe("Done");
    expect(payload.next_status).toBe("Draft");
  });

  it("reopen on an already-Open task still resets completion fields and emits the event", async () => {
    const { workspaceId } = await seedWorkspace("Reopen already open");
    const { taskId } = await seedTask(workspaceId, { title: "Open task" });
    // seedTask already creates with status=Ready

    await reopenTask({ taskId });

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.completedAt).toBeNull();
    // Ready → Draft (downgrade via the re-derivation)
    expect(task.status).toBe("Draft");

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.reopened" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { previous_status: string; next_status: string };
    expect(payload.previous_status).toBe("Ready");
    expect(payload.next_status).toBe("Draft");
  });

  it("reopen from Blocked also lands on Draft with the reason cleared", async () => {
    const { workspaceId } = await seedWorkspace("Reopen from blocked");
    const { taskId } = await seedTask(workspaceId, { title: "Blocked task" });
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Blocked",
        blockReason: { kind: "missing_input" } as never,
      },
    });

    const result = await reopenTask({ taskId });
    expect(result.status).toBe("Draft");

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("Draft");
    expect(task.blockReason).toBeNull();
  });
});
