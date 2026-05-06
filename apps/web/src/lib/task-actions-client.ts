import { api } from "./rpc-client";

// ═══════════════════════════════════════════════════════════════
// Task CRUD
// ═══════════════════════════════════════════════════════════════

export function createTaskFromSchedule(input: {
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
  return api.tasks.$post({
    json: {
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority as "Low" | "Medium" | "High" | "Urgent" | undefined,
      dueAt: input.dueAt ? input.dueAt.toISOString() : null,
      runtimeAdapterKey: input.runtimeAdapterKey,
      runtimeInput: input.runtimeInput,
      runtimeInputVersion: input.runtimeInputVersion,
      runtimeModel: input.runtimeModel,
      prompt: input.prompt,
      runtimeConfig: input.runtimeConfig,
      parentTaskId: input.parentTaskId,
    },
  }).then((r) => r.json());
}

export function updateTaskConfigFromSchedule(input: {
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
  return api.tasks[":taskId"].$patch({
    param: { taskId: input.taskId },
    json: {
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority as "Low" | "Medium" | "High" | "Urgent" | undefined,
      dueAt: input.dueAt === undefined ? undefined : input.dueAt ? input.dueAt.toISOString() : null,
      scheduledStartAt:
        input.scheduledStartAt === undefined
          ? undefined
          : input.scheduledStartAt
            ? input.scheduledStartAt.toISOString()
            : null,
      scheduledEndAt:
        input.scheduledEndAt === undefined
          ? undefined
          : input.scheduledEndAt
            ? input.scheduledEndAt.toISOString()
            : null,
      runtimeAdapterKey: input.runtimeAdapterKey,
      runtimeInput: input.runtimeInput,
      runtimeInputVersion: input.runtimeInputVersion,
      runtimeModel: input.runtimeModel,
      prompt: input.prompt,
      runtimeConfig: input.runtimeConfig,
    },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Schedule
// ═══════════════════════════════════════════════════════════════

export function applySchedule(input: {
  taskId: string;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  return api.tasks[":taskId"].schedule.$post({
    param: { taskId: input.taskId },
    json: {
      scheduledStartAt: input.scheduledStartAt?.toISOString() ?? "",
      scheduledEndAt: input.scheduledEndAt?.toISOString() ?? "",
      dueAt: input.dueAt?.toISOString() ?? null,
      scheduleSource: input.scheduleSource ?? "system",
    },
  }).then((r) => r.json());
}

export function clearSchedule(input: { taskId: string }) {
  return api.tasks[":taskId"].schedule.$delete({
    param: { taskId: input.taskId },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════

export function startExecution(input: { taskId: string; prompt?: string | null }) {
  return api.tasks[":taskId"].run.$post({
    param: { taskId: input.taskId },
    json: { prompt: input.prompt ?? undefined },
  }).then((r) => r.json());
}

export function retryExecution(input: { taskId: string; prompt?: string | null }) {
  return api.tasks[":taskId"].retry.$post({
    param: { taskId: input.taskId },
    json: { prompt: input.prompt ?? undefined },
  }).then((r) => r.json());
}

export function submitExecutionInput(input: { taskId: string; inputText: string }) {
  return api.tasks[":taskId"].input.$post({
    param: { taskId: input.taskId },
    json: { inputText: input.inputText },
  }).then((r) => r.json());
}

export function sendExecutionMessage(input: { taskId: string; message: string }) {
  return api.tasks[":taskId"].message.$post({
    param: { taskId: input.taskId },
    json: { message: input.message },
  }).then((r) => r.json());
}

export function markTaskDone(input: { taskId: string }) {
  return api.tasks[":taskId"].done.$post({
    param: { taskId: input.taskId },
  }).then((r) => r.json());
}

export function reopenTask(input: { taskId: string }) {
  return api.tasks[":taskId"].reopen.$post({
    param: { taskId: input.taskId },
  }).then((r) => r.json());
}

export function acceptTaskResult(input: { taskId: string }) {
  return api.tasks[":taskId"].result.accept.$post({
    param: { taskId: input.taskId },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Schedule Proposals
// ═══════════════════════════════════════════════════════════════

export function acceptScheduleProposal(proposalId: string, resolutionNote?: string) {
  return api.schedule.proposals.decision.$post({
    json: {
      proposalId,
      decision: "Accepted",
      resolutionNote,
    },
  }).then((r) => r.json());
}

export function rejectScheduleProposal(proposalId: string, resolutionNote?: string) {
  return api.schedule.proposals.decision.$post({
    json: {
      proposalId,
      decision: "Rejected",
      resolutionNote,
    },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Approvals
// ═══════════════════════════════════════════════════════════════

export function approveApproval(approvalId: string) {
  return api.approvals[":approvalId"].resolve.$post({
    param: { approvalId },
    json: {
      decision: "Approved",
      resolutionNote: "Approved from inbox",
    },
  }).then((r) => r.json());
}

export function rejectApproval(approvalId: string) {
  return api.approvals[":approvalId"].resolve.$post({
    param: { approvalId },
    json: {
      decision: "Rejected",
      resolutionNote: "Rejected from inbox",
    },
  }).then((r) => r.json());
}

export function editAndApproveApproval(formData: FormData) {
  const approvalId = String(formData.get("approvalId") ?? "");
  const editedContent = String(formData.get("editedContent") ?? "");

  if (!approvalId) {
    throw new Error("approvalId is required");
  }

  return api.approvals[":approvalId"].resolve.$post({
    param: { approvalId },
    json: {
      decision: "EditedAndApproved",
      editedContent,
      resolutionNote: "Edited and approved from inbox",
    },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════

export function invalidateMemory(memoryId: string) {
  return api.memories[":memoryId"].invalidate.$post({
    param: { memoryId },
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
// Follow-Up
// ═══════════════════════════════════════════════════════════════

export function createFollowUpTask(input: {
  taskId: string;
  title: string;
  dueAt?: Date | null;
}) {
  return api.tasks[":taskId"]["follow-up"].$post({
    param: { taskId: input.taskId },
    json: {
      title: input.title,
      dueAt: input.dueAt ? input.dueAt.toISOString() : null,
    },
  }).then((r) => r.json());
}
