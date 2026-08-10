"use client";

import { useEffect, useSyncExternalStore } from "react";
import type {
  GeneratePlanErrorCode,
  GeneratePlanStatusPhase,
  TaskPlanReadModel,
} from "@chrona/contracts";
import { getByPath, type StateStore } from "@json-render/core";
import { apiJson } from "@shared/http";

export type TaskPlanSessionState = {
  taskId: string;
  generationId: string | null;
  headStateVersion: number | null;
  sessionStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  result: TaskPlanReadModel | null;
  isLoading: boolean;
  error: string | null;
  errorCode: GeneratePlanErrorCode | null;
  phase: GeneratePlanStatusPhase | "idle" | "connecting" | "done" | "error";
  statusMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  connected: boolean;
  hydrated: boolean;
};

type SessionEntry = {
  state: TaskPlanSessionState;
  listeners: Set<() => void>;
};

function sessionKey(taskId: string, workBlockId?: string | null) {
  return workBlockId ? `${taskId}:${workBlockId}` : taskId;
}

function createIdleState(taskId: string): TaskPlanSessionState {
  return {
    taskId,
    generationId: null,
    headStateVersion: null,
    sessionStatus: "idle",
    result: null,
    isLoading: false,
    error: null,
    errorCode: null,
    phase: "idle",
    statusMessage: null,
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


type StateStoreBinding = {
  store: StateStore;
  unsubscribe: () => void;
};

const storeBindingsByKey = new Map<string, StateStoreBinding>();

/**
 * Bind a task-plan session to a workspace `StateStore`. The session store
 * mirrors durable `/plan/*` state paths into reducer-driven session state and
 * returns an unsubscribe function. The workspace SSE is the single source of
 * generation progress; this store never opens a second event stream.
 */
export function bindTaskPlanSessionToStateStore(
  taskId: string,
  workBlockId: string | null | undefined,
  store: StateStore,
): () => void {
  const key = sessionKey(taskId, workBlockId ?? null);
  const existing = storeBindingsByKey.get(key);
  existing?.unsubscribe();
  const listener = () => applyStateSnapshotToSession(key, store.getSnapshot());
  const unsubscribe = store.subscribe(listener);
  listener();
  const binding: StateStoreBinding = { store, unsubscribe };
  storeBindingsByKey.set(key, binding);
  return () => {
    if (storeBindingsByKey.get(key) === binding) {
      binding.unsubscribe();
      storeBindingsByKey.delete(key);
    }
  };
}

type AiPlanGenerationStatus = "accepted" | "generating" | "idle" | "waiting_acceptance";

function applyStateSnapshotToSession(key: string, snapshot: Record<string, unknown>) {
  const get = (path: string): unknown => path in snapshot ? snapshot[path] : getByPath(snapshot, path);
  const planStatus = get("/plan/status") as AiPlanGenerationStatus | null | undefined;
  const generationStatus = get("/plan/generation/status") as TaskPlanSessionState["sessionStatus"] | null | undefined;
  const generationId = get("/plan/generation/id") as string | null | undefined;
  const headStateVersion = get("/plan/generation/head-state-version") as number | null | undefined;
  const phase = get("/plan/generation/phase") as TaskPlanSessionState["phase"] | null | undefined;
  const statusMessage = get("/plan/generation/statusMessage") as string | null | undefined;
  const errorMessage = get("/plan/generation/error/message") as string | null | undefined;
  const errorCode = get("/plan/generation/error/code") as GeneratePlanErrorCode | null | undefined;

  patchState(key, (state) => {
    const sessionStatus = planStatus === "generating"
      ? "running"
      : planStatus === "accepted"
        ? "completed"
        : generationStatus ?? state.sessionStatus;
    return {
      ...state,
      generationId: generationId === undefined ? state.generationId : generationId,
      headStateVersion: headStateVersion === undefined ? state.headStateVersion : headStateVersion,
      sessionStatus,
      isLoading: sessionStatus === "running",
      phase: phase == null
        ? (sessionStatus === "completed" ? "done" : sessionStatus === "failed" ? "error" : state.phase)
        : phase,
      statusMessage: statusMessage === undefined ? state.statusMessage : statusMessage,
      error: errorMessage === undefined ? state.error : errorMessage,
      errorCode: errorCode === undefined ? state.errorCode : errorCode,
      connected: sessionStatus === "running",
      hydrated: true,
    };
  });
}


export async function startTaskPlanGenerationSession(input: {
  taskId: string;
  workBlockId?: string | null;
  forceRefresh?: boolean;
  userInstruction?: string | null;
  selectedNodeId?: string | null;
  idempotencyKey: string;
}) {
  const { taskId, workBlockId = null, forceRefresh = true, idempotencyKey } = input;
  const key = sessionKey(taskId, workBlockId);
  const userInstruction = input.userInstruction?.trim() || null;

  patchState(key, (state) => ({
    ...createIdleState(key),
    generationId: state.generationId,
    headStateVersion: state.headStateVersion,
    sessionStatus: "running",
    isLoading: true,
    phase: "connecting",
    connected: true,
    hydrated: true,
    startedAt: state.startedAt,
  }));

  try {
    const generation = await apiJson<{ generationId: string }>(`/api/tasks/${taskId}/plan/generations`, {
      method: "POST",
      body: JSON.stringify({
        forceRefresh,
        idempotencyKey,
        userInstruction,
        workBlockId,
        selectedNodeId: input.selectedNodeId ?? null,
      }),
    });
    patchState(key, (state) => ({ ...state, generationId: generation.generationId }));
  } catch (error) {
    patchState(key, (state) => ({
      ...state,
      sessionStatus: "failed",
      isLoading: false,
      phase: "error",
      connected: false,
      error: error instanceof Error ? error.message : "Failed to generate task plan",
    }));
    throw error;
  }
}

export async function stopTaskPlanGenerationSession(taskId: string, workBlockId?: string | null) {
  const key = sessionKey(taskId, workBlockId);

  patchState(key, (state) => ({
    ...state,
    sessionStatus: "cancelled",
    isLoading: false,
    phase: "idle",
    connected: false,
  }));

  const query = workBlockId ? `?workBlockId=${encodeURIComponent(workBlockId)}` : "";
  try {
    await apiJson(`/api/tasks/${taskId}/plan/generations/stop${query}`, {
      method: "POST",
    });
  } catch (error) {
    patchState(key, (state) => ({
      ...state,
      sessionStatus: "running",
      isLoading: true,
      phase: "streaming",
      connected: true,
      error: error instanceof Error ? error.message : "Failed to stop generation",
    }));
    throw error;
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
    if (!key || options?.hydrate === false) {
      return;
    }
    patchState(key, (state) => state.hydrated ? state : { ...state, hydrated: true });
  }, [key, options?.hydrate]);

  return state;
}
