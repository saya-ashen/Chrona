type WorkspaceEventBase = {
  taskId: string;
  workspaceId: string;
  workBlockId?: string | null;
  sequence: number;
  occurredAt: string;
  commandId?: string;
};

export type SpecPatch = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
};

type TaskProjectionUpdatedEvent = WorkspaceEventBase & {
  type: "task_projection_updated";
  persistedStatus: string;
  updatedAt: string;
};

type TaskWorkspaceUpdatedEvent = WorkspaceEventBase & {
  type: "task_workspace_updated";
  reason: string;
  updatedAt: string;
};

type TaskWorkspaceCommandEvent = WorkspaceEventBase & {
  type: "command.accepted" | "command.failed";
  commandType: string;
  message?: string;
};

type TaskWorkspaceRuntimeEvent = WorkspaceEventBase & {
  type:
    | "plan.generation.event"
    | "execution.runtime_event"
    | "execution.state.updated"
    | "execution.result"
    | "checkpoint.result";
  eventKind?: string;
  [key: string]: unknown;
};

type SpecPatchEvent = WorkspaceEventBase & {
  type: "spec.patch";
  document: "header" | "now" | "output" | "trail";
  patches: SpecPatch[];
};

type TaskProjectionEvent =
  | SpecPatchEvent
  | TaskProjectionUpdatedEvent
  | TaskWorkspaceUpdatedEvent
  | TaskWorkspaceCommandEvent
  | TaskWorkspaceRuntimeEvent;

type TaskProjectionEventListener = (event: TaskProjectionEvent) => void;

const listenersByTask = new Map<string, Set<TaskProjectionEventListener>>();
const sequencesByTask = new Map<string, number>();

function nextSequence(taskId: string) {
  const sequence = (sequencesByTask.get(taskId) ?? 0) + 1;
  sequencesByTask.set(taskId, sequence);
  return sequence;
}

export function appendTaskWorkspaceEvent<T extends Omit<TaskProjectionEvent, "sequence" | "occurredAt">>(
  event: T,
) {
  const nextEvent = {
    ...event,
    sequence: nextSequence(event.taskId),
    occurredAt: new Date().toISOString(),
  } as unknown as TaskProjectionEvent;

  publishTaskProjectionEvent(nextEvent);
  return nextEvent;
}

export function publishTaskProjectionEvent(event: TaskProjectionEvent) {
  const listeners = listenersByTask.get(event.taskId);
  if (!listeners?.size) return;

  for (const listener of [...listeners]) {
    listener(event);
  }
}

export function publishTaskWorkspaceUpdatedEvent(input: {
  taskId: string;
  workspaceId: string;
  workBlockId?: string | null;
  reason: string;
}) {
  appendTaskWorkspaceEvent({
    type: "task_workspace_updated",
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workBlockId: input.workBlockId,
    reason: input.reason,
    updatedAt: new Date().toISOString(),
  });
}

export function subscribeToTaskProjectionEvents(
  taskId: string,
  listener: TaskProjectionEventListener,
) {
  let listeners = listenersByTask.get(taskId);
  if (!listeners) {
    listeners = new Set();
    listenersByTask.set(taskId, listeners);
  }

  listeners.add(listener);

  return {
    unsubscribe() {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        listenersByTask.delete(taskId);
      }
    },
  };
}

export type { TaskProjectionEvent };
