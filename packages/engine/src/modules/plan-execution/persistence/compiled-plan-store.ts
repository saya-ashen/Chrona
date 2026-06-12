import { Prisma, TaskPlanStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { CompiledPlan, EditablePlan } from "@chrona/contracts/ai";

export type PlanStatus = "draft" | "accepted" | "superseded" | "archived";

const TASK_PLAN_STATUS_TO_DB: Record<PlanStatus, TaskPlanStatus> = {
  draft: TaskPlanStatus.Draft,
  accepted: TaskPlanStatus.Accepted,
  superseded: TaskPlanStatus.Superseded,
  archived: TaskPlanStatus.Archived,
};

const TASK_PLAN_STATUS_FROM_DB: Record<TaskPlanStatus, PlanStatus> = {
  [TaskPlanStatus.Draft]: "draft",
  [TaskPlanStatus.Accepted]: "accepted",
  [TaskPlanStatus.Superseded]: "superseded",
  [TaskPlanStatus.Archived]: "archived",
};

export type SavedCompiledPlan = {
  recordId: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  compiledPlan: CompiledPlan;
  editablePlan: EditablePlan | null;
  status: PlanStatus;
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asNullableJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function toSavedCompiledPlan(row: {
  id: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  compiledPlan: unknown;
  editablePlan: unknown;
  status: TaskPlanStatus;
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedCompiledPlan {
  return {
    recordId: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    workBlockId: row.workBlockId,
    compiledPlan: row.compiledPlan as CompiledPlan,
    editablePlan: (row.editablePlan as EditablePlan | null) ?? null,
    status: TASK_PLAN_STATUS_FROM_DB[row.status],
    prompt: row.prompt,
    summary: row.summary,
    generatedBy: row.generatedBy,
    changeSummary: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveCompiledPlan(input: {
  workspaceId: string;
  taskId: string;
  workBlockId?: string | null;
  compiledPlan: CompiledPlan;
  editablePlan?: EditablePlan | null;
  status: PlanStatus;
  prompt?: string | null;
  summary?: string | null;
  generatedBy?: string | null;
}): Promise<void> {
  const planId = input.compiledPlan.editablePlanId;
  const status = TASK_PLAN_STATUS_TO_DB[input.status];

  await db.$transaction(async (tx) => {
    if (status === TaskPlanStatus.Accepted) {
      await tx.taskPlan.updateMany({
        where: {
          taskId: input.taskId,
          workBlockId: input.workBlockId ?? null,
          planId: { not: planId },
          status: { in: [TaskPlanStatus.Draft, TaskPlanStatus.Accepted] },
        },
        data: {
          status: TaskPlanStatus.Superseded,
        },
      });
    }

    await tx.taskPlan.upsert({
      where: { planId },
      create: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        workBlockId: input.workBlockId ?? null,
        planId,
        revision: input.compiledPlan.sourceVersion,
        status,
        prompt: input.prompt ?? null,
        summary: input.summary ?? null,
        generatedBy: input.generatedBy ?? null,
        compiledPlan: asJsonValue(input.compiledPlan),
        editablePlan: asNullableJsonValue(input.editablePlan ?? null),
      },
      update: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        workBlockId: input.workBlockId ?? null,
        revision: input.compiledPlan.sourceVersion,
        status,
        prompt: input.prompt ?? null,
        summary: input.summary ?? null,
        generatedBy: input.generatedBy ?? null,
        compiledPlan: asJsonValue(input.compiledPlan),
        editablePlan: asNullableJsonValue(input.editablePlan ?? null),
      },
    });
  });
}

export async function getAcceptedCompiledPlan(
  taskId: string,
  workBlockId?: string | null,
): Promise<SavedCompiledPlan | null> {
  const row = await db.taskPlan.findFirst({
    where: {
      taskId,
      workBlockId: workBlockId ?? null,
      status: TaskPlanStatus.Accepted,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return row ? toSavedCompiledPlan(row) : null;
}

export async function getCompiledPlanByPlanId(
  taskId: string,
  planId: string,
): Promise<SavedCompiledPlan | null> {
  const row = await db.taskPlan.findFirst({
    where: { taskId, planId },
  });

  return row ? toSavedCompiledPlan(row) : null;
}

export async function getLatestCompiledPlan(
  taskId: string,
  workBlockId?: string | null,
): Promise<SavedCompiledPlan | null> {
  const row = await db.taskPlan.findFirst({
    where: {
      taskId,
      ...(workBlockId !== undefined ? { workBlockId } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return row ? toSavedCompiledPlan(row) : null;
}

export type PlanScope = { workBlockId: string | null; planId: string };

/**
 * The work block the task's most-recently-touched plan belongs to, regardless
 * of scope. Used to recover a concrete work block when no live ExecutionSession
 * exists (reads before/after a run). `accepted` is preferred over any draft so
 * a stale in-flight draft never shadows the plan that actually ran.
 */
export async function getLatestPlanScope(
  taskId: string,
  options?: { acceptedOnly?: boolean },
): Promise<PlanScope | null> {
  const row = await db.taskPlan.findFirst({
    where: {
      taskId,
      ...(options?.acceptedOnly ? { status: TaskPlanStatus.Accepted } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { workBlockId: true, planId: true },
  });
  return row ? { workBlockId: row.workBlockId, planId: row.planId } : null;
}

export async function updateLatestCompiledPlanPrompt(input: {
  taskId: string;
  prompt: string | null;
  workBlockId?: string | null;
}): Promise<void> {
  const row = await db.taskPlan.findFirst({
    where: { taskId: input.taskId, workBlockId: input.workBlockId ?? null },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });

  if (!row) return;

  await db.taskPlan.update({
    where: { id: row.id },
    data: { prompt: input.prompt },
  });
}
