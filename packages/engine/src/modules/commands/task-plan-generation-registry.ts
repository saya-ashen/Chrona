export class TaskPlanGenerationInFlightError extends Error {
  constructor(taskId: string) {
    super(
      `A task plan generation job is already running for task ${taskId}. Stop the current generation before starting a new one.`,
    );
    this.name = "TaskPlanGenerationInFlightError";
  }
}

export const TASK_PLAN_GENERATION_IN_FLIGHT_CODE = "TASK_PLAN_GENERATION_IN_FLIGHT";

interface InFlightGeneration {
  taskId: string;
  controller: AbortController;
  startedAt: number;
}

const inFlightGenerations = new Map<string, InFlightGeneration>();

export function startTaskPlanGeneration(taskId: string) {
  const existing = inFlightGenerations.get(taskId);
  if (existing && !existing.controller.signal.aborted) {
    throw new TaskPlanGenerationInFlightError(taskId);
  }

  const generation: InFlightGeneration = {
    taskId,
    controller: new AbortController(),
    startedAt: Date.now(),
  };
  inFlightGenerations.set(taskId, generation);

  return {
    signal: generation.controller.signal,
    finish() {
      if (inFlightGenerations.get(taskId) === generation) {
        inFlightGenerations.delete(taskId);
      }
    },
  };
}

export function stopTaskPlanGeneration(taskId: string) {
  const existing = inFlightGenerations.get(taskId);
  if (!existing) {
    return false;
  }

  existing.controller.abort();
  inFlightGenerations.delete(taskId);
  return true;
}

export function isTaskPlanGenerationRunning(taskId: string) {
  const existing = inFlightGenerations.get(taskId);
  return Boolean(existing && !existing.controller.signal.aborted);
}
