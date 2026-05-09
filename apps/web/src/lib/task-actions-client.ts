import { api } from "./rpc-client";

type ExecutionRuntime = "openclaw" | "research";

async function parseActionResponse(response: {
  ok: boolean;
  json: () => Promise<unknown>;
}) {
  const body = await response.json();
  if (!response.ok && body && typeof body === "object" && "error" in body) {
    throw new Error(String((body as { error: unknown }).error));
  }

  return body;
}

// ═══════════════════════════════════════════════════════════════
// Task CRUD
// ═══════════════════════════════════════════════════════════════

export function createTaskFromSchedule(input: {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: string;
  executionRuntime?: ExecutionRuntime;
  executionConfig?: Record<string, unknown>;
  parentTaskId?: string | null;
}) {
  return api.tasks
    .$post({
      json: {
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? undefined,
        priority: input.priority as
          | "Low"
          | "Medium"
          | "High"
          | "Urgent"
          | undefined,
        executionRuntime: input.executionRuntime,
        executionConfig: input.executionConfig,
        parentTaskId: input.parentTaskId,
      },
    })
    .then(parseActionResponse);
}

export function updateTaskConfigFromSchedule(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  executionRuntime?: ExecutionRuntime;
  executionConfig?: Record<string, unknown>;
}) {
  return api.tasks[":taskId"]
    .$patch({
      param: { taskId: input.taskId },
      json: {
        title: input.title,
        description: input.description ?? undefined,
        priority: input.priority as
          | "Low"
          | "Medium"
          | "High"
          | "Urgent"
          | undefined,
        executionRuntime: input.executionRuntime,
        executionConfig: input.executionConfig,
      },
    })
    .then(parseActionResponse);
}

// ═══════════════════════════════════════════════════════════════
// Schedule
// ═══════════════════════════════════════════════════════════════

export function applySchedule(input: {
  taskId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt?: Date | null;
  scheduleSource?: "human" | "ai" | "system";
}) {
  return api.tasks[":taskId"]
    .schedule.$put({
      param: { taskId: input.taskId },
      json: {
        scheduledStartAt: input.scheduledStartAt.toISOString(),
        scheduledEndAt: input.scheduledEndAt.toISOString(),
        dueAt: input.dueAt?.toISOString() ?? null,
        scheduleSource: input.scheduleSource ?? "system",
      },
    })
    .then(parseActionResponse);
}

export function clearSchedule(input: { taskId: string }) {
  return api.tasks[":taskId"]
    .schedule.$delete({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

// ═══════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════

export function startExecution(input: {
  taskId: string;
  prompt?: string | null;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "start_manual", prompt: input.prompt ?? undefined },
    })
    .then(parseActionResponse);
}

export function retryExecution(input: {
  taskId: string;
  prompt?: string | null;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "start_manual", prompt: input.prompt ?? undefined },
    })
    .then(parseActionResponse);
}

export function submitExecutionInput(input: {
  taskId: string;
  inputText: string;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "resume_with_input", inputText: input.inputText },
    })
    .then(parseActionResponse);
}

export function sendExecutionMessage(input: {
  taskId: string;
  message: string;
}) {
  return api.tasks[":taskId"].execution.actions
    .$post({
      param: { taskId: input.taskId },
      json: { action: "resume_after_unblock", note: input.message },
    })
    .then(parseActionResponse);
}

export function markTaskDone(input: { taskId: string }) {
  return api.tasks[":taskId"].complete
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

export function reopenTask(input: { taskId: string }) {
  return api.tasks[":taskId"].reopen
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}

export function acceptTaskResult(input: { taskId: string }) {
  return api.tasks[":taskId"].result.accept
    .$post({
      param: { taskId: input.taskId },
    })
    .then(parseActionResponse);
}
