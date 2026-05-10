import { acceptTaskResult } from "../modules/tasks/accept-task-result";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createTaskResultService() {
  return {
    async accept(input: Parameters<typeof acceptTaskResult>[0]) {
      try {
        return await acceptTaskResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to accept task result");
      }
    },
  };
}
