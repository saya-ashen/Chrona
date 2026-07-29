import { createTask } from "./create-task";
import { deleteTask } from "./delete-task";
import { rebuildTaskWithLatestGoalAssets } from "./rebuild-task-with-latest-goal-assets";
import { getTaskPage } from "./get-task-page";
import { getTaskBootstrap } from "./get-task-bootstrap";
import { getTaskCommandCenter } from "./get-task-command-center";
import { getTaskReviewContext } from "./get-task-review-context";
import { getTaskHeaderSpec } from "./get-task-header";
import { getTaskActivityPage } from "./task-activity";
import { getTaskRuntimeContext } from "./get-task-runtime-context";
import { listTasksByWorkspace } from "./list-tasks";
import { acceptTaskResult } from "./accept-task-result";
import { continueFromTaskResult, getTaskResultFollowUpState } from "./continue-from-task-result";
import {
  approveResultFileAccess,
  requestResultFileAccess,
} from "./result-file-access";
import { resolveFilePreview } from "./file-preview";
import { openTaskResultFile } from "./open-task-result-file";
import { markTaskDone } from "./mark-task-done";
import { reopenTask } from "./reopen-task";
import { ensureTaskInWorkspace } from "./task-by-id";
import { updateTask } from "./update-task";
export class Tasks {
  create(input: Parameters<typeof createTask>[0]) {
    return createTask(input);
  }

  async update(
    input: Parameters<typeof updateTask>[0] & { workspaceId?: string },
  ) {
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
  async rebuildWithLatestGoalAssets(input: { taskId: string; workspaceId?: string }) {
    if (input.workspaceId) {
      await ensureTaskInWorkspace(input.taskId, input.workspaceId);
    }
    return rebuildTaskWithLatestGoalAssets(input);
  }

  getPage(input: { taskId: string; workBlockId?: string | null }) {
    return getTaskPage(input);
  }

  getBootstrap(input: Parameters<typeof getTaskBootstrap>[0]) {
    return getTaskBootstrap(input);
  }

  getRuntimeContext(input: Parameters<typeof getTaskRuntimeContext>[0]) {
    return getTaskRuntimeContext(input);
  }

  getReviewContext(input: Parameters<typeof getTaskReviewContext>[0]) {
    return getTaskReviewContext(input);
  }

  getCommandCenter(input: Parameters<typeof getTaskCommandCenter>[0]) {
    return getTaskCommandCenter(input);
  }

  getHeaderSpec(input: Parameters<typeof getTaskHeaderSpec>[0]) {
    return getTaskHeaderSpec(input);
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

  continueFromResult(input: Parameters<typeof continueFromTaskResult>[0]) {
    return continueFromTaskResult(input);
  }

  getResultFollowUpState(input: { taskId: string }) {
    return getTaskResultFollowUpState(input.taskId);
  }

  requestResultFileAccess(
    input: Parameters<typeof requestResultFileAccess>[0],
  ) {
    return requestResultFileAccess(input);
  }

  approveResultFileAccess(
    input: Parameters<typeof approveResultFileAccess>[0],
  ) {
    return approveResultFileAccess(input);
  }

  openResultFile(input: Parameters<typeof openTaskResultFile>[0]) {
    return openTaskResultFile(input);
  }

  previewResultFile(input: { path: string; canonicalPath: string }) {
    return resolveFilePreview(input.path, {
      allowedAbsolutePath: input.canonicalPath,
    });
  }
}

export const tasks = new Tasks();
