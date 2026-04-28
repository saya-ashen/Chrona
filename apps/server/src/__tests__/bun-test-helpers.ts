import { MemoryScope, MemorySourceType, MemoryStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";

// ---------------------------------------------------------------------------
// Live smoke flag — skip live tests by default
// ---------------------------------------------------------------------------

export const runLiveOpenClaw = process.env.CHRONA_LIVE_OPENCLAW_TESTS === "1";

// ---------------------------------------------------------------------------
// Database reset
// ---------------------------------------------------------------------------

export async function resetTestDb() {
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

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export interface SeedWorkspaceResult {
  workspaceId: string;
}

export async function seedWorkspace(name?: string): Promise<SeedWorkspaceResult> {
  const workspace = await db.workspace.create({
    data: { name: name ?? "Test Workspace", status: "Active", defaultRuntime: "openclaw" },
  });
  return { workspaceId: workspace.id };
}

export interface SeedTaskResult {
  workspaceId: string;
  taskId: string;
}

export async function seedTask(workspaceId: string, overrides?: {
  title?: string;
  status?: string;
  priority?: string;
  parentTaskId?: string;
  dueAt?: Date;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
}): Promise<SeedTaskResult> {
  const task = await db.task.create({
    data: {
      workspaceId,
      title: overrides?.title ?? "Test Task",
      status: (overrides?.status ?? "Ready") as any,
      priority: (overrides?.priority ?? "Medium") as any,
      ownerType: "human",
      parentTaskId: overrides?.parentTaskId ?? null,
      dueAt: overrides?.dueAt ?? null,
      scheduledStartAt: overrides?.scheduledStartAt ?? null,
      scheduledEndAt: overrides?.scheduledEndAt ?? null,
    },
  });
  return { workspaceId, taskId: task.id };
}

export interface SeedDraftPlanOptions {
  nodes?: Array<{
    id: string;
    type?: string;
    title?: string;
    objective?: string;
    description?: string;
    status?: string;
    phase?: string;
    estimatedMinutes?: number;
    priority?: string;
    executionMode?: string;
    requiresHumanInput?: boolean;
    requiresHumanApproval?: boolean;
    autoRunnable?: boolean;
    blockingReason?: string | null;
    linkedTaskId?: string | null;
    completionSummary?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  edges?: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type?: string;
    metadata?: Record<string, unknown> | null;
  }>;
}

export async function seedDraftPlan(
  taskId: string,
  workspaceId: string,
  options?: SeedDraftPlanOptions,
) {
  const nodes = options?.nodes ?? [
    {
      id: "node-1",
      type: "step",
      title: "Research",
      objective: "Research the topic",
      description: "Gather requirements",
      status: "pending",
      phase: "preparation",
      estimatedMinutes: 30,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
    },
    {
      id: "node-2",
      type: "step",
      title: "Implement",
      objective: "Implement the solution",
      description: null,
      status: "pending",
      phase: "execution",
      estimatedMinutes: 60,
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
  ];

  const edges = options?.edges ?? [
    { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential", metadata: null },
  ];

  const content = JSON.stringify({
    type: "task_plan_graph_v1",
    status: "draft",
    revision: 1,
    source: "ai",
    generatedBy: "test-fixture",
    prompt: "Test plan prompt",
    summary: "A test plan",
    changeSummary: null,
    nodes,
    edges,
  });

  const memory = await db.memory.create({
    data: {
      workspaceId,
      taskId,
      content,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 0.7,
    },
  });

  return {
    planId: memory.id,
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export async function expectTaskExists(taskId: string): Promise<Record<string, unknown>> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Expected task ${taskId} to exist`);
  return task as unknown as Record<string, unknown>;
}

export async function expectTaskNotFound(taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (task) throw new Error(`Expected task ${taskId} to NOT exist`);
}

export async function expectPlanState(
  taskId: string,
  expected: {
    aiPlanGenerationStatus?: string;
    hasSavedAiPlan?: boolean;
    planStatus?: string;
    nodeCount?: number;
  },
) {
  const savedAiPlan =
    (await db.memory.findFirst({
      where: {
        taskId,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }));

  if (expected.hasSavedAiPlan === true && !savedAiPlan) {
    throw new Error(`Expected savedAiPlan for task ${taskId} to exist`);
  }
  if (expected.hasSavedAiPlan === false && savedAiPlan) {
    throw new Error(`Expected no savedAiPlan for task ${taskId}`);
  }

  if (expected.planStatus && savedAiPlan) {
    const payload = JSON.parse(savedAiPlan.content);
    if ((payload as any).status !== expected.planStatus) {
      throw new Error(
        `Expected plan status "${expected.planStatus}" but got "${(payload as any).status}"`,
      );
    }
  }

  if (expected.nodeCount !== undefined && savedAiPlan) {
    const payload = JSON.parse(savedAiPlan.content);
    if (!Array.isArray((payload as any).nodes) || (payload as any).nodes.length !== expected.nodeCount) {
      throw new Error(
        `Expected ${expected.nodeCount} nodes but got ${(payload as any).nodes?.length ?? 0}`,
      );
    }
  }
}
