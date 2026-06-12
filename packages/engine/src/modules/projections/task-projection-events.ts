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

/**
 * Full state snapshot pushed on SSE connect. Client uses this to seed the
 * `StateProvider` store before any delta arrives. `state` is a flat
 * `Record<string, unknown>` keyed by JSON Pointer paths, matching
 * `createStateStore`'s shape.
 */
type StateSnapshotEvent = WorkspaceEventBase & {
  type: "state.snapshot";
  state: Record<string, unknown>;
};

/**
 * Batched state delta. `updates` is a `{ [jsonPointerPath]: value }` map.
 * Mirrors `StateStore.update` semantics: only paths whose value changes are
 * applied, and a single subscriber notification is emitted.
 */
type StateUpdateEvent = WorkspaceEventBase & {
  type: "state.update";
  updates: Record<string, unknown>;
};

type TaskProjectionEvent =
  | SpecPatchEvent
  | TaskProjectionUpdatedEvent
  | TaskWorkspaceUpdatedEvent
  | TaskWorkspaceCommandEvent
  | TaskWorkspaceRuntimeEvent
  | StateSnapshotEvent
  | StateUpdateEvent;


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

/**
 * Push a full state snapshot onto the SSE bus. Callers (typically the
 * workspace SSE handler) emit this once on connect so the client
 * `StateProvider` store can be seeded before deltas arrive.
 *
 * `state` is a flat map of JSON Pointer paths to values, matching
 * `StateStore.update`'s input shape.
 */
export function publishTaskStateSnapshot(input: {
  taskId: string;
  workspaceId: string;
  workBlockId?: string | null;
  state: Record<string, unknown>;
}) {
  appendTaskWorkspaceEvent({
    type: "state.snapshot",
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workBlockId: input.workBlockId,
    state: input.state,
  });
}

/**
 * Push a batched state delta onto the SSE bus. Caller is responsible
 * for batching (e.g. coalescing rapid plan generation events into a
 * single tick) so clients only get one store notification per batch.
 */
export function publishTaskStateUpdate(input: {
  taskId: string;
  workspaceId: string;
  workBlockId?: string | null;
  updates: Record<string, unknown>;
}) {
  appendTaskWorkspaceEvent({
    type: "state.update",
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workBlockId: input.workBlockId,
    updates: input.updates,
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
