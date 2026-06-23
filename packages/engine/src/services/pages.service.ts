import { ENGINE_ERROR_CODES, EngineError, engineErrorFromUnknown } from "../errors";
import { pageQuery, WorkPageTaskNotFoundError } from "../modules/pages";

export function createPagesService() {
  return {
    async getSchedule(input: { workspaceId: string }) {
      try {
        return await pageQuery.getSchedule(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get schedule page");
      }
    },
    async getInbox(input: { workspaceId: string }) {
      try {
        return await pageQuery.getInbox(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get inbox");
      }
    },
    async getDashboard(input: { workspaceId: string }) {
      try {
        return await pageQuery.getDashboard(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get dashboard");
      }
    },
    async getMemory(input: { workspaceId: string }) {
      try {
        return await pageQuery.getMemory(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get memory console");
      }
    },
    async getWork(input: { taskId: string }) {
      try {
        return await pageQuery.getWork(input);
      } catch (cause) {
        if (cause instanceof WorkPageTaskNotFoundError) {
          throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found", { cause });
        }
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get work page");
      }
    },
  };
}
