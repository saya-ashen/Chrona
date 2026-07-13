import { apiJson } from "@shared/http";
import type { AutomationTimingPreset } from "@chrona/contracts";
import type { ExecutionActionInput } from "@chrona/contracts"

export type CreateTaskFromScheduleInput = {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: string;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset;
  autoExecuteTiming?: AutomationTimingPreset;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
  aiClientId?: string | null;
  parentTaskId?: string | null;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
};

type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

function taskPayload(input: CreateTaskFromScheduleInput) {
  return {
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? undefined,
    priority: input.priority as TaskPriority | undefined,
    autoPlanGeneration: input.autoPlanGeneration,
    autoExecute: input.autoExecute,
    autoPlanGenerationTiming: input.autoPlanGenerationTiming,
    autoExecuteTiming: input.autoExecuteTiming,
    executionRuntime: input.executionRuntime,
    executionConfig: input.executionConfig,
    aiClientId: input.aiClientId ?? null,
    parentTaskId: input.parentTaskId,
    recurrenceRule: input.recurrenceRule ?? undefined,
    recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
    recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
  };
}

export function createTaskFromSchedule(input: CreateTaskFromScheduleInput) {
  return apiJson<unknown>("/api/tasks", { method: "POST", body: JSON.stringify(taskPayload(input)) });
}

export async function createScheduledTask(input: CreateTaskFromScheduleInput & {
  dueAt: Date | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}) {
  const created = await createTaskFromSchedule(input) as { taskId: string };
  await applySchedule({
    taskId: created.taskId,
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    scheduleSource: "human",
  });
  return created;
}

export function updateTaskConfigFromSchedule(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
  aiClientId?: string | null;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset;
  autoExecuteTiming?: AutomationTimingPreset;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
}) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      taskId: undefined,
      priority: input.priority as TaskPriority | undefined,
      aiClientId: input.aiClientId ?? null,
      description: input.description ?? undefined,
      recurrenceRule: input.recurrenceRule ?? undefined,
      recurrenceAnchorStartAt: input.recurrenceAnchorStartAt ?? undefined,
      recurrenceAnchorEndAt: input.recurrenceAnchorEndAt ?? undefined,
    }),
  });
}

export function deleteTask(input: { taskId: string }) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}`, { method: "DELETE" });
}

export function applySchedule(input: {
  taskId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}/schedule`, {
    method: "PUT",
    body: JSON.stringify({
      scheduledStartAt: input.scheduledStartAt.toISOString(),
      scheduledEndAt: input.scheduledEndAt.toISOString(),
      dueAt: input.dueAt?.toISOString() ?? null,
      scheduleSource: input.scheduleSource ?? "system",
    }),
  });
}

export function clearSchedule(input: { taskId: string }) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}/schedule`, { method: "DELETE" });
}

export function moveWorkBlock(input: {
  workBlockId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}) {
  return apiJson<unknown>(`/api/tasks/work-blocks/${encodeURIComponent(input.workBlockId)}/schedule`, {
    method: "PUT",
    body: JSON.stringify({
      scheduledStartAt: input.scheduledStartAt.toISOString(),
      scheduledEndAt: input.scheduledEndAt.toISOString(),
    }),
  });
}

export function decideScheduleProposal(input: {
  proposalId: string;
  decision: "Accepted" | "Rejected";
  resolutionNote?: string | null;
}) {
  return apiJson<unknown>("/api/tasks/schedule-proposals/decision", {
    method: "POST",
    body: JSON.stringify({
      proposalId: input.proposalId,
      decision: input.decision,
      resolutionNote: input.resolutionNote ?? undefined,
    }),
  });
}

function executionAction(taskId: string, action: Record<string, unknown>) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(taskId)}/execution/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function startExecution(input: { taskId: string; prompt?: string | null }) {
  return executionAction(input.taskId, { action: "start_manual", prompt: input.prompt ?? undefined });
}

export function retryExecution(input: { taskId: string; prompt?: string | null }) {
  return executionAction(input.taskId, { action: "start_manual", prompt: input.prompt ?? undefined });
}

export function dispatchExecutionAction(input: { taskId: string; action: ExecutionActionInput }) {
  return executionAction(input.taskId, input.action);
}

export function submitExecutionInput(input: { taskId: string; inputFields: Record<string, string> }) {
  return executionAction(input.taskId, { action: "resume_with_input", inputFields: input.inputFields });
}

export function sendExecutionMessage(input: { taskId: string; message: string }) {
  return executionAction(input.taskId, { action: "resume_after_unblock", note: input.message });
}

export function markTaskDone(input: { taskId: string }) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}/complete`, { method: "POST" });
}

export function reopenTask(input: { taskId: string }) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}/reopen`, { method: "POST" });
}

export function acceptTaskActionResult(input: { taskId: string }) {
  return apiJson<unknown>(`/api/tasks/${encodeURIComponent(input.taskId)}/result/accept`, { method: "POST" });
}
