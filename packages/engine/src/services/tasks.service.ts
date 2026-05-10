import { createTask } from "../modules/tasks/create-task";
import { deleteTask } from "../modules/tasks/delete-task";
import { updateTask } from "../modules/tasks/update-task";
import { getTaskPage } from "../modules/tasks/get-task-page";
import { ensureTaskInWorkspace } from "../modules/tasks/task-by-id";
import { listTasksByWorkspace } from "../modules/tasks/list-tasks";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createTasksService() {
  return {
    async create(input: Parameters<typeof createTask>[0]) {
      try {
        return await createTask(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create task");
      }
    },
    async update(input: Parameters<typeof updateTask>[0] & { workspaceId?: string }) {
      try {
        if (input.workspaceId) {
          await ensureTaskInWorkspace(input.taskId, input.workspaceId);
        }

        const { workspaceId: _workspaceId, ...taskInput } = input;
        return await updateTask(taskInput);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to update task");
      }
    },
    async delete(input: { taskId: string; workspaceId?: string }) {
      try {
        if (input.workspaceId) {
          await ensureTaskInWorkspace(input.taskId, input.workspaceId);
        }
        return await deleteTask(input.taskId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to delete task");
      }
    },
    async getPage(input: { taskId: string }) {
      try {
        return await getTaskPage(input.taskId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get task");
      }
    },
    async list(input: Parameters<typeof listTasksByWorkspace>[0]) {
      try {
        return await listTasksByWorkspace(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to list tasks");
      }
    },
  };
}
