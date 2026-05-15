type TaskProjectionEvent = {
  type: "task_projection_updated";
  taskId: string;
  workspaceId: string;
  persistedStatus: string;
  updatedAt: string;
};

type TaskProjectionEventListener = (event: TaskProjectionEvent) => void;

const listenersByTask = new Map<string, Set<TaskProjectionEventListener>>();

export function publishTaskProjectionEvent(event: TaskProjectionEvent) {
  const listeners = listenersByTask.get(event.taskId);
  if (!listeners?.size) return;

  for (const listener of [...listeners]) {
    listener(event);
  }
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
