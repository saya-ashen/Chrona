import type { PlanExecutionObserver } from "../../types";

export function observerCallbacks(input: PlanExecutionObserver): PlanExecutionObserver {
  return {
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  };
}
