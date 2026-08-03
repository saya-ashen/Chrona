/* eslint-disable complexity, max-lines-per-function, @typescript-eslint/no-unnecessary-condition -- Generation persistence validates legacy provider output and concurrent plan heads. */
import { AiFeatureRunStatus, Prisma, TaskPlanGenerationHeadStatus, TaskPlanStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AiFeatureRuntimeError, stableJsonHash } from "@/modules/ai";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { createPlanGraphFromCompiledPlan, createEmptyPlanOutput } from "@/modules/plan-execution/persistence/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/persistence/plan-runtime-store";
import { compilePlanBlueprint } from "@chrona/domain";
import { upgradeBlueprintToEditable, type AiRunResult, type CompletionValidation, type CompiledPlan, type PlanBlueprint, type TaskPlanReadModel } from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { buildTaskPlanReadModel } from "./task-plan-read-model";
import { parseFrozenGoalTaskContext, type FrozenGoalTaskContext } from "@/modules/goals/goal-task-context";
import { validateTaskPlanBlueprint } from "./task-plan-blueprint-validation";
import { currentSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";
import { withSchedulerWorkOwnership } from "@/modules/orchestration/scheduler-lease-repository";

const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const scopeKey = (workBlockId: string | null) => workBlockId ?? "";
type HeadSnapshot = {
  stateVersion: number;
  currentPlanId: string | null;
  currentPlanRevision: number | null;
  currentPlanStatus: string | null;
  currentPlanContentHash: string | null;
  baselinePlanId: string | null;
  baselinePlanRevision: number | null;
  baselinePlanStatus: string | null;
  baselinePlanContentHash: string | null;
  baselineHash: string | null;
};

export type TaskPlanGenerationSnapshot = {
  task: {
    id: string;
    workspaceId: string;
    title: string;
    description: string | null;
    goalContext: FrozenGoalTaskContext | null;
    workBlockId: string | null;
    estimatedMinutes: number | null;
    executionRuntime: string;
  };
  head: HeadSnapshot;
  workBlockId: string | null;
};

export type PersistedTaskPlanGenerationCandidate = {
  runId: string;
  expectedRunStateVersion: number;
  leaseOwner: string | null;
  finishedAt: string;
  terminalResult: AiRunResult;
  completion: CompletionValidation;
  proposedActions: readonly unknown[];
  snapshot: TaskPlanGenerationSnapshot;
  userInstruction: string | null;
  selectedNodeId: string | null;
  blueprint: PlanBlueprint;
};

export type CommittedTaskPlanGeneration = {
  savedPlan: TaskPlanReadModel;
  planId: string;
  revision: number;
  headStateVersion: number;
};

export class TaskPlanHeadConflictError extends AiFeatureRuntimeError {
  constructor(message = "Task plan head changed concurrently.") {
    super({ code: "stale_plan_baseline", message });
    this.name = "TaskPlanHeadConflictError";
  }
}

function asReadModel(input: {
  taskId: string;
  blueprint: PlanBlueprint;
  compiledPlan: CompiledPlan;
  prompt: string | null;
  generatedBy: string;
  updatedAt: string;
}): TaskPlanReadModel {
  const graph = createPlanGraphFromCompiledPlan({ taskId: input.taskId, compiledPlan: input.compiledPlan });
  return buildTaskPlanReadModel({
    compiledPlan: input.compiledPlan,
    effectivePlanGraph: resolveEffectivePlanGraph({ graph }),
    blueprint: input.blueprint,
    status: "draft",
    prompt: input.prompt,
    summary: input.blueprint.title,
    generatedBy: input.generatedBy,
    updatedAt: input.updatedAt,
  });
}


/** Every field observed by the generator is part of the head compare-and-swap. */
function frozenHeadWhere(input: {
  taskId: string;
  workBlockId: string | null;
  snapshot: HeadSnapshot;
  runId: string;
}): Prisma.TaskPlanGenerationHeadWhereInput {
  return {
    taskId: input.taskId,
    workBlockScopeKey: scopeKey(input.workBlockId),
    stateVersion: input.snapshot.stateVersion,
    currentAiFeatureRunId: input.runId,
    currentPlanId: input.snapshot.currentPlanId,
    currentPlanRevision: input.snapshot.currentPlanRevision,
    currentPlanStatus: input.snapshot.currentPlanStatus === "accepted"
      ? TaskPlanStatus.Accepted
      : input.snapshot.currentPlanStatus === "draft"
        ? TaskPlanStatus.Draft
        : input.snapshot.currentPlanStatus === "superseded"
          ? TaskPlanStatus.Superseded
          : null,
    currentPlanContentHash: input.snapshot.currentPlanContentHash,
    baselinePlanId: input.snapshot.baselinePlanId,
    baselinePlanRevision: input.snapshot.baselinePlanRevision,
    baselinePlanStatus: input.snapshot.baselinePlanStatus === "accepted"
      ? TaskPlanStatus.Accepted
      : input.snapshot.baselinePlanStatus === "draft"
        ? TaskPlanStatus.Draft
        : input.snapshot.baselinePlanStatus === "superseded"
          ? TaskPlanStatus.Superseded
          : null,
    baselinePlanContentHash: input.snapshot.baselinePlanContentHash,
    baselineHash: input.snapshot.baselineHash,
  };
}

async function seedGenerationCommitEffects(
  tx: Prisma.TransactionClient,
  input: { taskId: string; workspaceId: string; workBlockId: string | null; planId: string; operationId: string; headStateVersion: number; summary: string; occurredAt: Date },
) {
  const task = await tx.task.findUnique({ where: { id: input.taskId }, select: { workspaceId: true, status: true } });
  if (!task || task.workspaceId !== input.workspaceId) {
    throw new TaskPlanHeadConflictError("Task identity changed before the plan generation could commit.");
  }
  const latest = await tx.event.aggregate({ _max: { ingestSequence: true } });
  await tx.event.upsert({
    where: { dedupeKey: `plan_generation:${input.taskId}:${input.operationId}:completed` },
    update: {},
    create: {
      eventType: "plan_generation.completed",
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      workBlockId: input.workBlockId,
      planId: input.planId,
      actorType: "system",
      actorId: "plan-generator",
      source: "plan_generation",
      payload: asJson({ plan_id: input.planId, generation_id: input.operationId, head_state_version: input.headStateVersion, plan_title: input.summary }),
      dedupeKey: `plan_generation:${input.taskId}:${input.operationId}:completed`,
      occurredAt: input.occurredAt,
      ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
    },
  });
  await tx.taskProjection.upsert({
    where: { taskId: input.taskId },
    update: { workspaceId: input.workspaceId },
    create: { taskId: input.taskId, workspaceId: input.workspaceId, persistedStatus: task.status },
  });
}

/** A rejected head-link must not strand a CommittingResult feature run or its generation pointer. */
export async function terminalizeOrphanedTaskPlanGeneration(input: {
  runId: string;
  expectedRunStateVersion?: number;
  leaseOwner?: string | null;
  message: string;
}) {
  const where: Prisma.AiFeatureRunWhereInput = {
    id: input.runId,
    status: AiFeatureRunStatus.CommittingResult,
    ...(input.expectedRunStateVersion === undefined ? {} : { stateVersion: input.expectedRunStateVersion }),
    ...(input.leaseOwner === undefined ? {} : { leaseOwner: input.leaseOwner }),
  };
  await withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
    const terminalized = await tx.aiFeatureRun.updateMany({
      where,
      data: {
        status: AiFeatureRunStatus.Failed,
        stateVersion: { increment: 1 },
        commitStatus: "orphaned",
        errorCode: "stale_plan_baseline",
        errorMessage: input.message,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (terminalized.count !== 1) return;
    await tx.taskPlanGenerationHead.updateMany({
      where: { currentAiFeatureRunId: input.runId, currentPlanId: null },
      data: { status: TaskPlanGenerationHeadStatus.Idle, stateVersion: { increment: 1 } },
    });
    await tx.taskPlanGenerationHead.updateMany({
      where: { currentAiFeatureRunId: input.runId, currentPlanId: { not: null } },
      data: { status: TaskPlanGenerationHeadStatus.Current, stateVersion: { increment: 1 } },
    });
  });
}

/** Captures the task/head baseline once. Runtime-owned observations are frozen separately with the feature run. */
export async function captureTaskPlanGenerationSnapshot(input: {
  taskId: string;
  workBlockId?: string | null;
}): Promise<TaskPlanGenerationSnapshot | null> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      workBlocks: {
        where: input.workBlockId ? { id: input.workBlockId } : { status: { in: ["Scheduled", "Active"] } },
        orderBy: { scheduledStartAt: "asc" },
        take: 1,
      },
    },
  });
  if (!task) return null;
  const workBlock = task.workBlocks[0] ?? null;
  if (input.workBlockId != null && workBlock?.id !== input.workBlockId) return null;
  const workBlockId = workBlock?.id ?? null;
  const head = await db.taskPlanGenerationHead.findUnique({
    where: { taskId_workBlockScopeKey: { taskId: task.id, workBlockScopeKey: scopeKey(workBlockId) } },
  });
  const estimatedMinutes = workBlock
    ? Math.round((workBlock.scheduledEndAt.getTime() - workBlock.scheduledStartAt.getTime()) / 60_000)
    : null;
  const goalContext = task.goalContext ? parseFrozenGoalTaskContext(task.goalContext) : null;
  return {
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      description: task.description,
      goalContext,
      workBlockId,
      estimatedMinutes: estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : null,
      executionRuntime: task.executionRuntime,
    },
    workBlockId,
    head: {
      stateVersion: head?.stateVersion ?? 0,
      currentPlanId: head?.currentPlanId ?? null,
      currentPlanRevision: head?.currentPlanRevision ?? null,
      currentPlanStatus: head?.currentPlanStatus?.toLowerCase() ?? null,
      currentPlanContentHash: head?.currentPlanContentHash ?? null,
      baselinePlanId: head?.baselinePlanId ?? null,
      baselinePlanRevision: head?.baselinePlanRevision ?? null,
      baselinePlanStatus: head?.baselinePlanStatus?.toLowerCase() ?? null,
      baselinePlanContentHash: head?.baselinePlanContentHash ?? null,
      baselineHash: head?.baselineHash ?? null,
    },
  };
}

/**
 * Sole TaskPlan generation persistence entry. The feature runtime has already
 * claimed and frozen the candidate; this transaction atomically creates the
 * plan/runtime graph, advances the head, and terminalizes that exact run.
 */
export async function commitTaskPlanGeneration(input: {
  candidate: PersistedTaskPlanGenerationCandidate;
  generatedBy?: string;
}): Promise<CommittedTaskPlanGeneration> {
  const validation = validateTaskPlanBlueprint(input.candidate.blueprint);
  if (!validation.ok) throw new Error(validation.issues.map((issue) => issue.message).join(" "));

  const { compiledPlan, planId } = compilePlanBlueprint({
    taskId: input.candidate.snapshot.task.id,
    blueprint: input.candidate.blueprint,
    planId: `plan_${input.candidate.runId}`,
    generatedBy: input.generatedBy ?? "ai",
    source: "ai",
  });
  const editablePlan = upgradeBlueprintToEditable(input.candidate.blueprint, planId, 1);
  const contentHash = stableJsonHash(editablePlan);
  const run = createPlanRunFromCompiledPlan(compiledPlan);
  const graph = createPlanGraphFromCompiledPlan({ taskId: input.candidate.snapshot.task.id, compiledPlan });
  const now = new Date();
  const scope = input.candidate.snapshot.workBlockId;
  const committedHeadStateVersion = input.candidate.snapshot.head.stateVersion + 1;
  try {
    await withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const frozenHead = frozenHeadWhere({
        taskId: input.candidate.snapshot.task.id,
        workBlockId: scope,
        snapshot: input.candidate.snapshot.head,
        runId: input.candidate.runId,
      });
      const head = await tx.taskPlanGenerationHead.findFirst({ where: frozenHead });
      if (!head || head.status !== TaskPlanGenerationHeadStatus.Generating) {
        throw new TaskPlanHeadConflictError();
      }
      const committingRun = await tx.aiFeatureRun.findFirst({
        where: {
          id: input.candidate.runId,
          stateVersion: input.candidate.expectedRunStateVersion,
          status: AiFeatureRunStatus.CommittingResult,
          ...(input.candidate.leaseOwner ? { leaseOwner: input.candidate.leaseOwner } : { leaseOwner: null }),
        },
        select: { id: true, operationId: true },
      });
      if (!committingRun) {
        throw new TaskPlanHeadConflictError("Feature run changed before plan generation could commit.");
      }

      await tx.taskPlan.updateMany({
        where: { taskId: input.candidate.snapshot.task.id, workBlockId: scope, status: TaskPlanStatus.Draft },
        data: { status: TaskPlanStatus.Superseded },
      });
      await tx.taskPlan.create({
        data: {
          workspaceId: input.candidate.snapshot.task.workspaceId,
          taskId: input.candidate.snapshot.task.id,
          workBlockId: scope,
          planId,
          revision: compiledPlan.sourceVersion,
          status: TaskPlanStatus.Draft,
          prompt: input.candidate.userInstruction,
          summary: input.candidate.blueprint.title,
          generatedBy: input.generatedBy ?? "ai",
          compiledPlan: asJson(compiledPlan),
          editablePlan: asJson(editablePlan),
          aiFeatureRunId: input.candidate.runId,
        },
      });
      await tx.taskPlanRun.create({
        data: {
          workspaceId: input.candidate.snapshot.task.workspaceId,
          taskId: input.candidate.snapshot.task.id,
          workBlockId: scope,
          workBlockScopeKey: scopeKey(scope),
          planId,
          planRun: asJson({
            planRun: run,
            mutableGraph: { graph, attempts: [], results: [], executionContextSnapshots: [], planOutput: createEmptyPlanOutput() },
          }),
        },
      });
      const headUpdate = await tx.taskPlanGenerationHead.updateMany({
        where: frozenHead,
        data: {
          baselinePlanId: input.candidate.snapshot.head.currentPlanId ?? input.candidate.snapshot.head.baselinePlanId,
          baselinePlanRevision: input.candidate.snapshot.head.currentPlanRevision ?? input.candidate.snapshot.head.baselinePlanRevision,
          baselinePlanStatus: input.candidate.snapshot.head.currentPlanStatus === "accepted"
            ? TaskPlanStatus.Accepted
            : input.candidate.snapshot.head.currentPlanStatus === "draft"
              ? TaskPlanStatus.Draft
              : input.candidate.snapshot.head.currentPlanStatus === "superseded"
                ? TaskPlanStatus.Superseded
                : input.candidate.snapshot.head.baselinePlanStatus === "accepted"
                  ? TaskPlanStatus.Accepted
                  : input.candidate.snapshot.head.baselinePlanStatus === "draft"
                    ? TaskPlanStatus.Draft
                    : input.candidate.snapshot.head.baselinePlanStatus === "superseded"
                      ? TaskPlanStatus.Superseded
                      : null,
          baselinePlanContentHash: input.candidate.snapshot.head.currentPlanContentHash ?? input.candidate.snapshot.head.baselinePlanContentHash,
          baselineHash: input.candidate.snapshot.head.currentPlanContentHash ?? input.candidate.snapshot.head.baselineHash,
          currentPlanId: planId,
          currentPlanRevision: compiledPlan.sourceVersion,
          currentPlanContentHash: contentHash,
          currentPlanStatus: TaskPlanStatus.Draft,
          generationVersion: { increment: 1 },
          stateVersion: { increment: 1 },
          status: TaskPlanGenerationHeadStatus.Current,
        },
      });
      if (headUpdate.count !== 1) throw new TaskPlanHeadConflictError();

      const runUpdate = await tx.aiFeatureRun.updateMany({
        where: {
          id: input.candidate.runId,
          stateVersion: input.candidate.expectedRunStateVersion,
          status: AiFeatureRunStatus.CommittingResult,
          ...(input.candidate.leaseOwner ? { leaseOwner: input.candidate.leaseOwner } : { leaseOwner: null }),
        },
        data: {
          status: AiFeatureRunStatus.Completed,
          stateVersion: { increment: 1 },
          terminalResult: asJson(input.candidate.terminalResult),
          completionReport: asJson(input.candidate.completion),
          proposedActions: asJson(input.candidate.proposedActions),
          commitStatus: "committed",
          commitReference: asJson({ planId, revision: compiledPlan.sourceVersion, headStateVersion: committedHeadStateVersion }),
          finishedAt: new Date(input.candidate.finishedAt),
          committedAt: now,
        },
      });
      if (runUpdate.count !== 1) {
        throw new TaskPlanHeadConflictError("Feature run changed before plan generation could commit.");
      }
      await seedGenerationCommitEffects(tx, {
        taskId: input.candidate.snapshot.task.id,
        workspaceId: input.candidate.snapshot.task.workspaceId,
        workBlockId: scope,
        planId,
        operationId: committingRun.operationId,
        headStateVersion: committedHeadStateVersion,
        summary: input.candidate.blueprint.title,
        occurredAt: now,
      });
    });
  } catch (cause) {
    if (cause instanceof TaskPlanHeadConflictError) {
      await terminalizeOrphanedTaskPlanGeneration({
        runId: input.candidate.runId,
        expectedRunStateVersion: input.candidate.expectedRunStateVersion,
        leaseOwner: input.candidate.leaseOwner,
        message: cause.message,
      });
    }
    throw cause;
  }
  publishTaskWorkspaceUpdatedEvent({
    taskId: input.candidate.snapshot.task.id,
    workspaceId: input.candidate.snapshot.task.workspaceId,
    workBlockId: scope,
    reason: "plan_generation.completed",
  });

  return {
    savedPlan: asReadModel({
      taskId: input.candidate.snapshot.task.id,
      blueprint: input.candidate.blueprint,
      compiledPlan,
      prompt: input.candidate.userInstruction,
      generatedBy: input.generatedBy ?? "ai",
      updatedAt: now.toISOString(),
    }),
    planId,
    revision: compiledPlan.sourceVersion,
    headStateVersion: committedHeadStateVersion,
  };
}

export async function failTaskPlanGenerationCandidate(input: { runId: string; message: string }) {
  await withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
    await tx.aiFeatureRun.updateMany({
      where: { id: input.runId, status: { notIn: [AiFeatureRunStatus.Completed, AiFeatureRunStatus.Cancelled] } },
      data: { status: AiFeatureRunStatus.Failed, errorCode: "generation_failed", errorMessage: input.message, finishedAt: new Date() },
    });
  });
}
