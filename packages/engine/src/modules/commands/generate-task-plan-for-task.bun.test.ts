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

  it("enriches plan nodes with executionClassification, readiness, and nextAction", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async (request: { title: string }) => ({
      source: "test-ai",
      summary: `Enriched plan for ${request.title}`,
      reasoning: "test",
      nodes: [
        {
          id: "e-node-1",
          type: "task" as const,
          title: "Auto step",
          objective: "Runs without human input",
          description: null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: null,
          priority: "Medium" as const,
          executionMode: "automatic" as const,
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
        {
          id: "e-node-2",
          type: "task" as const,
          title: "Needs human review",
          objective: "Requires approval before proceeding",
          description: null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: null,
          priority: "High" as const,
          executionMode: "manual" as const,
          requiresHumanInput: false,
          requiresHumanApproval: true,
          autoRunnable: false,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
        {
          id: "e-node-3",
          type: "task" as const,
          title: "Needs user input",
          objective: "Requires information from the user",
          description: null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: null,
          priority: "Medium" as const,
          executionMode: "hybrid" as const,
          requiresHumanInput: true,
          requiresHumanApproval: false,
          autoRunnable: false,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
      ] as any,
      edges: [
        { id: "e-edge-1", fromNodeId: "e-node-1", toNodeId: "e-node-2", type: "sequential" },
        { id: "e-edge-2", fromNodeId: "e-node-2", toNodeId: "e-node-3", type: "sequential" },
      ] as any,
    }) as any);

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

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    expect(result).not.toBeNull();

    const saved = await getLatestTaskPlanGraph(task.id);
    expect(saved).not.toBeNull();

    const autoNode = saved!.plan.nodes.find((n) => n.id === "e-node-1");
    expect(autoNode?.executionClassification).toBe("automatic_standalone");
    expect(autoNode?.readiness).toBe("ready");
    expect(autoNode?.autoRunnable).toBe(true);

    const approvalNode = saved!.plan.nodes.find((n) => n.id === "e-node-2");
    expect(approvalNode?.executionClassification).toBe("review_gate");
    expect(approvalNode?.nextAction).toContain("Review and approve");

    const inputNode = saved!.plan.nodes.find((n) => n.id === "e-node-3");
    expect(inputNode?.executionClassification).toBe("human_dependent");
    expect(inputNode?.nextAction).toContain("Provide required information");
  });

  it("enriches standalone nodes as automatic_standalone", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async (request: { title: string }) => ({
      source: "test-ai",
      summary: `Standalone plan for ${request.title}`,
      reasoning: "test",
      nodes: [{
        id: "s-node-1",
        type: "task" as const,
        title: "Standalone task",
        objective: "No dependencies",
        description: null,
        status: "pending" as const,
        phase: null,
        estimatedMinutes: null,
        priority: "Medium" as const,
        executionMode: "automatic" as const,
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: null,
      }] as any,
      edges: [] as any,
    }) as any);

    const workspace = await db.workspace.create({
      data: { name: "Standalone", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Standalone test",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    const saved = await getLatestTaskPlanGraph(task.id);

    const node = saved!.plan.nodes[0];
    expect(node?.executionClassification).toBe("automatic_standalone");
    expect(node?.readiness).toBe("ready");
    expect(node?.nextAction).toContain("Ready to auto-start");
  });

  it("marks blocked nodes with readiness blocked", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async (request: { title: string }) => ({
      source: "test-ai",
      summary: `Blocked plan for ${request.title}`,
      reasoning: "test",
      nodes: [{
        id: "b-node-1",
        type: "task" as const,
        title: "Blocked step",
        objective: "Cannot proceed",
        description: null,
        status: "pending" as const,
        phase: null,
        estimatedMinutes: null,
        priority: "Medium" as const,
        executionMode: "automatic" as const,
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: false,
        blockingReason: "external_dependency",
        linkedTaskId: null,
        completionSummary: null,
        metadata: null,
      }] as any,
      edges: [] as any,
    }) as any);

    const workspace = await db.workspace.create({
      data: { name: "Blocked", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Blocked test",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    const saved = await getLatestTaskPlanGraph(task.id);

    const node = saved!.plan.nodes[0];
    expect(node?.readiness).toBe("blocked");
    expect(node?.nextAction).toContain("Resolve external dependency");
  });

  it("set dependencies array on nodes with incoming edges", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async (request: { title: string }) => ({
      source: "test-ai",
      summary: `Chained plan for ${request.title}`,
      reasoning: "test",
      nodes: [
        {
          id: "d-node-1",
          type: "task" as const,
          title: "First step",
          objective: "Step one",
          description: null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: null,
          priority: "Medium" as const,
          executionMode: "automatic" as const,
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
        {
          id: "d-node-2",
          type: "task" as const,
          title: "Second step",
          objective: "Step two",
          description: null,
          status: "pending" as const,
          phase: null,
          estimatedMinutes: null,
          priority: "Medium" as const,
          executionMode: "automatic" as const,
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
      ] as any,
      edges: [
        { id: "d-edge-1", fromNodeId: "d-node-1", toNodeId: "d-node-2", type: "depends_on" },
      ] as any,
    }) as any);

    const workspace = await db.workspace.create({
      data: { name: "Deps", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Deps test",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    const saved = await getLatestTaskPlanGraph(task.id);

    const firstNode = saved!.plan.nodes.find((n) => n.id === "d-node-1");
    const secondNode = saved!.plan.nodes.find((n) => n.id === "d-node-2");

    expect(firstNode?.dependencies).toBeUndefined();
    expect(secondNode?.dependencies).toEqual(["d-node-1"]);
  });
});
