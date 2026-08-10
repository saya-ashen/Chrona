import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts";
import { TaskPlanGenerationHeadStatus, TaskPlanStatus } from "@/generated/prisma/client";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { ensureTaskInWorkspace } from "@/modules/tasks/task-by-id";
import { applyPlanMutationCommand, applyPlanPatchCommand } from "./apply-plan-patch-command";
import { generateTaskPlanManualStream } from "./generate-task-plan-manual-stream";
import { startTaskPlanGenerationDurably } from "./start-task-plan-generation";
import { ensurePlanInWorkspace } from "./plan-in-workspace";
import {
  getTaskPlanGenerationSession,
  stopTaskPlanGeneration,
  subscribeTaskPlanGeneration,
} from "./task-plan-generation-registry";
import { getLatestTaskPlanReadModel } from "./task-plan-read-model";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { TaskPlanHeadConflictError } from "./task-plan-generation-persistence";
import { withSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";

type PlanAcceptanceReceipt = {
  task_id: string;
  work_block_id: string | null;
  plan_id: string;
  idempotency_key: string;
};

function isPlanAcceptanceReceipt(value: unknown, input: { taskId: string; planId: string; workBlockId?: string | null; idempotencyKey: string }): value is PlanAcceptanceReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<PlanAcceptanceReceipt>;
  return receipt.task_id === input.taskId
    && receipt.plan_id === input.planId
    && receipt.idempotency_key === input.idempotencyKey
    && (input.workBlockId === undefined || receipt.work_block_id === input.workBlockId);
}

export class TaskPlanning {
  async getState(input: { taskId: string; workBlockId?: string | null }): Promise<{
    taskId: string;
    aiPlanGenerationStatus:
      | "accepted"
      | "generating"
      | "idle"
      | "waiting_acceptance";
    savedPlan: TaskPlanReadModel | null;
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }> {
    const savedPlan = await getLatestTaskPlanReadModel(input.taskId, input.workBlockId ?? null);
    const generationSession = await getTaskPlanGenerationSession({ taskId: input.taskId, workBlockId: input.workBlockId ?? null });
    const planStatus =
      savedPlan?.status === "accepted"
        ? "accepted"
        : savedPlan
          ? "waiting_acceptance"
          : "no_plan";
    const aiPlanGenerationStatus =
      generationSession?.status === "running"
        ? "generating"
        : planStatus === "accepted"
          ? "accepted"
          : planStatus === "waiting_acceptance"
            ? "waiting_acceptance"
            : "idle";

    return {
      taskId: input.taskId,
      aiPlanGenerationStatus,
      savedPlan,
      generationSession,
    };
  }

  async getActiveGeneration(input: { taskId: string; workBlockId?: string | null }) {
    return { generationSession: await getTaskPlanGenerationSession({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }) };
  }


  subscribeToActiveGeneration(input: {
    taskId: string;
    workBlockId?: string | null;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }) {
    return subscribeTaskPlanGeneration({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }, input.onEvent);
  }


  async accept(input: { taskId: string; planId: string; workspaceId?: string; workBlockId?: string | null; expectedHeadStateVersion: number; idempotencyKey: string; workContext?: SchedulerWorkContext }) {
    if (input.workspaceId) {
      await ensureTaskInWorkspace(input.taskId, input.workspaceId);
      await ensurePlanInWorkspace(input.planId, input.taskId, input.workspaceId);
    }
    const dedupeKey = `task_plan.accept:${input.idempotencyKey}`;
    const accepted = await withSchedulerWorkOwnership(input.workContext, async (tx) => {
      const existingReceipt = await tx.event.findUnique({ where: { dedupeKey }, select: { payload: true } });
      if (existingReceipt) {
        const receipt = existingReceipt.payload as unknown as PlanAcceptanceReceipt;
        if (!isPlanAcceptanceReceipt(receipt, {
          taskId: input.taskId,
          planId: input.planId,
          workBlockId: input.workBlockId,
          idempotencyKey: input.idempotencyKey,
        })) {
          throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Idempotency key was already used for a different plan acceptance.");
        }
        return { scope: receipt.work_block_id, duplicate: true };
      }

      const plan = await tx.taskPlan.findFirst({ where: { taskId: input.taskId, planId: input.planId } });
      if (!plan) throw new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Plan not found");
      const scope = input.workBlockId ?? plan.workBlockId;
      const headUpdate = await tx.taskPlanGenerationHead.updateMany({
        where: {
          taskId: input.taskId,
          workBlockScopeKey: scope ?? "",
          currentPlanId: input.planId,
          stateVersion: input.expectedHeadStateVersion,
        },
        data: {
          currentPlanStatus: TaskPlanStatus.Accepted,
          stateVersion: { increment: 1 },
          status: TaskPlanGenerationHeadStatus.Current,
        },
      });
      if (headUpdate.count !== 1) throw new TaskPlanHeadConflictError();
      await tx.taskPlan.update({ where: { planId: input.planId }, data: { status: TaskPlanStatus.Accepted } });
      await tx.taskPlan.updateMany({
        where: {
          taskId: input.taskId,
          workBlockId: scope,
          planId: { not: input.planId },
          status: { in: [TaskPlanStatus.Draft, TaskPlanStatus.Accepted] },
        },
        data: { status: TaskPlanStatus.Superseded },
      });
      await tx.event.create({
        data: {
          eventType: "task_plan.accepted",
          workspaceId: plan.workspaceId,
          taskId: input.taskId,
          workBlockId: scope,
          planId: input.planId,
          actorType: "user",
          actorId: null,
          source: "task_plan",
          payload: {
            task_id: input.taskId,
            work_block_id: scope,
            plan_id: input.planId,
            idempotency_key: input.idempotencyKey,
          },
          summary: "Accepted task plan",
          dedupeKey,
          ingestSequence: 0,
        },
      });
      return { scope, duplicate: false };
    });
    await rebuildTaskProjection(input.taskId);
    return { savedPlan: await getLatestTaskPlanReadModel(input.taskId, accepted.scope) };
  }

  async generate(input: { taskId: string; workBlockId?: string | null; forceRefresh?: boolean; userInstruction?: string | null; selectedNodeId?: string | null; idempotencyKey: string; workContext?: SchedulerWorkContext }) {
    const started = await startTaskPlanGenerationDurably(input);
    const events = generateTaskPlanManualStream({
      ...input,
      workBlockId: started.snapshot.workBlockId,
      generationId: started.generationId,
      featureRunId: started.featureRunId,
      snapshot: started.snapshot,
    });
    return {
      generationId: started.generationId,
      events,
      emit: () => {},
      finish: () => {},
    };
  }

  async stopGeneration(input: { taskId: string; workBlockId?: string | null }) {
    return {
      taskId: input.taskId,
      stopped: await stopTaskPlanGeneration({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }),
    };
  }

  patch(input: Parameters<typeof applyPlanPatchCommand>[0]) {
    return applyPlanPatchCommand(input);
  }

  mutate(input: Parameters<typeof applyPlanMutationCommand>[0]) {
    return applyPlanMutationCommand(input);
  }
}

export const taskPlanning = new TaskPlanning();
