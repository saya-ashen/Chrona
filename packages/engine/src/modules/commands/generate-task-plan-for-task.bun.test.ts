import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { db } from "@/lib/db";
import type { GenerateTaskPlanResponse } from "@chrona/ai-features";

import { generateTaskPlanForTask } from "@/modules/commands/generate-task-plan-for-task";
import { getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

const aiGeneratePlanMock = mock(async (request: { title: string; description?: string }): Promise<GenerateTaskPlanResponse> => ({
  source: "test-ai",
  blueprint: {
    title: `Plan for ${request.title}`,
    goal: request.description ?? request.title,
    nodes: [
      {
        id: "handle_task",
        type: "task" as const,
        title: `Handle ${request.title}`,
        expectedOutput: request.description ?? request.title,
      },
    ],
    edges: [],
  },
}));

mock.module("@/modules/ai/ai-service", () => ({
  aiGeneratePlan: aiGeneratePlanMock,
}));

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

  it("generates and saves a draft plan from persisted task fields", async () => {
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
    const node = saved?.plan.nodes[0];
    expect(node?.title).toBe("Handle Updated task title");
    expect(node?.objective).toBe("Updated description from DB");
    expect(node?.localId).toBe("handle_task");
    expect(node?.id).not.toBe(node?.localId);
    expect(saved?.plan.blueprint?.title).toBe("Plan for Updated task title");
    expect(saved?.plan.completionPolicy).toEqual({ type: "all_tasks_completed" });
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

  it("does not save an empty generated blueprint", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async () => ({
      source: "test-ai",
      blueprint: {
        title: "",
        goal: "",
        nodes: [],
        edges: [],
      },
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

  it("enriches compiled nodes and derives runtime dependencies", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async () => ({
      source: "test-ai",
      blueprint: {
        title: "Enriched plan",
        goal: "Test compiled enrichment",
        nodes: [
          {
            id: "auto_step",
            type: "task" as const,
            title: "Auto step",
            executor: "ai" as const,
            mode: "auto" as const,
          },
          {
            id: "approve_step",
            type: "checkpoint" as const,
            title: "Approve it",
            checkpointType: "approve" as const,
            prompt: "Approve before continuing",
          },
          {
            id: "manual_step",
            type: "task" as const,
            title: "Manual step",
            executor: "user" as const,
            mode: "manual" as const,
          },
        ],
        edges: [
          { from: "auto_step", to: "approve_step" },
          { from: "approve_step", to: "manual_step" },
        ],
      },
    }));

    const workspace = await db.workspace.create({
      data: { name: "Enriched Plan", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Enriched test task",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    const saved = await getLatestTaskPlanGraph(task.id);

    const autoNode = saved!.plan.nodes.find((node) => node.localId === "auto_step");
    const approvalNode = saved!.plan.nodes.find((node) => node.localId === "approve_step");
    const manualNode = saved!.plan.nodes.find((node) => node.localId === "manual_step");

    expect(autoNode?.executionClassification).toBe("automatic_standalone");
    expect(autoNode?.readiness).toBe("ready");
    expect(approvalNode?.executionClassification).toBe("review_gate");
    expect(approvalNode?.nextAction).toContain("Review and approve");
    expect(manualNode?.executionClassification).toBe("human_dependent");
    expect(manualNode?.dependencies).toEqual([approvalNode!.id]);
  });
});
