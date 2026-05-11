import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { tasks } from "../modules/tasks";

export function createTaskResultService() {
  return {
    async accept(input: Parameters<typeof tasks.acceptResult>[0]) {
      try {
        return await tasks.acceptResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to accept task result");
      }
    },
  };
}
