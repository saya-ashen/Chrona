import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getTaskPage } from "@/modules/tasks/get-task-page";

async function resetDb() {
  await db.importedCalendarEvent.deleteMany();
  await db.calendarSource.deleteMany();
  await db.event.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedExternalTask(taskDescription: string | null, eventDescription: string | null) {
  const workspace = await db.workspace.create({
    data: { name: "External desc echo", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Imported standup",
      description: taskDescription,
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  const source = await db.calendarSource.create({
    data: {
      workspaceId: workspace.id,
      name: "Team Calendar",
      sourceUrl: `file:///tmp/${crypto.randomUUID()}.ics`,
      redactedUrlLabel: "local fixture",
      color: "#2563eb",
      lifecycleState: "active",
    },
  });
  await db.importedCalendarEvent.create({
    data: {
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      taskId: task.id,
      externalUid: crypto.randomUUID(),
      dedupeKey: crypto.randomUUID(),
      title: "Imported standup",
      startsAt: new Date("2026-04-20T09:00:00.000Z"),
      endsAt: new Date("2026-04-20T10:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
      description: eventDescription,
    },
  });
  return task;
}

describe("external task description echo", () => {
  beforeEach(resetDb);

  it("echoes the editable Chrona notes even when they match the calendar description", async () => {
    // Regression: the editable Chrona notes and the read-only calendar
    // description are independent fields shown in separate UI regions. The page
    // model must never hide the user's saved notes just because their text
    // happens to equal the source description — that made saved notes appear to
    // "disappear" after saving.
    const shared = "读取今天最新的github trendings，并总结成一份报告";
    const task = await seedExternalTask(shared, shared);

    const page = await getTaskPage(task.id);

    expect(page.task.description).toBe(shared);
    expect(page.task.sourceManaged?.description).toBe(shared);
  });

  it("echoes distinct Chrona notes alongside the calendar description", async () => {
    const task = await seedExternalTask(
      "我的本地笔记",
      "读取今天最新的github trendings，并总结成一份报告",
    );

    const page = await getTaskPage(task.id);

    expect(page.task.description).toBe("我的本地笔记");
    expect(page.task.sourceManaged?.description).toBe(
      "读取今天最新的github trendings，并总结成一份报告",
    );
  });
});
