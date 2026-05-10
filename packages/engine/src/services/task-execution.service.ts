import { dispatchExecutionAction } from "../modules/plan-execution";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createTaskExecutionService() {
  return {
    async dispatch(input: Parameters<typeof dispatchExecutionAction>[0]) {
      try {
        return await dispatchExecutionAction(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to dispatch execution action");
      }
    },
  };
}
