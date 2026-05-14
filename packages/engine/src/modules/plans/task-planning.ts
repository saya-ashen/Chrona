import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getLatestCompiledPlan, saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { ensureTaskInWorkspace } from "@/modules/tasks/task-by-id";
import { applyPlanMutationCommand, applyPlanPatchCommand } from "./apply-plan-patch-command";
import { generateTaskPlanManualStream } from "./generate-task-plan-manual-stream";
import { ensurePlanInWorkspace } from "./plan-in-workspace";
import {
  getTaskPlanGenerationSession,
  getTaskPlanGenerationSessionById,
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  subscribeTaskPlanGeneration,
  subscribeTaskPlanGenerationById,
} from "./task-plan-generation-registry";
import { getLatestTaskPlanReadModel } from "./task-plan-read-model";

export class TaskPlanning {
  async getState(input: { taskId: string }): Promise<{
    taskId: string;
    aiPlanGenerationStatus:
      | "accepted"
      | "generating"
      | "idle"
      | "waiting_acceptance";
    savedPlan: TaskPlanReadModel | null;
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }> {
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
  }

  getActiveGeneration(input: { taskId: string }) {
    return { generationSession: getTaskPlanGenerationSession(input.taskId) };
  }

  getGenerationSession(input: { generationId: string }) {
    return {
      generationSession: getTaskPlanGenerationSessionById(input.generationId),
    };
  }

  subscribeToActiveGeneration(input: {
    taskId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }) {
    return subscribeTaskPlanGeneration(input.taskId, input.onEvent);
  }

  subscribeToGeneration(input: {
    generationId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }) {
    return subscribeTaskPlanGenerationById(input.generationId, input.onEvent);
  }

  async accept(input: { taskId: string; planId: string; workspaceId?: string }) {
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
  }

  generate(input: { taskId: string; forceRefresh?: boolean }) {
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
  }

  stopGeneration(input: { taskId: string }) {
    return {
      taskId: input.taskId,
      stopped: stopTaskPlanGeneration(input.taskId),
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
