import { markTaskDone } from "../modules/tasks/mark-task-done";
import { reopenTask } from "../modules/tasks/reopen-task";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createTaskLifecycleService() {
  return {
    async complete(input: Parameters<typeof markTaskDone>[0]) {
      try {
        return await markTaskDone(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to mark task done");
      }
    },
    async reopen(input: Parameters<typeof reopenTask>[0]) {
      try {
        return await reopenTask(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to reopen task");
      }
    },
  };
}
