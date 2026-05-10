import { getInbox } from "../modules/queries/get-inbox";
import { getMemoryConsole } from "../modules/queries/get-memory-console";
import { getSchedulePage } from "../modules/queries/get-schedule-page";
import { getWorkPage, WorkPageTaskNotFoundError } from "../modules/queries/work-page";
import { ENGINE_ERROR_CODES, EngineError, engineErrorFromUnknown } from "../errors";

export function createPagesService() {
  return {
    async getSchedule(input: { workspaceId: string }) {
      try {
        return await getSchedulePage(input.workspaceId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get schedule page");
      }
    },
    async getInbox(input: { workspaceId: string }) {
      try {
        return await getInbox(input.workspaceId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get inbox");
      }
    },
    async getMemory(input: { workspaceId: string }) {
      try {
        return await getMemoryConsole(input.workspaceId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get memory console");
      }
    },
    async getWork(input: { taskId: string }) {
      try {
        return await getWorkPage(input.taskId);
      } catch (cause) {
        if (cause instanceof WorkPageTaskNotFoundError) {
          throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found", { cause });
        }
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get work page");
      }
    },
  };
}
