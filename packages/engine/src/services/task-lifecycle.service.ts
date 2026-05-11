import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { tasks } from "../modules/tasks";

export function createTaskLifecycleService() {
  return {
    async complete(input: Parameters<typeof tasks.complete>[0]) {
      try {
        return await tasks.complete(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to mark task done");
      }
    },
    async reopen(input: Parameters<typeof tasks.reopen>[0]) {
      try {
        return await tasks.reopen(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to reopen task");
      }
    },
  };
}
