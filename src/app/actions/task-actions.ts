'use server'

import { revalidatePath } from "next/cache";
import { getPathVariants } from "@/i18n/routing";
import { applySchedule as applyScheduleCommand } from "@/modules/commands/apply-schedule";
import { acceptTaskResult as acceptTaskResultCommand } from "@/modules/commands/accept-task-result";
import { clearSchedule as clearScheduleCommand } from "@/modules/commands/clear-schedule";
import { createFollowUpTask as createFollowUpTaskCommand } from "@/modules/commands/create-follow-up-task";
import { createTask as createTaskCommand } from "@/modules/commands/create-task";
import { decideScheduleProposal as decideScheduleProposalCommand } from "@/modules/commands/decide-schedule-proposal";
import { invalidateMemory as invalidateMemoryCommand } from "@/modules/commands/invalidate-memory";
import { markTaskDone as markTaskDoneCommand } from "@/modules/commands/mark-task-done";
import { proposeSchedule as proposeScheduleCommand } from "@/modules/commands/propose-schedule";
import { provideInput as provideInputCommand } from "@/modules/commands/provide-input";
import { reopenTask as reopenTaskCommand } from "@/modules/commands/reopen-task";
import { resolveApproval as resolveApprovalCommand } from "@/modules/commands/resolve-approval";
import { resumeRun as resumeRunCommand } from "@/modules/commands/resume-run";
import { retryRun as retryRunCommand } from "@/modules/commands/retry-run";
import { startRun as startRunCommand } from "@/modules/commands/start-run";
import { updateTask as updateTaskCommand } from "@/modules/commands/update-task";
import { createRuntimeAdapter } from "@/modules/runtime/openclaw/adapter";

function revalidateWorkspaceTaskPaths(workspaceId: string, taskId: string) {
  revalidateAppPaths([
    "/workspaces",
    "/schedule",
    "/tasks",
    `/workspaces/${workspaceId}`,
    `/workspaces/${workspaceId}/tasks/${taskId}`,
    `/workspaces/${workspaceId}/work/${taskId}`,
    "/inbox",
  ]);
}

function revalidateMemoryPaths(workspaceId: string, taskId: string | null) {
  revalidateAppPaths(["/memory"]);

  if (taskId) {
    revalidateWorkspaceTaskPaths(workspaceId, taskId);
  }
}

function revalidateAppPaths(paths: string[]) {
  const variants = new Set(paths.flatMap((path) => getPathVariants(path)));

  for (const path of variants) {
    revalidatePath(path);
  }
}

export async function updateTask(input: Parameters<typeof updateTaskCommand>[0]) {
  const result = await updateTaskCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function createTask(input: Parameters<typeof createTaskCommand>[0]) {
  const result = await createTaskCommand(input);
  revalidateAppPaths([
    "/workspaces",
    "/schedule",
    "/tasks",
    `/workspaces/${result.workspaceId}`,
    `/workspaces/${result.workspaceId}/tasks/${result.taskId}`,
  ]);
  return result;
}

export async function createTaskFromSchedule(input: Parameters<typeof createTaskCommand>[0]) {
  return createTask(input);
}

export async function updateTaskConfigFromSchedule(input: Parameters<typeof updateTaskCommand>[0]) {
  return updateTask(input);
}

export async function applySchedule(input: Parameters<typeof applyScheduleCommand>[0]) {
  const result = await applyScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function clearSchedule(input: Parameters<typeof clearScheduleCommand>[0]) {
  const result = await clearScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function proposeSchedule(input: Parameters<typeof proposeScheduleCommand>[0]) {
  const result = await proposeScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function acceptScheduleProposal(proposalId: string, resolutionNote?: string) {
  const result = await decideScheduleProposalCommand({
    proposalId,
    decision: "Accepted",
    resolutionNote,
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function rejectScheduleProposal(proposalId: string, resolutionNote?: string) {
  const result = await decideScheduleProposalCommand({
    proposalId,
    decision: "Rejected",
    resolutionNote,
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function startRun(input: Parameters<typeof startRunCommand>[0]) {
  const result = await startRunCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function retryRun(input: Parameters<typeof retryRunCommand>[0]) {
  const adapter = await createRuntimeAdapter();
  const result = await retryRunCommand({ ...input, adapter });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function resumeRun(input: Omit<Parameters<typeof resumeRunCommand>[0], "adapter">) {
  const adapter = await createRuntimeAdapter();
  const result = await resumeRunCommand({ ...input, adapter });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function resolveApproval(
  input: Omit<Parameters<typeof resolveApprovalCommand>[0], "adapter">,
) {
  const adapter = await createRuntimeAdapter();
  const result = await resolveApprovalCommand({ ...input, adapter });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function approveApproval(approvalId: string) {
  const adapter = await createRuntimeAdapter();
  const result = await resolveApprovalCommand({
    approvalId,
    decision: "Approved",
    resolutionNote: "Approved from inbox",
    adapter,
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
}

export async function rejectApproval(approvalId: string) {
  const adapter = await createRuntimeAdapter();
  const result = await resolveApprovalCommand({
    approvalId,
    decision: "Rejected",
    resolutionNote: "Rejected from inbox",
    adapter,
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
}

export async function editAndApproveApproval(formData: FormData) {
  const approvalId = String(formData.get("approvalId") ?? "");
  const editedContent = String(formData.get("editedContent") ?? "");

  if (!approvalId) {
    throw new Error("approvalId is required");
  }

  const adapter = await createRuntimeAdapter();
  const result = await resolveApprovalCommand({
    approvalId,
    decision: "EditedAndApproved",
    editedContent,
    resolutionNote: "Edited and approved from inbox",
    adapter,
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
}

export async function provideInput(
  input: Omit<Parameters<typeof provideInputCommand>[0], "adapter">,
) {
  const adapter = await createRuntimeAdapter();
  const result = await provideInputCommand({ ...input, adapter });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function acceptTaskResult(input: Parameters<typeof acceptTaskResultCommand>[0]) {
  const result = await acceptTaskResultCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function markTaskDone(input: Parameters<typeof markTaskDoneCommand>[0]) {
  const result = await markTaskDoneCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function createFollowUpTask(input: Parameters<typeof createFollowUpTaskCommand>[0]) {
  const result = await createFollowUpTaskCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.followUpTaskId);
  return result;
}

export async function reopenTask(input: Parameters<typeof reopenTaskCommand>[0]) {
  const result = await reopenTaskCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function invalidateMemory(memoryId: string) {
  const result = await invalidateMemoryCommand({ memoryId });
  revalidateMemoryPaths(result.workspaceId, result.taskId);
}
