import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { getSchedulePage } from "@/modules/pages/get-schedule-page";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.workBlock.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.aiFeatureBinding.deleteMany();
  await db.aiClient.deleteMany();
  await db.workspace.deleteMany();
}

const PAST = new Date(Date.now() - 60 * 60 * 1000);
const PAST_END = new Date(Date.now() - 30 * 60 * 1000);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(Date.now() + 25 * 60 * 60 * 1000);

async function seedScheduledBlock(input: {
  workspaceId: string;
  status?: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  accepted?: boolean;
}) {
  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: "Auto-start candidate",
      status: (input.status ?? "Ready") as never,
      priority: "Medium",
      executionConfig: {},
      autoExecute: true,
      autoExecuteTiming: "at_start",
    },
  });
  const start = input.scheduledStartAt ?? PAST;
  const end = input.scheduledEndAt ?? PAST_END;
  const workBlock = await db.workBlock.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: task.id,
      title: task.title,
      status: "Scheduled",
      scheduledStartAt: start,
      scheduledEndAt: end,
      trigger: "manual",
    },
  });
  await db.taskProjection.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: task.id,
      persistedStatus: input.status ?? "Ready",
      displayState: input.status ?? "Ready",
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      scheduledStartAt: start,
      scheduledEndAt: end,
    },
  });
  if (input.accepted) {
    await saveCompiledPlan({
      workspaceId: input.workspaceId,
      taskId: task.id,
      workBlockId: workBlock.id,
      status: "accepted",
      prompt: "plan",
      summary: "Accepted plan",
      generatedBy: "generate-task-plan",
      compiledPlan: {
        id: "compiled-1",
        editablePlanId: "plan-1",
        sourceVersion: 1,
        title: "Plan",
        goal: "Goal",
        assumptions: [],
        nodes: [],
        edges: [],
        entryNodeIds: [],
        terminalNodeIds: [],
        topologicalOrder: [],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });
  }
  return { task, workBlock };
}

function findBlock(page: Awaited<ReturnType<typeof getSchedulePage>>, taskId: string) {
  return page.scheduled.find(
    (item) => (item as { taskId: string }).taskId === taskId,
  ) as
    | { autoStartEligible?: boolean; autoStartReason?: string | null }
    | undefined;
}

describe("getSchedulePage auto-start eligibility reason", () => {
  beforeEach(async () => {
    await resetDb();
    await db.aiClient.create({
      data: {
        name: "OMP",
        type: "omp",
        config: {},
        isDefault: true,
        enabled: true,
      },
    });
  });

  afterAll(async () => {
    await resetDb();
  });

  it("reports no_accepted_plan when a due block lacks an accepted plan", async () => {
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({ workspaceId: workspace.id });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(false);
    expect(block?.autoStartReason).toBe("no_accepted_plan");
  });

  it("reports no_provider_config when the task has no AI provider", async () => {
    await db.aiClient.deleteMany();
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({
      workspaceId: workspace.id,
      accepted: true,
    });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(false);
    expect(block?.autoStartReason).toBe("no_provider_config");
  });

  it("reports already_running when the task has an active run", async () => {
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({
      workspaceId: workspace.id,
      accepted: true,
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: "WaitingForInput",
        triggeredBy: "scheduler",
      },
    });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(false);
    expect(block?.autoStartReason).toBe("already_running");
  });

  it("reports not_due when the block is scheduled in the future", async () => {
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({
      workspaceId: workspace.id,
      scheduledStartAt: FUTURE,
      scheduledEndAt: FUTURE_END,
      accepted: true,
    });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(false);
    expect(block?.autoStartReason).toBe("not_due");
  });

  it("reports invalid_task_status when the task status cannot auto-start", async () => {
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({
      workspaceId: workspace.id,
      status: "Blocked",
      accepted: true,
    });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(false);
    expect(block?.autoStartReason).toBe("invalid_task_status");
  });

  it("returns ok with a null reason when the block is fully eligible", async () => {
    const workspace = await db.workspace.create({
      data: { name: "ws", status: "Active" },
    });
    const { task } = await seedScheduledBlock({
      workspaceId: workspace.id,
      accepted: true,
    });

    const page = await getSchedulePage(workspace.id);
    const block = findBlock(page, task.id);
    expect(block?.autoStartEligible).toBe(true);
    expect(block?.autoStartReason).toBeNull();
  });
});
