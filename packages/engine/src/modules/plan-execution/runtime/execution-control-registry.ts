import type { PlanExecutionControl } from "../types";

type ExecutionControlEntry = {
  controller: AbortController;
  pauseRequested: boolean;
};

const controls = new Map<string, ExecutionControlEntry>();

export function createTaskExecutionControl(taskId: string): PlanExecutionControl {
  const controller = new AbortController();
  controls.set(taskId, { controller, pauseRequested: false });

  return {
    signal: controller.signal,
    shouldPause: () => controls.get(taskId)?.pauseRequested === true,
  };
}

export function clearTaskExecutionControl(taskId: string) {
  controls.delete(taskId);
}

export function requestTaskExecutionPause(taskId: string) {
  const entry = controls.get(taskId);
  if (!entry) return false;
  entry.pauseRequested = true;
  return true;
}

export function abortTaskExecution(input: { taskId: string; reason?: string }) {
  const entry = controls.get(input.taskId);
  if (!entry) return false;
  if (!entry.controller.signal.aborted) {
    entry.controller.abort(new Error(input.reason ?? "Execution stopped by user request."));
  }
  controls.delete(input.taskId);
  return true;
}
