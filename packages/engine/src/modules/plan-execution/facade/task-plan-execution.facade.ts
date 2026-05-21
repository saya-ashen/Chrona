import type { startPlanExecution } from "../task-plan-execution";
import type { dispatchExecutionAction } from "../task-plan-execution";
import type { submitCheckpointAction } from "../task-plan-execution";
import type { getCurrentExecution } from "../task-plan-execution";
import type { submitTerminalNodeResult } from "../task-plan-execution";
import type { syncPlanRunRuntimeResult } from "../task-plan-execution";
import {
  startPlanExecution as startExecution,
  dispatchExecutionAction as dispatchExecution,
  submitCheckpointAction as submitCheckpoint,
  getCurrentExecution as currentExecution,
  submitTerminalNodeResult as submitNodeResult,
  syncPlanRunRuntimeResult as syncRuntimeResult,
} from "../task-plan-execution";

export class TaskPlanExecution {
  async start(input: Parameters<typeof startPlanExecution>[0]) {
    return startExecution(input);
  }

  async dispatch(input: Parameters<typeof dispatchExecutionAction>[0]) {
    return dispatchExecution(input);
  }

  async submitCheckpointAction(input: Parameters<typeof submitCheckpointAction>[0]) {
    return submitCheckpoint(input);
  }

  async current(input: Parameters<typeof getCurrentExecution>[0]) {
    return currentExecution(input);
  }

  async submitNodeResult(input: Parameters<typeof submitTerminalNodeResult>[0]) {
    return submitNodeResult(input);
  }

  async syncRuntimeResult(input: Parameters<typeof syncPlanRunRuntimeResult>[0]) {
    return syncRuntimeResult(input);
  }
}

export const taskPlanExecution = new TaskPlanExecution();
