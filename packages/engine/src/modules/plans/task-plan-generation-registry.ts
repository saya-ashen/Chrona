import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
} from "@chrona/contracts";
import { randomUUID } from "node:crypto";

export class TaskPlanGenerationInFlightError extends Error {
  constructor(taskId: string) {
    super(
      `A task plan generation job is already running for task ${taskId}. Stop the current generation before starting a new one.`,
    );
    this.name = "TaskPlanGenerationInFlightError";
  }
}

type Subscriber = (event: GeneratePlanSSEEvent) => void;
function generationKey(taskId: string, workBlockId?: string | null) {
  return workBlockId ? `${taskId}:${workBlockId}` : taskId;
}


type SessionStatus = "running" | "completed" | "failed" | "cancelled";

type SessionSnapshot = TaskPlanGenerationSessionReadModel;

type SessionRecord = {
  generationId: string;
  taskId: string;
  key: string;
  workBlockId: string | null;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  done: boolean;
  snapshot: SessionSnapshot;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const sessionsByKey = new Map<string, SessionRecord>();
const sessionsByGenerationId = new Map<string, SessionRecord>();

function finishSession(session: SessionRecord, status: SessionStatus) {
  session.done = true;
  session.snapshot.status = status;
  session.snapshot.finishedAt = new Date().toISOString();
  sessionsByKey.delete(session.key);
  session.subscribers.clear();
  if (!session.cleanupTimer) {
    session.cleanupTimer = setTimeout(() => {
      sessionsByGenerationId.delete(session.generationId);
    }, 5 * 60 * 1000);
  }
}

function broadcast(session: SessionRecord, event: GeneratePlanSSEEvent) {
  switch (event.type) {
    case "status":
      session.snapshot.phase = event.phase;
      session.snapshot.statusMessage = event.message;
      break;
    case "partial":
      session.snapshot.partialText += event.text;
      break;
    case "result":
      session.snapshot.result = event.result;
      session.snapshot.status = "completed";
      break;
    case "error":
      session.snapshot.error = {
        code: event.code,
        message: event.message,
        rawText: event.rawText,
        diagnostics: event.diagnostics,
      };
      session.snapshot.status = "failed";
      break;
    case "cancelled":
      session.snapshot.status = "cancelled";
      break;
    case "done":
      if (session.snapshot.status === "running") {
        session.snapshot.status = session.snapshot.result ? "completed" : "cancelled";
      }
      break;
    case "tool_call":
      break;
  }

  for (const subscriber of session.subscribers) {
    subscriber(event);
  }

  if (event.type === "error") {
    finishSession(session, "failed");
  } else if (event.type === "cancelled") {
    finishSession(session, "cancelled");
  } else if (event.type === "done") {
    finishSession(session, session.snapshot.status);
  }
}

function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    error: snapshot.error ? { ...snapshot.error } : null,
    result: snapshot.result,
  };
}

export function startTaskPlanGeneration(input: { taskId: string; workBlockId?: string | null }) {
  const key = generationKey(input.taskId, input.workBlockId ?? null);
  const existing = sessionsByKey.get(key);
  if (existing && !existing.controller.signal.aborted && !existing.done) {
    throw new TaskPlanGenerationInFlightError(input.taskId);
  }

  const generationId = randomUUID();
  const session: SessionRecord = {
    generationId,
    taskId: input.taskId,
    key,
    workBlockId: input.workBlockId ?? null,
    controller: new AbortController(),
    subscribers: new Set(),
    done: false,
    cleanupTimer: null,
    snapshot: {
      generationId,
      taskId: input.taskId,
      status: "running",
      phase: "starting",
      statusMessage: null,
      partialText: "",
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
  };

  sessionsByKey.set(key, session);
  sessionsByGenerationId.set(generationId, session);

  return {
    generationId,
    signal: session.controller.signal,
    emit(event: GeneratePlanSSEEvent) {
      broadcast(session, event);
    },
    finish() {
      if (!session.done) {
        broadcast(session, { type: "done" });
      }
    },
  };
}

export function subscribeTaskPlanGeneration(input: { taskId: string; workBlockId?: string | null }, subscriber: Subscriber) {
  const session = sessionsByKey.get(generationKey(input.taskId, input.workBlockId ?? null));
  if (!session) {
    return null;
  }

  session.subscribers.add(subscriber);
  return {
    generationId: session.generationId,
    unsubscribe() {
      session.subscribers.delete(subscriber);
    },
  };
}

export function subscribeTaskPlanGenerationById(generationId: string, subscriber: Subscriber) {
  const session = sessionsByGenerationId.get(generationId);
  if (!session) {
    return null;
  }

  session.subscribers.add(subscriber);
  return {
    taskId: session.taskId,
    unsubscribe() {
      session.subscribers.delete(subscriber);
    },
  };
}

export function stopTaskPlanGeneration(input: { taskId: string; workBlockId?: string | null }) {
  const session = sessionsByKey.get(generationKey(input.taskId, input.workBlockId ?? null));
  if (!session) {
    return false;
  }

  session.controller.abort();
  if (!session.done) {
    broadcast(session, { type: "cancelled" });
  }
  return true;
}

export function isTaskPlanGenerationRunning(input: { taskId: string; workBlockId?: string | null }) {
  const session = sessionsByKey.get(generationKey(input.taskId, input.workBlockId ?? null));
  return Boolean(session && !session.controller.signal.aborted && !session.done);
}

export function getTaskPlanGenerationSession(input: { taskId: string; workBlockId?: string | null }) {
  const snapshot = sessionsByKey.get(generationKey(input.taskId, input.workBlockId ?? null))?.snapshot;
  return snapshot ? cloneSnapshot(snapshot) : null;
}

export function getTaskPlanGenerationSessionById(generationId: string) {
  const snapshot = sessionsByGenerationId.get(generationId)?.snapshot;
  return snapshot ? cloneSnapshot(snapshot) : null;
}
