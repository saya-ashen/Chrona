import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { tasks } from "../modules/tasks";

export function createTasksService() {
  return {
    async create(input: Parameters<typeof tasks.create>[0]) {
      try {
        return await tasks.create(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create task");
      }
    },
    async update(input: Parameters<typeof tasks.update>[0]) {
      try {
        return await tasks.update(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to update task");
      }
    },
    async delete(input: { taskId: string; workspaceId?: string }) {
      try {
        return await tasks.delete(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to delete task");
      }
    },
    async getPage(input: { taskId: string }) {
      try {
        return await tasks.getPage(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task");
      }
    },
    async list(input: Parameters<typeof tasks.list>[0]) {
      try {
        return await tasks.list(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to list tasks");
      }
    },
  };
}
