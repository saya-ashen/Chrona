import { applyPlanPatchCommand } from "../modules/plans/apply-plan-patch-command";
import { generateTaskPlanManualStream } from "../modules/plans/generate-task-plan-manual-stream";
import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts";
import {
  getTaskPlanGenerationSession,
  getTaskPlanGenerationSessionById,
  startTaskPlanGeneration,
  subscribeTaskPlanGeneration,
  subscribeTaskPlanGenerationById,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "../modules/plans/task-plan-generation-registry";
import {
  getLatestCompiledPlan,
  saveCompiledPlan,
} from "../modules/plan-execution/compiled-plan-store";
import { ensurePlanInWorkspace } from "../modules/plans/plan-in-workspace";
import { ensureTaskInWorkspace } from "../modules/tasks/task-by-id";
import { getLatestTaskPlanReadModel } from "../modules/plans/task-plan-read-model";
import {
  ENGINE_ERROR_CODES,
  EngineError,
  engineErrorFromUnknown,
} from "../errors";

export type TaskPlanService = {
  getState(input: { taskId: string }): Promise<{
    taskId: string;
    aiPlanGenerationStatus:
      | "accepted"
      | "generating"
      | "idle"
      | "waiting_acceptance";
    savedPlan: TaskPlanReadModel | null;
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }>;
  getActiveGeneration(input: { taskId: string }): {
    generationSession: TaskPlanGenerationSessionReadModel | null;
  };
  getGenerationSession(input: { generationId: string }): {
    generationSession: TaskPlanGenerationSessionReadModel | null;
  };
  subscribeToActiveGeneration(input: {
    taskId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }): ReturnType<typeof subscribeTaskPlanGeneration>;
  subscribeToGeneration(input: {
    generationId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }): ReturnType<typeof subscribeTaskPlanGenerationById>;
  accept(input: {
    taskId: string;
    planId: string;
    workspaceId?: string;
  }): Promise<{ savedPlan: TaskPlanReadModel | null }>;
  generate(input: { taskId: string; forceRefresh?: boolean }): {
    generationId: string;
    events: AsyncGenerator<GeneratePlanSSEEvent>;
    emit: (event: GeneratePlanSSEEvent) => void;
    finish: () => void;
  };
  stopGeneration(input: { taskId: string }): {
    taskId: string;
    stopped: boolean;
  };
  patch(
    input: Parameters<typeof applyPlanPatchCommand>[0],
  ): ReturnType<typeof applyPlanPatchCommand>;
};

export function createTaskPlanService(): TaskPlanService {
  return {
    async getState(input: { taskId: string }) {
      try {
        const savedPlan = await getLatestTaskPlanReadModel(input.taskId);
        const generationSession = getTaskPlanGenerationSession(input.taskId);
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
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.TASK_NOT_FOUND,
          "Failed to get task plan state",
        );
      }
    },
    getActiveGeneration(input: { taskId: string }) {
      return { generationSession: getTaskPlanGenerationSession(input.taskId) };
    },
    getGenerationSession(input: { generationId: string }) {
      return {
        generationSession: getTaskPlanGenerationSessionById(input.generationId),
      };
    },
    subscribeToActiveGeneration(input: {
      taskId: string;
      onEvent: (event: GeneratePlanSSEEvent) => void;
    }) {
      return subscribeTaskPlanGeneration(input.taskId, input.onEvent);
    },
    subscribeToGeneration(input: {
      generationId: string;
      onEvent: (event: GeneratePlanSSEEvent) => void;
    }) {
      return subscribeTaskPlanGenerationById(input.generationId, input.onEvent);
    },
    async accept(input: {
      taskId: string;
      planId: string;
      workspaceId?: string;
    }) {
      try {
        if (input.workspaceId) {
          await ensureTaskInWorkspace(input.taskId, input.workspaceId);
          await ensurePlanInWorkspace(
            input.planId,
            input.taskId,
            input.workspaceId,
          );
        }

        const latest = await getLatestCompiledPlan(input.taskId);
        if (!latest || latest.compiledPlan.editablePlanId !== input.planId) {
          throw new EngineError(
            ENGINE_ERROR_CODES.PLAN_NOT_FOUND,
            "Plan not found",
          );
        }

        await saveCompiledPlan({
          workspaceId: latest.workspaceId,
          taskId: input.taskId,
          compiledPlan: latest.compiledPlan,
          editablePlan: latest.editablePlan,
          status: "accepted",
          prompt: latest.prompt,
          summary: latest.summary,
          generatedBy: latest.generatedBy,
        });

        return { savedPlan: await getLatestTaskPlanReadModel(input.taskId) };
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.PLAN_NOT_FOUND,
          "Failed to accept task AI plan",
        );
      }
    },
    generate(input: { taskId: string; forceRefresh?: boolean }) {
      try {
        const streamLock = startTaskPlanGeneration(input.taskId);
        const events = generateTaskPlanManualStream({
          ...input,
          signal: streamLock.signal,
        });
        return {
          generationId: streamLock.generationId,
          events,
          emit: streamLock.emit,
          finish: streamLock.finish,
        };
      } catch (cause) {
        if (cause instanceof TaskPlanGenerationInFlightError) {
          throw new EngineError(
            ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT,
            cause.message,
            { cause },
          );
        }
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.VALIDATION_FAILED,
          "Failed to generate task plan",
        );
      }
    },
    stopGeneration(input: { taskId: string }) {
      return {
        taskId: input.taskId,
        stopped: stopTaskPlanGeneration(input.taskId),
      };
    },
    async patch(input: Parameters<typeof applyPlanPatchCommand>[0]) {
      try {
        return await applyPlanPatchCommand(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.VALIDATION_FAILED,
          "Failed to apply plan patch",
        );
      }
    },
  };
}
