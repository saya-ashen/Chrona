import { deleteJson, patchJson, postJson } from "./http-client";

type TaskMutationResult = {
  taskId: string;
  workspaceId: string;
};

type FollowUpTaskResult = TaskMutationResult & {
  followUpTaskId: string;
};

type RunMutationResult = TaskMutationResult & {
  runId?: string;
};

function createTask(input: {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: string;
  dueAt?: Date | null;
  runtimeAdapterKey?: string;
  runtimeInput?: unknown;
  runtimeInputVersion?: string;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
  parentTaskId?: string | null;
}) {
  return postJson<TaskMutationResult>("/api/tasks", {
    ...input,
    dueAt: input.dueAt ? input.dueAt.toISOString() : input.dueAt ?? undefined,
  });
}

function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  runtimeAdapterKey?: string;
  runtimeInput?: unknown;
  runtimeInputVersion?: string;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
}) {
  const { taskId, ...body } = input;
  return patchJson<TaskMutationResult>(`/api/tasks/${taskId}`, {
    ...body,
    dueAt: body.dueAt === undefined ? undefined : body.dueAt ? body.dueAt.toISOString() : null,
    scheduledStartAt:
      body.scheduledStartAt === undefined
        ? undefined
        : body.scheduledStartAt
          ? body.scheduledStartAt.toISOString()
          : null,
    scheduledEndAt:
      body.scheduledEndAt === undefined
        ? undefined
        : body.scheduledEndAt
          ? body.scheduledEndAt.toISOString()
          : null,
  });
}

export function createTaskFromSchedule(input: Parameters<typeof createTask>[0]) {
  return createTask(input);
}

export function updateTaskConfigFromSchedule(input: Parameters<typeof updateTask>[0]) {
  return updateTask(input);
}

export function applySchedule(input: {
  taskId: string;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  const { taskId, ...body } = input;
  return postJson<TaskMutationResult>(`/api/tasks/${taskId}/schedule`, {
    ...body,
    scheduledStartAt: body.scheduledStartAt ? body.scheduledStartAt.toISOString() : null,
    scheduledEndAt: body.scheduledEndAt ? body.scheduledEndAt.toISOString() : null,
    dueAt: body.dueAt ? body.dueAt.toISOString() : null,
  });
}

export function clearSchedule(input: { taskId: string }) {
  return deleteJson<TaskMutationResult>(`/api/tasks/${input.taskId}/schedule`);
}

export function startRun(input: { taskId: string; prompt?: string | null }) {
  return postJson<RunMutationResult>(`/api/tasks/${input.taskId}/run`, {
    prompt: input.prompt,
  });
}

export function retryRun(input: { taskId: string; prompt?: string | null }) {
  return postJson<RunMutationResult>(`/api/tasks/${input.taskId}/retry`, {
    prompt: input.prompt,
  });
}

export function provideInput(input: { taskId: string; runId?: string; inputText: string }) {
  return postJson<RunMutationResult>(`/api/tasks/${input.taskId}/input`, {
    runId: input.runId,
    inputText: input.inputText,
  });
}

export function sendOperatorMessage(input: { taskId: string; runId?: string; message: string }) {
  return postJson<RunMutationResult>(`/api/tasks/${input.taskId}/message`, {
    runId: input.runId,
    message: input.message,
  });
}

export function markTaskDone(input: { taskId: string }) {
  return postJson<TaskMutationResult>(`/api/tasks/${input.taskId}/done`);
}

export function reopenTask(input: { taskId: string }) {
  return postJson<TaskMutationResult>(`/api/tasks/${input.taskId}/reopen`);
}

export function acceptTaskResult(input: { taskId: string }) {
  return postJson<RunMutationResult>(`/api/tasks/${input.taskId}/result/accept`);
}

export function acceptScheduleProposal(proposalId: string, resolutionNote?: string) {
  return postJson<TaskMutationResult & { proposalId: string }>("/api/schedule/proposals/decision", {
    proposalId,
    decision: "Accepted",
    resolutionNote,
  });
}

export function rejectScheduleProposal(proposalId: string, resolutionNote?: string) {
  return postJson<TaskMutationResult & { proposalId: string }>("/api/schedule/proposals/decision", {
    proposalId,
    decision: "Rejected",
    resolutionNote,
  });
}

export function approveApproval(approvalId: string) {
  return postJson<TaskMutationResult & { runId?: string }>(`/api/approvals/${approvalId}/resolve`, {
    decision: "Approved",
    resolutionNote: "Approved from inbox",
  });
}

export function rejectApproval(approvalId: string) {
  return postJson<TaskMutationResult & { runId?: string }>(`/api/approvals/${approvalId}/resolve`, {
    decision: "Rejected",
    resolutionNote: "Rejected from inbox",
  });
}

export function editAndApproveApproval(formData: FormData) {
  const approvalId = String(formData.get("approvalId") ?? "");
  const editedContent = String(formData.get("editedContent") ?? "");

  if (!approvalId) {
    throw new Error("approvalId is required");
  }

  return postJson<TaskMutationResult & { runId?: string }>(`/api/approvals/${approvalId}/resolve`, {
    decision: "EditedAndApproved",
    editedContent,
    resolutionNote: "Edited and approved from inbox",
  });
}

export function invalidateMemory(memoryId: string) {
  return postJson<{ memoryId: string; workspaceId: string; taskId: string | null }>(
    `/api/memories/${memoryId}/invalidate`,
  );
}

export function createFollowUpTask(input: {
  taskId: string;
  title: string;
  dueAt?: Date | null;
}) {
  return postJson<FollowUpTaskResult>(`/api/tasks/${input.taskId}/follow-up`, {
    title: input.title,
    dueAt: input.dueAt ? input.dueAt.toISOString() : input.dueAt ?? null,
  });
}
