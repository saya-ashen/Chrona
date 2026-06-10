"use client";

import { useEffect, useSyncExternalStore } from "react";
import type {
  GeneratePlanErrorCode,
  GeneratePlanStatusPhase,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts/ai";
import { buildAccessKeyHeaders, handleUnauthorizedResponse } from "@/lib/access-key";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";

type StreamToolCall = {
  tool: string;
  input: Record<string, unknown>;
};

type StreamToolResult = {
  tool: string;
  result: string;
};

export type TaskPlanSessionState = {
  taskId: string;
  generationId: string | null;
  sessionStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  result: TaskPlanReadModel | null;
  isLoading: boolean;
  error: string | null;
  errorCode: GeneratePlanErrorCode | null;
  phase: GeneratePlanStatusPhase | "idle" | "connecting" | "done" | "error";
  statusMessage: string | null;
  partialText: string;
  toolCalls: StreamToolCall[];
  toolResults: StreamToolResult[];
  startedAt: string | null;
  finishedAt: string | null;
  connected: boolean;
  hydrated: boolean;
};

type SessionEntry = {
  state: TaskPlanSessionState;
  listeners: Set<() => void>;
  streamController: AbortController | null;
  activeSubscriptionController: AbortController | null;
  hydratePromise: Promise<void> | null;
};

function sessionKey(taskId: string, workBlockId?: string | null) {
  return workBlockId ? `${taskId}:${workBlockId}` : taskId;
}

function workBlockQuery(workBlockId?: string | null) {
  return workBlockId ? `?workBlockId=${encodeURIComponent(workBlockId)}` : "";
}

function createIdleState(taskId: string): TaskPlanSessionState {
  return {
    taskId,
    generationId: null,
    sessionStatus: "idle",
    result: null,
    isLoading: false,
    error: null,
    errorCode: null,
    phase: "idle",
    statusMessage: null,
    partialText: "",
    toolCalls: [],
    toolResults: [],
    startedAt: null,
    finishedAt: null,
    connected: false,
    hydrated: false,
  };
}

const sessions = new Map<string, SessionEntry>();

function getEntry(key: string) {
  let entry = sessions.get(key);
  if (!entry) {
    entry = {
      state: createIdleState(key),
      listeners: new Set(),
      streamController: null,
      activeSubscriptionController: null,
      hydratePromise: null,
    };
    sessions.set(key, entry);
  }
  return entry;
}

function emit(entry: SessionEntry) {
  for (const listener of entry.listeners) {
    listener();
  }
}

function patchState(key: string, updater: (state: TaskPlanSessionState) => TaskPlanSessionState) {
  const entry = getEntry(key);
  entry.state = updater(entry.state);
  emit(entry);
}

function applySessionSnapshot(key: string, snapshot: TaskPlanGenerationSessionReadModel | null) {
  patchState(key, (state) => {
    if (!snapshot) {
      return {
        ...state,
        generationId: null,
        hydrated: true,
        connected: false,
        isLoading: false,
        sessionStatus: state.sessionStatus === "failed" ? "failed" : state.result ? "completed" : "idle",
        phase: state.sessionStatus === "failed" ? "error" : state.result ? "done" : "idle",
      };
    }

    return {
      ...state,
      generationId: snapshot.generationId,
      sessionStatus: snapshot.status,
      result: snapshot.result,
      isLoading: snapshot.status === "running",
      error: snapshot.error?.message ?? null,
      errorCode: snapshot.error?.code ?? null,
      phase: snapshot.status === "failed" ? "error" : snapshot.status === "completed" ? "done" : snapshot.phase ?? "connecting",
      statusMessage: snapshot.statusMessage,
      partialText: snapshot.partialText,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      connected: snapshot.status === "running",
      hydrated: true,
    };
  });
}

function applyStreamEvent(key: string, event: string, data: Record<string, unknown>) {
  patchState(key, (state) => {
    switch (event) {
      case "session": {
        const generationId = typeof data.generationId === "string" ? data.generationId : state.generationId;
        const snapshot = (data.snapshot as TaskPlanGenerationSessionReadModel | undefined) ?? null;
        if (snapshot) {
          return {
            ...state,
            generationId,
            sessionStatus: snapshot.status,
            result: snapshot.result,
            isLoading: snapshot.status === "running",
            error: snapshot.error?.message ?? null,
            errorCode: snapshot.error?.code ?? null,
            phase: snapshot.status === "failed" ? "error" : snapshot.status === "completed" ? "done" : snapshot.phase ?? "connecting",
            statusMessage: snapshot.statusMessage,
            partialText: snapshot.partialText,
            startedAt: snapshot.startedAt,
            finishedAt: snapshot.finishedAt,
            connected: true,
            hydrated: true,
          };
        }
        return {
          ...state,
          generationId,
          sessionStatus: "running",
          isLoading: true,
          phase: state.phase === "idle" ? "connecting" : state.phase,
          connected: true,
          hydrated: true,
        };
      }
      case "status":
        return {
          ...state,
          sessionStatus: "running",
          isLoading: true,
          phase: typeof data.phase === "string" ? (data.phase as TaskPlanSessionState["phase"]) : "connecting",
          statusMessage: typeof data.message === "string" ? data.message : null,
          connected: true,
          hydrated: true,
        };
      case "tool_call":
        return {
          ...state,
          sessionStatus: "running",
          isLoading: true,
          phase: "connecting",
          toolCalls: [
            ...state.toolCalls,
            {
              tool: typeof data.tool === "string" ? data.tool : "unknown",
              input: (data.input as Record<string, unknown> | undefined) ?? {},
            },
          ],
          connected: true,
          hydrated: true,
        };
      case "tool_result":
        return {
          ...state,
          toolResults: [
            ...state.toolResults,
            {
              tool: typeof data.tool === "string" ? data.tool : "unknown",
              result: typeof data.result === "string" ? data.result : JSON.stringify(data.result ?? ""),
            },
          ],
        };
      case "partial":
        return {
          ...state,
          sessionStatus: "running",
          isLoading: true,
          phase: "connecting",
          partialText: `${state.partialText}${typeof data.text === "string" ? data.text : ""}`,
          connected: true,
          hydrated: true,
        };
      case "result":
        return {
          ...state,
          result: (data.result as TaskPlanReadModel | undefined) ?? null,
          sessionStatus: "completed",
          isLoading: false,
          phase: "done",
          connected: true,
          hydrated: true,
        };
      case "error":
        return {
          ...state,
          sessionStatus: "failed",
          isLoading: false,
          error: typeof data.message === "string" ? data.message : "Failed to generate task plan",
          errorCode: typeof data.code === "string" ? (data.code as GeneratePlanErrorCode) : null,
          phase: "error",
          connected: false,
          hydrated: true,
        };
      case "cancelled":
        return {
          ...state,
          sessionStatus: "cancelled",
          isLoading: false,
          phase: "done",
          connected: false,
          hydrated: true,
        };
      case "done":
        return {
          ...state,
          isLoading: false,
          sessionStatus: state.result ? "completed" : state.sessionStatus === "failed" ? "failed" : "cancelled",
          phase: state.phase === "error" ? "error" : "done",
          connected: false,
          hydrated: true,
        };
      default:
        return state;
    }
  });
}

async function fetchActiveSnapshot(taskId: string, workBlockId?: string | null) {
  const key = sessionKey(taskId, workBlockId);
  const response = await fetch(`/api/tasks/${taskId}/plan/generations/active${workBlockQuery(workBlockId)}`, {
    headers: buildAccessKeyHeaders(),
  });
  handleUnauthorizedResponse(response);
  if (!response.ok) {
    if (response.status === 404) {
      applySessionSnapshot(key, null);
      return;
    }
    throw new Error(`Failed to load active task plan generation (${response.status})`);
  }

  const payload = await response.json() as {
    generationSession?: TaskPlanGenerationSessionReadModel | null;
  };
  applySessionSnapshot(key, payload.generationSession ?? null);
}

async function ensureHydrated(taskId: string, workBlockId?: string | null) {
  const key = sessionKey(taskId, workBlockId);
  const entry = getEntry(key);
  if (entry.state.hydrated) {
    return;
  }
  if (entry.hydratePromise) {
    return entry.hydratePromise;
  }
  entry.hydratePromise = fetchActiveSnapshot(taskId, workBlockId).finally(() => {
    entry.hydratePromise = null;
  });
  return entry.hydratePromise;
}

type StateStoreBinding = {
  store: import("@json-render/core").StateStore;
  unsubscribe: () => void;
};

const storeBindingsByKey = new Map<string, StateStoreBinding>();

/**
 * Bind a task-plan session to a workspace `StateStore`. The session store
 * mirrors `/plan/*` paths from the store into its reducer-driven state
 * (`sessionStatus`, `phase`, `partialText`, etc.) and returns an
 * unsubscribe function. Used by the task workspace to consolidate runtime
 * state through a single SSE instead of opening a second stream per task.
 */
export function bindTaskPlanSessionToStateStore(
  taskId: string,
  workBlockId: string | null | undefined,
  store: import("@json-render/core").StateStore,
): () => void {
  const key = sessionKey(taskId, workBlockId ?? null);
  const existing = storeBindingsByKey.get(key);
  existing?.unsubscribe();
  const listener = () => {
    const snapshot = store.getSnapshot();
    applyStateSnapshotToSession(key, snapshot);
  };
  const unsubscribe = store.subscribe(listener);
  // Seed immediately so the first render after bind is consistent.
  listener();
  const binding: StateStoreBinding = { store, unsubscribe };
  storeBindingsByKey.set(key, binding);
  return () => {
    const current = storeBindingsByKey.get(key);
    if (current === binding) {
      current.unsubscribe();
      storeBindingsByKey.delete(key);
    }
  };
}

type AiPlanGenerationStatus = "accepted" | "generating" | "idle" | "waiting_acceptance";

function applyStateSnapshotToSession(key: string, snapshot: Record<string, unknown>) {
  const get = (path: string): unknown => (path in snapshot ? snapshot[path] : undefined);
  const planStatus = (get("/plan/status") as AiPlanGenerationStatus | null | undefined) ?? null;
  const generationId = (get("/plan/generation/id") as string | null | undefined) ?? null;
  const phase = (get("/plan/generation/phase") as TaskPlanSessionState["phase"] | null | undefined) ?? null;
  const partialText = (get("/plan/generation/partialText") as string | null | undefined) ?? "";
  const statusMessage = (get("/plan/generation/statusMessage") as string | null | undefined) ?? null;
  const errorMessage = (get("/plan/generation/error/message") as string | null | undefined) ?? null;
  const errorCode = (get("/plan/generation/error/code") as GeneratePlanErrorCode | null | undefined) ?? null;
  const generationStatus = (get("/plan/generation/status") as TaskPlanSessionState["sessionStatus"] | null | undefined) ?? null;

  patchState(key, (state) => {
    const nextSessionStatus: TaskPlanSessionState["sessionStatus"] = planStatus === "generating"
      ? "running"
      : planStatus === "accepted"
        ? "completed"
        : planStatus === null
          ? state.sessionStatus
          : (generationStatus ?? "idle");
    return {
      ...state,
      generationId: generationId ?? state.generationId,
      sessionStatus: nextSessionStatus,
      isLoading: nextSessionStatus === "running",
      phase: phase ?? (nextSessionStatus === "completed" ? "done" : nextSessionStatus === "failed" ? "error" : state.phase),
      statusMessage,
      partialText: partialText ?? state.partialText,
      error: errorMessage ?? state.error,
      errorCode: errorCode ?? state.errorCode,
      connected: true,
      hydrated: true,
    };
  });
}

export async function hydrateTaskPlanGenerationSession(taskId: string, workBlockId?: string | null) {
  await ensureHydrated(taskId, workBlockId);
}

export async function startTaskPlanGenerationSession(input: {
  taskId: string;
  workBlockId?: string | null;
  forceRefresh?: boolean;
  userInstruction?: string | null;
}) {
  const { taskId, workBlockId = null, forceRefresh = true } = input;
  const key = sessionKey(taskId, workBlockId);
  const userInstruction = input.userInstruction?.trim() || null;
  const entry = getEntry(key);
  entry.streamController?.abort();
  entry.activeSubscriptionController?.abort();

  const controller = new AbortController();
  entry.streamController = controller;
  let sawTerminalError = false;

  patchState(key, (state) => ({
    ...createIdleState(key),
    generationId: state.generationId,
    sessionStatus: "running",
    isLoading: true,
    phase: "connecting",
    connected: true,
    hydrated: true,
    startedAt: state.startedAt,
  }));

  try {
    await fetchJsonEventSource(`/api/tasks/${taskId}/plan/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ forceRefresh, userInstruction, workBlockId }),
      signal: controller.signal,
      onEvent({ event, data }) {
        if (event === "error") {
          sawTerminalError = true;
        }
        applyStreamEvent(key, event, data);
      },
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      sawTerminalError = true;
      patchState(key, (state) => ({
        ...state,
        sessionStatus: "failed",
        isLoading: false,
        phase: "error",
        connected: false,
        error: error instanceof Error ? error.message : "Failed to generate task plan",
      }));
    }
  } finally {
    const current = getEntry(key);
    if (current.streamController === controller) {
      current.streamController = null;
    }

    if (!sawTerminalError) {
      try {
        await fetchActiveSnapshot(taskId, workBlockId);
      } catch {
        // Leave current state in place when reconciliation fetch fails.
      }
    }
  }
}

export async function stopTaskPlanGenerationSession(taskId: string, workBlockId?: string | null) {
  const key = sessionKey(taskId, workBlockId);
  const entry = getEntry(key);
  entry.streamController?.abort();
  entry.activeSubscriptionController?.abort();
  entry.streamController = null;
  entry.activeSubscriptionController = null;

  patchState(key, (state) => ({
    ...state,
    isLoading: false,
    connected: false,
  }));

  const response = await fetch(`/api/tasks/${taskId}/plan/generations/stop${workBlockQuery(workBlockId)}`, {
    method: "POST",
    headers: buildAccessKeyHeaders(),
  });
  handleUnauthorizedResponse(response);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error((errorBody as { error?: string }).error ?? `Failed to stop generation (${response.status})`);
  }
}

export function useTaskPlanGenerationSession(taskId?: string, workBlockIdOrOptions?: string | null | { hydrate?: boolean }, maybeOptions?: { hydrate?: boolean }) {
  const workBlockId = typeof workBlockIdOrOptions === "string" ? workBlockIdOrOptions : null;
  const options = typeof workBlockIdOrOptions === "object" ? workBlockIdOrOptions : maybeOptions;
  const key = taskId ? sessionKey(taskId, workBlockId) : null;
  const subscribe = (onStoreChange: () => void) => {
    if (!key) {
      return () => undefined;
    }
    const entry = getEntry(key);
    entry.listeners.add(onStoreChange);
    return () => {
      entry.listeners.delete(onStoreChange);
    };
  };

  const getSnapshot = () => key ? getEntry(key).state : createIdleState("");

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!taskId || options?.hydrate === false) {
      return;
    }
    void hydrateTaskPlanGenerationSession(taskId, workBlockId);
  }, [options?.hydrate, taskId, workBlockId]);

  return state;
}
