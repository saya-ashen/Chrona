import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { resolveProviderApproval } from "../modules/plan-execution/use-cases/resolve-provider-approval";
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

    async submitCheckpointAction(input: Parameters<typeof taskPlanExecution.submitCheckpointAction>[0]) {
      try {
        return await taskPlanExecution.submitCheckpointAction(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to submit checkpoint action");
      }
    },

    async current(input: Parameters<typeof taskPlanExecution.current>[0]) {
      try {
        return await taskPlanExecution.current(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to load current execution state");
      }
    },

    async syncRuntimeResult(input: Parameters<typeof taskPlanExecution.syncRuntimeResult>[0]) {
      try {
        return await taskPlanExecution.syncRuntimeResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to sync execution runtime result");
      }
    },

    resolveProviderApproval,
  };
}
