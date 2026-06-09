import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getCompiledPlanByPlanId, saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
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
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

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
    const generationSession = getTaskPlanGenerationSession({ taskId: input.taskId, workBlockId: input.workBlockId ?? null });
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

  getActiveGeneration(input: { taskId: string; workBlockId?: string | null }) {
    return { generationSession: getTaskPlanGenerationSession({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }) };
  }

  getGenerationSession(input: { generationId: string }) {
    return {
      generationSession: getTaskPlanGenerationSessionById(input.generationId),
    };
  }

  subscribeToActiveGeneration(input: {
    taskId: string;
    workBlockId?: string | null;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }) {
    return subscribeTaskPlanGeneration({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }, input.onEvent);
  }

  subscribeToGeneration(input: {
    generationId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }) {
    return subscribeTaskPlanGenerationById(input.generationId, input.onEvent);
  }

  async accept(input: { taskId: string; planId: string; workspaceId?: string; workBlockId?: string | null }) {
    if (input.workspaceId) {
      await ensureTaskInWorkspace(input.taskId, input.workspaceId);
      await ensurePlanInWorkspace(input.planId, input.taskId, input.workspaceId);
    }

    const latest = await getCompiledPlanByPlanId(input.taskId, input.planId);
    if (!latest) {
      throw new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Plan not found");
    }

    const effectiveWorkBlockId = latest.workBlockId ?? null;

    await saveCompiledPlan({
      workspaceId: latest.workspaceId,
      taskId: input.taskId,
      workBlockId: effectiveWorkBlockId,
      compiledPlan: latest.compiledPlan,
      editablePlan: latest.editablePlan,
      status: "accepted",
      prompt: latest.prompt,
      summary: latest.summary,
      generatedBy: latest.generatedBy,
    });

    // Acceptance flips the plan to executable; rebuild so the task's read state
    // (runnable, primary action) reflects it without a separate execution tick.
    await rebuildTaskProjection(input.taskId);

    return { savedPlan: await getLatestTaskPlanReadModel(input.taskId, effectiveWorkBlockId) };
  }

  generate(input: { taskId: string; workBlockId?: string | null; forceRefresh?: boolean; userInstruction?: string | null }) {
    const streamLock = startTaskPlanGeneration({ taskId: input.taskId, workBlockId: input.workBlockId ?? null });
    const events = generateTaskPlanManualStream({
      ...input,
      generationId: streamLock.generationId,
      signal: streamLock.signal,
    });
    return {
      generationId: streamLock.generationId,
      events,
      emit: streamLock.emit,
      finish: streamLock.finish,
    };
  }

  stopGeneration(input: { taskId: string; workBlockId?: string | null }) {
    return {
      taskId: input.taskId,
      stopped: stopTaskPlanGeneration({ taskId: input.taskId, workBlockId: input.workBlockId ?? null }),
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
