import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

const aiGeneratePlanMock = mock(async (request: { title: string; description?: string }) => ({
  source: "test-ai",
  summary: `Plan for ${request.title}`,
  reasoning: `Used ${request.description ?? "no description"}`,
  nodes: [
    {
      id: "node-1",
      type: "task",
      title: `Handle ${request.title}`,
      objective: request.description ?? request.title,
      description: request.description ?? null,
      status: "pending",
      phase: null,
      estimatedMinutes: null,
      priority: "Medium",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
    },
  ],
  edges: [],
}));

mock.module("@/modules/ai/ai-service", () => ({
  aiGeneratePlan: aiGeneratePlanMock,
}));

import { generateTaskPlanForTask } from "@/modules/commands/generate-task-plan-for-task";

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

describe("generateTaskPlanForTask", () => {
  beforeEach(async () => {
    await resetDb();
    aiGeneratePlanMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("generates and saves a draft plan from the persisted task fields", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Plan Command", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Updated task title",
        description: "Updated description from DB",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-12T10:30:00.000Z"),
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result?.savedPlan?.summary).toBe("Plan for Updated task title");
    expect(aiGeneratePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "Updated task title",
      description: "Updated description from DB",
      estimatedMinutes: 90,
    }));

    const saved = await getLatestTaskPlanGraph(task.id);
    expect(saved?.plan.nodes[0]?.title).toBe("Handle Updated task title");
    expect(saved?.plan.nodes[0]?.objective).toBe("Updated description from DB");
  });

  it("returns a saved plan without calling AI unless forceRefresh is requested", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Cached Plan", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Cached title",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    aiGeneratePlanMock.mockClear();

    const result = await generateTaskPlanForTask({ taskId: task.id });

    expect(result?.source).toBe("saved");
    expect(aiGeneratePlanMock).not.toHaveBeenCalled();
  });

  it("does not save an empty generated plan", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async () => ({
      source: "test-ai",
      summary: "",
      reasoning: "",
      nodes: [],
      edges: [],
    }));

    const workspace = await db.workspace.create({
      data: { name: "Invalid Plan", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Broken planner output",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result).toBeNull();
    expect(await getLatestTaskPlanGraph(task.id)).toBeNull();
  });
});
