// Thin re-export of the 7 task-plan-execution entry points as a callable
// singleton. Previously this file wrapped the entry points in a class
// with `Parameters<typeof fn>[0]`-shaped passthroughs and exported a
// single instance. The class added no behavior, only a layer of
// indirection that forced tests to mock the facade instead of the
// underlying functions. The singleton object below preserves the
// `taskPlanExecution.<m>(...)` call shape used by ~20 call sites and
// the existing test files, while letting new code import the
// functions directly from `../task-plan-execution`.
//
// The `TaskPlanExecution` class is also still exported (as a type and
// as a value) for any external consumer that referenced it. New code
// should not use it.

import {
  startPlanExecution,
  dispatchExecutionAction,
  submitCheckpointAction,
  getCurrentExecution,
  submitTerminalNodeResult,
  syncPlanRunRuntimeResult,
  reconcileStaleRuntimeRuns,
} from "../task-plan-execution";

export const taskPlanExecution = {
  start: startPlanExecution,
  dispatch: dispatchExecutionAction,
  submitCheckpointAction,
  current: getCurrentExecution,
  submitNodeResult: submitTerminalNodeResult,
  syncRuntimeResult: syncPlanRunRuntimeResult,
  reconcileStaleRuntimeRuns,
};

export type TaskPlanExecutionFacade = typeof taskPlanExecution;

// Back-compat: preserve the class symbol that previous versions of
// this file exported. It is a no-op marker class; instances have no
// behavior beyond the singleton object above. New code should
// consume `taskPlanExecution` directly.
export class TaskPlanExecution {
  start = startPlanExecution;
  dispatch = dispatchExecutionAction;
  submitCheckpointAction = submitCheckpointAction;
  current = getCurrentExecution;
  submitNodeResult = submitTerminalNodeResult;
  syncRuntimeResult = syncPlanRunRuntimeResult;
  reconcileStaleRuntimeRuns = reconcileStaleRuntimeRuns;
}
