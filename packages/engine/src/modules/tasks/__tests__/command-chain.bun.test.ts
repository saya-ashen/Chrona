import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { createTask } from "@/modules/tasks/create-task";
import { reopenTask } from "@/modules/tasks/reopen-task";
import { updateTask } from "@/modules/tasks/update-task";
import type { CompiledPlan } from "@chrona/contracts/ai";

function makeAcceptedPlan(planId: string): CompiledPlan {
  return {
    id: `compiled_${planId}`,
    editablePlanId: planId,
    sourceVersion: 1,
    title: `Accepted plan ${planId}`,
    goal: "Allow task to enter ready state",
    assumptions: [],
    nodes: [],
    edges: [],
    entryNodeIds: [],
    terminalNodeIds: [],
    topologicalOrder: [],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

async function seedAcceptedPlan(workspaceId: string, taskId: string, planId: string) {
  await saveCompiledPlan({
    workspaceId,
    taskId,
    compiledPlan: makeAcceptedPlan(planId),
    status: "accepted",
    prompt: "Seed accepted plan",
    summary: "Accepted plan fixture",
    generatedBy: "command-chain-test",
  });
}

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
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
});

describe("createTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a draft human-owned task before any accepted plan exists and rebuilds projection", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Create Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "  Bootstrap task creation  ",
      description: "  Add the first real create flow  ",
      priority: "High",
      executionRuntime: "openclaw",
      executionConfig: {
        prompt: "  Add the first real create flow  ",
      },
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: result.taskId },
      include: { projection: true, sessions: true },
    });
    const createdEvent = await db.event.findFirst({
      where: { taskId: result.taskId, eventType: "task.created" },
    });

    expect(result.workspaceId).toBe(workspace.id);
    expect(storedTask.title).toBe("Bootstrap task creation");
    expect(storedTask.description).toBe("Add the first real create flow");
    expect(storedTask.status).toBe("Draft");
    expect(storedTask.executionRuntime).toBe("openclaw");
    expect(storedTask.executionConfig).toEqual({
      approvalPolicy: "never",
      prompt: "Add the first real create flow",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
    expect(storedTask.priority).toBe("High");
    expect(storedTask.defaultSessionId).toBeTruthy();
    expect(storedTask.sessions).toHaveLength(1);
    expect(storedTask.sessions[0]?.sessionKey).toBe(
      `chrona:openclaw:task:${storedTask.id}:default`,
    );
    expect(storedTask.projection).not.toBeNull();
    expect(createdEvent?.payload).toEqual(
      expect.objectContaining({
        title: "Bootstrap task creation",
        priority: "High",
        status: "Draft",
      }),
    );
  });

  it("rejects invalid adapter config values from the server command", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Invalid Config",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    await expect(
      createTask({
        workspaceId: workspace.id,
        title: "Invalid runtime config",
        executionRuntime: "openclaw",
        executionConfig: {
          prompt: "Run the invalid case",
          approvalPolicy: "sometimes" as never,
        },
      }),
    ).rejects.toThrow(/Approval policy must be one of/);
  });

});

describe("updateTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("preserves existing execution config keys when updating the prompt", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Update Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Keep adapter config",
        executionRuntime: "openclaw",
        executionConfig: {
          prompt: "Original prompt",
          temperature: 0.2,
          approvalPolicy: "never",
          toolMode: "workspace-write",
        },
        status: "Ready",
        priority: "High",
      },
    });

    await updateTask({
      taskId: task.id,
      executionConfig: {
        prompt: "Updated prompt",
        temperature: 0.2,
        approvalPolicy: "never",
        toolMode: "workspace-write",
      },
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(storedTask.executionConfig).toEqual({
      approvalPolicy: "never",
      prompt: "Updated prompt",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
  });

  it("keeps draft tasks in draft when no accepted plan exists", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Promote Draft",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "OpenClaw draft",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Draft",
        priority: "Medium",
      },
    });

    await updateTask({
      taskId: task.id,
      title: "OpenClaw ready",
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(storedTask.status).toBe("Draft");
  });

  it("promotes draft tasks to ready once an accepted plan exists", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Promote With Plan",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Draft with accepted plan",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Draft",
        priority: "Medium",
      },
    });

    await seedAcceptedPlan(workspace.id, task.id, "plan_update_ready");

    await updateTask({
      taskId: task.id,
      title: "Ready after accepted plan",
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(storedTask.status).toBe("Ready");
  });
});

describe("reopenTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reopens tasks without an accepted plan to draft", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Reopen Ready",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Reopen me",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Completed",
        priority: "Medium",
      },
    });

    const result = await reopenTask({ taskId: task.id });
    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(result.status).toBe("Draft");
    expect(storedTask.status).toBe("Draft");
  });

  it("reopens tasks with an accepted plan to ready", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Reopen Ready",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Reopen me with plan",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Completed",
        priority: "Medium",
      },
    });

    await seedAcceptedPlan(workspace.id, task.id, "plan_reopen_ready");

    const result = await reopenTask({ taskId: task.id });
    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(result.status).toBe("Ready");
    expect(storedTask.status).toBe("Ready");
  });

});
