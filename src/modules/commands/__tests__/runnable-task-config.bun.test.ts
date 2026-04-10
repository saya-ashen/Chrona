import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { createTask } from "@/modules/commands/create-task";
import { updateTask } from "@/modules/commands/update-task";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("runnable task config commands", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("creates a task with normalized runnable config", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Config",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create a runnable task",
      runtimeModel: "  gpt-5.4  ",
      prompt: "  Implement the new schedule flow  ",
      runtimeConfig: {
        temperature: 0.2,
      },
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: result.taskId },
    });

    expect(storedTask.status).toBe("Ready");
    expect(storedTask.runtimeModel).toBe("gpt-5.4");
    expect(storedTask.prompt).toBe("Implement the new schedule flow");
    expect(storedTask.runtimeConfig).toEqual({ temperature: 0.2 });
  });

  it("creates a draft task when runnable config is incomplete", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Draft",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create an incomplete task",
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: result.taskId } });

    expect(storedTask.status).toBe("Draft");
    expect(storedTask.runtimeModel).toBeNull();
    expect(storedTask.prompt).toBeNull();
  });

  it("updates runnable config fields and records them in the canonical event", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Update",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Update runnable config",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await updateTask({
      taskId: task.id,
      runtimeModel: "  gpt-5.4-mini  ",
      prompt: "  Review the task projection code  ",
      runtimeConfig: {
        reasoning: "low",
      },
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const updatedEvent = await db.event.findFirstOrThrow({
      where: { taskId: task.id, eventType: "task.updated" },
      orderBy: { ingestSequence: "desc" },
    });

    expect(storedTask.status).toBe("Ready");
    expect(storedTask.runtimeModel).toBe("gpt-5.4-mini");
    expect(storedTask.prompt).toBe("Review the task projection code");
    expect(storedTask.runtimeConfig).toEqual({ reasoning: "low" });
    expect(updatedEvent.payload).toEqual(
      expect.objectContaining({
        changed_fields: expect.arrayContaining(["runtimeModel", "prompt", "runtimeConfig"]),
      }),
    );
  });

  it("lets update clear the optional advanced runtime config", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Clear",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Clear runtime config",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
        runtimeModel: "gpt-5.4",
        prompt: "Keep the prompt",
        runtimeConfig: { temperature: 0.7 },
      },
    });

    await updateTask({
      taskId: task.id,
      runtimeConfig: null,
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(storedTask.runtimeConfig).toBeNull();
    expect(storedTask.runtimeModel).toBe("gpt-5.4");
    expect(storedTask.prompt).toBe("Keep the prompt");
  });

  it("promotes a draft task to ready when runnable config becomes complete", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Promote",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Promote to ready",
        status: "Draft",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await updateTask({
      taskId: task.id,
      runtimeModel: "gpt-5.4",
      prompt: "Run the task",
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(storedTask.status).toBe("Ready");
  });

  it("drops a ready task back to draft when required runnable config is cleared", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Demote",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Demote to draft",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
        runtimeModel: "gpt-5.4",
        prompt: "Run the task",
      },
    });

    await updateTask({
      taskId: task.id,
      prompt: null,
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(storedTask.status).toBe("Draft");
    expect(storedTask.prompt).toBeNull();
  });

  it("rejects empty runnable config text fields", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Runnable Validation",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    await expect(
      createTask({
        workspaceId: workspace.id,
        title: "Reject empty config",
        runtimeModel: "   ",
      }),
    ).rejects.toThrow("runtimeModel cannot be empty");

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Reject empty prompt",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await expect(
      updateTask({
        taskId: task.id,
        prompt: "   ",
      }),
    ).rejects.toThrow("prompt cannot be empty");
  });
});
