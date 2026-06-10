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
    async getPage(input: Parameters<typeof tasks.getPage>[0]) {
      try {
        return await tasks.getPage(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task");
      }
    },
    async getBootstrap(input: Parameters<typeof tasks.getBootstrap>[0]) {
      try {
        return await tasks.getBootstrap(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task bootstrap");
      }
    },
    async getRuntimeContext(input: Parameters<typeof tasks.getRuntimeContext>[0]) {
      try {
        return await tasks.getRuntimeContext(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task runtime context");
      }
    },
    async getReviewContext(input: Parameters<typeof tasks.getReviewContext>[0]) {
      try {
        return await tasks.getReviewContext(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task review context");
      }
    },
    async getCommandCenter(input: Parameters<typeof tasks.getCommandCenter>[0]) {
      try {
        return await tasks.getCommandCenter(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task command center");
      }
    },
    async getHeaderSpec(input: Parameters<typeof tasks.getHeaderSpec>[0]) {
      try {
        return await tasks.getHeaderSpec(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task header spec");
      }
    },
    async getActivityPage(input: Parameters<typeof tasks.getActivityPage>[0]) {
      try {
        return await tasks.getActivityPage(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task activity");
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
