'use server'

import { revalidatePath } from "next/cache";
import { invalidateMemory as invalidateMemoryCommand } from "@/modules/commands/invalidate-memory";
import { provideInput as provideInputCommand } from "@/modules/commands/provide-input";
import { resolveApproval as resolveApprovalCommand } from "@/modules/commands/resolve-approval";
import { resumeRun as resumeRunCommand } from "@/modules/commands/resume-run";
import { retryRun as retryRunCommand } from "@/modules/commands/retry-run";
import { startRun as startRunCommand } from "@/modules/commands/start-run";
import { updateTask as updateTaskCommand } from "@/modules/commands/update-task";
import { createRuntimeAdapter } from "@/modules/runtime/openclaw/adapter";

function revalidateWorkspaceTaskPaths(workspaceId: string, taskId: string) {
  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath(`/workspaces/${workspaceId}/tasks/${taskId}`);
  revalidatePath(`/workspaces/${workspaceId}/work/${taskId}`);
  revalidatePath("/inbox");
}

function revalidateMemoryPaths(workspaceId: string, taskId: string | null) {
  revalidatePath("/memory");

  if (taskId) {
    revalidateWorkspaceTaskPaths(workspaceId, taskId);
  }
}

export async function updateTask(input: Parameters<typeof updateTaskCommand>[0]) {
  const result = await updateTaskCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function startRun(input: Parameters<typeof startRunCommand>[0]) {
  const adapter = await createRuntimeAdapter();
  const result = await startRunCommand({ ...input, adapter });
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

export async function invalidateMemory(memoryId: string) {
  const result = await invalidateMemoryCommand({ memoryId });
  revalidateMemoryPaths(result.workspaceId, result.taskId);
}
