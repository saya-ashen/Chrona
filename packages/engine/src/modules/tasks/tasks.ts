import { createTask } from "./create-task";
import { deleteTask } from "./delete-task";
import { getTaskActivityPage, getTaskPage } from "./get-task-page";
import { listTasksByWorkspace } from "./list-tasks";
import { acceptTaskResult } from "./accept-task-result";
import { markTaskDone } from "./mark-task-done";
import { reopenTask } from "./reopen-task";
import { ensureTaskInWorkspace } from "./task-by-id";
import { updateTask } from "./update-task";

export class Tasks {
  create(input: Parameters<typeof createTask>[0]) {
    return createTask(input);
  }

  async update(input: Parameters<typeof updateTask>[0] & { workspaceId?: string }) {
    if (input.workspaceId) {
      await ensureTaskInWorkspace(input.taskId, input.workspaceId);
    }

    const { workspaceId: _workspaceId, ...taskInput } = input;
    return updateTask(taskInput);
  }

  async delete(input: { taskId: string; workspaceId?: string }) {
    if (input.workspaceId) {
      await ensureTaskInWorkspace(input.taskId, input.workspaceId);
    }
    return deleteTask(input.taskId);
  }

  getPage(input: { taskId: string; workBlockId?: string | null }) {
    return getTaskPage(input);
  }

  getActivityPage(input: Parameters<typeof getTaskActivityPage>[0]) {
    return getTaskActivityPage(input);
  }

  list(input: Parameters<typeof listTasksByWorkspace>[0]) {
    return listTasksByWorkspace(input);
  }

  complete(input: Parameters<typeof markTaskDone>[0]) {
    return markTaskDone(input);
  }

  reopen(input: Parameters<typeof reopenTask>[0]) {
    return reopenTask(input);
  }

  acceptResult(input: Parameters<typeof acceptTaskResult>[0]) {
    return acceptTaskResult(input);
  }
}

export const tasks = new Tasks();
