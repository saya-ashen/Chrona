import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { RunStatus, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { createMockOpenClawAdapter } from "@/modules/openclaw/mock-adapter";

const progressAcceptedTaskPlanMock = mock(async () => ({
  parentTaskId: "parent",
  startedTaskIds: [],
  materializedTaskIds: [],
  readyNodeIds: [],
  parentCompleted: false,
}));

mock.module("@/modules/commands/progress-accepted-task-plan", () => ({
  progressAcceptedTaskPlan: progressAcceptedTaskPlanMock,
}));

const { syncRunFromRuntime } = await import("@/modules/runtime-sync/sync-run");

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

async function seedLinkedChildRun() {
  const workspace = await db.workspace.create({
    data: {
      name: "Parent state workspace",
      defaultRuntime: "openclaw",
      status: "Active",
    },
  });

  const parentTask = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Parent task",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
    },
  });

  const childTask = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Child node task",
      status: TaskStatus.Running,
      priority: TaskPriority.Medium,
      ownerType: "human",
      parentTaskId: parentTask.id,
    },
  });

  const run = await db.run.create({
    data: {
      taskId: childTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "runtime_waiting_1",
      runtimeSessionRef: "agent:main:dashboard:session_waiting_1",
      status: RunStatus.Running,
      triggeredBy: "user",
    },
  });

  await db.task.update({
    where: { id: childTask.id },
    data: { latestRunId: run.id },
  });

  await saveTaskPlanGraph({
    workspaceId: workspace.id,
    taskId: parentTask.id,
    status: "accepted",
    source: "ai",
    generatedBy: "test",
    prompt: "plan",
    plan: {
      version: "task-plan-graph@1",
      summary: "Parent state graph",
      nodes: [
        {
          id: "node-child",
          type: "step",
          title: "Child node task",
          objective: "Do the child task",
          description: null,
          status: "pending",
          phase: null,
          estimatedMinutes: 10,
          priority: "Medium",
          executionMode: "automatic",
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: childTask.id,
          completionSummary: null,
          metadata: null,
        },
      ],
      edges: [],
    },
  });

  return { parentTask, childTask, run };
}

describe("parent task accepted-plan derived states", () => {
  beforeEach(async () => {
    progressAcceptedTaskPlanMock.mockClear();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("moves parent task to WaitingForApproval when a linked child run waits for approval", async () => {
    const { parentTask, run } = await seedLinkedChildRun();

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({ fixtureName: "run-waiting-approval" }),
    });

    const updatedParent = await db.task.findUniqueOrThrow({ where: { id: parentTask.id } });
    expect(updatedParent.status).toBe(TaskStatus.WaitingForApproval);
  });

  it("moves parent task to WaitingForInput when a linked child run waits for input", async () => {
    const { parentTask, run } = await seedLinkedChildRun();

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({
        fixture: {
          snapshot: {
            runtimeRunRef: "runtime_input_1",
            runtimeSessionRef: "session_input_1",
            runtimeSessionKey: "agent:main:dashboard:session_input_1",
            rawStatus: "waiting_for_input",
            status: "WaitingForInput",
            lastMessage: "Need clarification.",
          },
          history: { messages: [] },
          approvals: [],
        },
      }),
    });

    const updatedParent = await db.task.findUniqueOrThrow({ where: { id: parentTask.id } });
    expect(updatedParent.status).toBe(TaskStatus.WaitingForInput);
  });
});
