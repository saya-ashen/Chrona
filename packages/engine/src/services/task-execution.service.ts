import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { taskPlanExecution } from "../modules/plan-execution";

export function createTaskExecutionService() {
  return {
    async dispatch(input: Parameters<typeof taskPlanExecution.dispatch>[0]) {
      try {
        return await taskPlanExecution.dispatch(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to dispatch execution action");
      }
    },

    async submitNodeResult(input: Parameters<typeof taskPlanExecution.submitNodeResult>[0]) {
      try {
        return await taskPlanExecution.submitNodeResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to submit execution node result");
      }
    },

    async syncRuntimeResult(input: Parameters<typeof taskPlanExecution.syncRuntimeResult>[0]) {
      try {
        return await taskPlanExecution.syncRuntimeResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to sync execution runtime result");
      }
    },
  };
}
