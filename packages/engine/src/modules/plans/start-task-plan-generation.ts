/* eslint-disable max-lines-per-function, complexity -- Plan generation coordinates durable feature runs and plan-head CAS explicitly. */
import { AiFeatureRunStatus, TaskPlanGenerationHeadStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AiFeatureRuntimeError } from "@/modules/ai";
import { taskPlanGenerateInputSchema } from "./ai/task.plan.generate";
import { startTaskPlanGenerateFeature } from "./ai/task-plan-generate-run";
import {
  captureTaskPlanGenerationSnapshot,
  TaskPlanHeadConflictError,
  type TaskPlanGenerationSnapshot,
} from "./task-plan-generation-persistence";
import { withSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";

const scopeKey = (workBlockId: string | null) => workBlockId ?? "";

export type StartedTaskPlanGeneration = {
  generationId: string;
  featureRunId: string;
  snapshot: TaskPlanGenerationSnapshot;
};

/**
 * Establishes the durable feature run and head ownership before an SSE producer
 * can be started. Provider execution is intentionally deferred to resume.
 */
export async function startTaskPlanGenerationDurably(input: {
  taskId: string;
  workBlockId?: string | null;
  idempotencyKey: string;
  userInstruction?: string | null;
  selectedNodeId?: string | null;
  workContext?: SchedulerWorkContext;
}): Promise<StartedTaskPlanGeneration> {
  const priorRun = await db.aiFeatureRun.findFirst({
    where: {
      featureId: "task.plan.generate",
      featureVersion: 1,
      subjectType: "task",
      subjectId: input.taskId,
      operationKind: "generate",
      operationId: input.idempotencyKey,
    },
    select: { id: true, input: true, workspaceId: true },
  });
  if (priorRun) {
    const frozen = taskPlanGenerateInputSchema.safeParse(priorRun.input);
    if (!frozen.success) {
      throw new AiFeatureRuntimeError({ code: "internal_error", message: "Persisted task plan generation input is invalid." });
    }
    const userInstruction = input.userInstruction?.trim() || null;
    const selectedNodeId = input.selectedNodeId?.trim() || null;
    if (
      frozen.data.task.workBlockId !== (input.workBlockId ?? null)
      || frozen.data.userInstruction !== userInstruction
      || frozen.data.selectedNodeId !== selectedNodeId
    ) {
      throw new AiFeatureRuntimeError({ code: "idempotency_conflict", message: "Task plan generation idempotency key was reused with different input." });
    }
    return {
      generationId: input.idempotencyKey,
      featureRunId: priorRun.id,
      snapshot: {
        task: { ...frozen.data.task, workspaceId: priorRun.workspaceId },
        head: frozen.data.currentHead,
        workBlockId: frozen.data.task.workBlockId,
      },
    };
  }
  const snapshot = await captureTaskPlanGenerationSnapshot({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });
  if (!snapshot) throw new Error("Task not found");
  const generationId = input.idempotencyKey;
  const userInstruction = input.userInstruction?.trim() || null;
  const selectedNodeId = input.selectedNodeId?.trim() || null;
  const started = await withSchedulerWorkOwnership(input.workContext, async (tx) => startTaskPlanGenerateFeature({
    generationId,
    snapshot,
    userInstruction,
    selectedNodeId,
  }, tx));

  try {
    await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      const existing = await tx.taskPlanGenerationHead.findUnique({
        where: { taskId_workBlockScopeKey: { taskId: input.taskId, workBlockScopeKey: scopeKey(snapshot.workBlockId) } },
      });
      if (!existing) {
        await tx.taskPlanGenerationHead.create({
          data: {
            workspaceId: snapshot.task.workspaceId,
            taskId: input.taskId,
            workBlockScopeKey: scopeKey(snapshot.workBlockId),
            stateVersion: snapshot.head.stateVersion,
            status: TaskPlanGenerationHeadStatus.Generating,
            currentAiFeatureRunId: started.runId,
          },
        });
        return;
      }
      if (existing.currentAiFeatureRunId === started.runId) return;
      if (existing.stateVersion !== snapshot.head.stateVersion) throw new TaskPlanHeadConflictError();
      if (existing.currentAiFeatureRunId) {
        const pointedRun = await tx.aiFeatureRun.findUnique({
          where: { id: existing.currentAiFeatureRunId },
          select: { status: true },
        });
        const terminal = pointedRun?.status === AiFeatureRunStatus.Completed
          || pointedRun?.status === AiFeatureRunStatus.NeedsInput
          || pointedRun?.status === AiFeatureRunStatus.CannotComplete
          || pointedRun?.status === AiFeatureRunStatus.Failed
          || pointedRun?.status === AiFeatureRunStatus.Cancelled;
        if (!terminal) throw new TaskPlanHeadConflictError("A task plan generation is already active for this scope.");
      }
      const claimed = await tx.taskPlanGenerationHead.updateMany({
        where: {
          id: existing.id,
          stateVersion: existing.stateVersion,
          currentAiFeatureRunId: existing.currentAiFeatureRunId,
        },
        data: {
          status: TaskPlanGenerationHeadStatus.Generating,
          currentAiFeatureRunId: started.runId,
          stateVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new TaskPlanHeadConflictError();
    });
  } catch (cause) {
    await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      await tx.aiFeatureRun.updateMany({
        where: { id: started.runId, stateVersion: 0, status: AiFeatureRunStatus.Queued },
        data: {
          status: AiFeatureRunStatus.Cancelled,
          stateVersion: { increment: 1 },
          errorCode: "idempotency_conflict",
          errorMessage: "Task plan generation head changed before this run could be linked.",
          finishedAt: new Date(),
        },
      });
    });
    throw cause;
  }

  return { generationId, featureRunId: started.runId, snapshot };
}
