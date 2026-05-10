import { applyPlanPatchCommand } from "../modules/plans/apply-plan-patch-command";
import { generateTaskPlanManualStream } from "../modules/plans/generate-task-plan-manual-stream";
import { materializeTaskPlan } from "../modules/plans/materialize-task-plan";
import {
  isTaskPlanGenerationRunning,
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "../modules/plans/task-plan-generation-registry";
import { getLatestCompiledPlan, saveCompiledPlan } from "../modules/plan-execution/compiled-plan-store";
import { ensurePlanInWorkspace } from "../modules/plans/plan-in-workspace";
import { ensureTaskInWorkspace } from "../modules/tasks/task-by-id";
import { getLatestTaskPlanReadModel } from "../modules/plans/task-plan-read-model";
import { ENGINE_ERROR_CODES, EngineError, engineErrorFromUnknown } from "../errors";

export function createTaskPlanService() {
  return {
    async getState(input: { taskId: string }) {
      try {
        const savedPlan = await getLatestTaskPlanReadModel(input.taskId);
        const planStatus = savedPlan?.status === "accepted"
          ? "accepted"
          : savedPlan
            ? "waiting_acceptance"
            : "no_plan";
        const aiPlanGenerationStatus = isTaskPlanGenerationRunning(input.taskId)
          ? "generating"
          : planStatus === "accepted"
            ? "accepted"
            : planStatus === "waiting_acceptance"
              ? "waiting_acceptance"
              : "idle";

        return { taskId: input.taskId, aiPlanGenerationStatus, savedPlan };
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task plan state");
      }
    },
    async accept(input: { taskId: string; planId: string; workspaceId?: string }) {
      try {
        if (input.workspaceId) {
          await ensureTaskInWorkspace(input.taskId, input.workspaceId);
          await ensurePlanInWorkspace(input.planId, input.taskId, input.workspaceId);
        }

        const latest = await getLatestCompiledPlan(input.taskId);
        if (!latest || latest.compiledPlan.editablePlanId !== input.planId) {
          throw new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Plan not found");
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
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Failed to accept task AI plan");
      }
    },
    generate(input: { taskId: string; forceRefresh?: boolean }) {
      try {
        const streamLock = startTaskPlanGeneration(input.taskId);
        return {
          events: generateTaskPlanManualStream(input),
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
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to generate task plan");
      }
    },
    stopGeneration(input: { taskId: string }) {
      return { taskId: input.taskId, stopped: stopTaskPlanGeneration(input.taskId) };
    },
    async patch(input: Parameters<typeof applyPlanPatchCommand>[0]) {
      try {
        return await applyPlanPatchCommand(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to apply plan patch");
      }
    },
    async materialize(input: { taskId: string; workspaceId?: string }) {
      try {
        if (input.workspaceId) {
          await ensureTaskInWorkspace(input.taskId, input.workspaceId);
        }

        return await materializeTaskPlan({ taskId: input.taskId });
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Failed to materialize task plan");
      }
    },
  };
}
