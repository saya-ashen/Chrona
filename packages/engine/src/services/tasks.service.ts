import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { tasks } from "../modules/tasks";

// The service exposes the complete task facade while normalizing every module error consistently.
// eslint-disable-next-line max-lines-per-function
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
    async getDeleteImpact(input: Parameters<typeof tasks.getDeleteImpact>[0]) {
      try {
        return await tasks.getDeleteImpact(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to inspect task deletion");
      }
    },
    async delete(input: Parameters<typeof tasks.delete>[0]) {
      try {
        return await tasks.delete(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to delete task");
      }
    },
    async rebuildWithLatestGoalAssets(
      input: Parameters<typeof tasks.rebuildWithLatestGoalAssets>[0],
    ) {
      try {
        return await tasks.rebuildWithLatestGoalAssets(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to rebuild task with latest Goal assets");
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
    async requestResultFileAccess(
      input: Parameters<typeof tasks.requestResultFileAccess>[0],
    ) {
      return tasks.requestResultFileAccess(input);
    },
    async approveResultFileAccess(
      input: Parameters<typeof tasks.approveResultFileAccess>[0],
    ) {
      return tasks.approveResultFileAccess(input);
    },
    async openResultFile(input: Parameters<typeof tasks.openResultFile>[0]) {
      return tasks.openResultFile(input);
    },
    async previewResultFile(
      input: Parameters<typeof tasks.previewResultFile>[0],
    ) {
      return tasks.previewResultFile(input);
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
