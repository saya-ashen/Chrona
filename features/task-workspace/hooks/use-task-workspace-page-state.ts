import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applySpecPatch,
  createStateStore,
  getByPath,
  type JsonPatch,
  type Spec,
  type StateStore,
} from "@json-render/core";
import { fetchJsonEventSource, createLogger } from "@shared/http";
import {
  commandCenterQueryKeys,
  fetchTaskCommandCenter,
  fetchTaskWorkspacePage,
  taskWorkspaceQueryKeys,
} from "../model/task-workspace-query";
import type { UiDocument } from "@chrona/ui-protocol";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";
import { bindTaskPlanSessionToStateStore } from "./task-plan-generation-session-store";

const logger = createLogger("web.task-workspace.page-state");
type RefreshOptions = {
  silent?: boolean;
};

export type TaskWorkspaceSseEvent = {
  type: string;
  sequence?: number;
  commandId?: string;
  commandType?: string;
  message?: string;
  eventKind?: string;
  [key: string]: unknown;
};

type WorkspaceSpecPatch = {
  op: JsonPatch["op"];
  path: string;
  value?: unknown;
  from?: string;
};

type HeaderSpecPatchEvent = {
  type: "spec.patch";
  document: "header";
  patches: WorkspaceSpecPatch[];
};

const SSE_STALE_TIMEOUT_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_STALE_TIMEOUT_MS ?? 45000);
const SSE_RECONNECT_BASE_DELAY_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_RECONNECT_BASE_DELAY_MS ?? 5000);
const SSE_RECONNECT_MAX_DELAY_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_RECONNECT_MAX_DELAY_MS ?? 60000);
const FALLBACK_REFRESH_INTERVAL_MS = Number(
  import.meta.env.VITE_TASK_WORKSPACE_FALLBACK_REFRESH_INTERVAL_MS ??
    import.meta.env.VITE_TASK_WORKSPACE_POLL_INTERVAL_MS ??
    30000,
);
// Events that the workspace stream emits for protocol bookkeeping only
// (no UI side effect, no page refresh). `spec.patch` is intentionally
// excluded so the dispatcher can deliver it to the patch handler that
// applies the JSON-Patch onto the live header spec.
const STREAM_NOOP_EVENTS = new Set(["ready", "heartbeat"]);
const PAGE_REFRESH_WORKSPACE_EVENTS = new Set([
  "task_projection_updated",
  "task_workspace_updated",
  "task.updated",
  "task.deleted",
  "schedule.updated",
  "proposal.updated",
  "execution.state.updated",
  "execution.result",
  "checkpoint.result",
]);

function shouldRefreshWorkspacePageForEvent(event: TaskWorkspaceSseEvent) {
  if (STREAM_NOOP_EVENTS.has(event.type)) return false;
  if (event.type === "spec.patch") return false;
  if (event.type === "task_workspace_updated" && event.reason === "plan_generation.completed") return false;
  if (PAGE_REFRESH_WORKSPACE_EVENTS.has(event.type)) return true;

  return !event.type.startsWith("plan.")
    && !event.type.startsWith("execution.")
    && !event.type.startsWith("checkpoint.")
    && !event.type.startsWith("command.");
}

function isWorkspaceActive(pageData: TaskPageData) {
  const executionState = pageData.task.executionSummary?.executionState;
  const taskStatus = pageData.task.status;
  const runStatus = pageData.latestRunSummary?.status;

  return [
    executionState,
    taskStatus,
    runStatus,
  ].some((status) => status
    ? [
        "running",
        "waiting_for_user",
        "waiting_for_approval",
        "blocked",
        "degraded",
        "Running",
        "WaitingForInput",
        "WaitingForApproval",
        "Blocked",
      ].includes(status)
    : false);
}

function isHeaderSpecPatchEvent(event: TaskWorkspaceSseEvent): event is HeaderSpecPatchEvent {
  return event.type === "spec.patch"
    && (event as { document?: unknown }).document === "header"
    && Array.isArray((event as { patches?: unknown }).patches);
}

type StateSnapshotEnvelope = { type: "state.snapshot"; state: Record<string, unknown> };
type StateUpdateEnvelope = { type: "state.update"; updates: Record<string, unknown> };

function isWorkspaceStateEvent(event: TaskWorkspaceSseEvent): event is TaskWorkspaceSseEvent & (StateSnapshotEnvelope | StateUpdateEnvelope) {
  return event.type === "state.snapshot" || event.type === "state.update";
}

/**
 * Server snapshot contract is a flat `Record<jsonPointerPath, value>` map.
 * We treat nested objects in the payload as opaque leaf values — the spec
 * is free to push structured data under a single path (e.g. for `$state`
 * bindings that consume an object) and we never recurse into them.
 */
function isPointerPathKey(key: string): boolean {
  return key.startsWith("/");
}

function applyStateEventToStore(store: StateStore, event: StateSnapshotEnvelope | StateUpdateEnvelope) {
  if (event.type === "state.snapshot") {
    const newPaths = new Set<string>(Object.keys(event.state).filter(isPointerPathKey));
    // Enumerate the previous JSON Pointer paths the store currently holds.
    // `getSnapshot()` returns a nested tree after the first `set`, so we
    // walk it to recover the original flat paths.
    const previousPaths = collectPointerPaths(store.getSnapshot(), "");
    const updates: Record<string, unknown> = {};
    for (const path of previousPaths) {
      if (!newPaths.has(path)) updates[path] = null;
    }
    for (const path of newPaths) {
      if (getByPath(store.getSnapshot(), path) !== event.state[path]) {
        updates[path] = event.state[path];
      }
    }
    if (Object.keys(updates).length > 0) {
      store.update(updates);
    }
    return;
  }
  // state.update
  store.update(event.updates);
}

/**
 * Walk a state tree and return every JSON Pointer path whose value is a
 * non-object (i.e. a leaf). Mirrors the contract that `createStateStore`
 * builds via `immutableSetByPath` so we can recover the original flat
 * path keys from the nested snapshot.
 */
function collectPointerPaths(node: unknown, prefix: string): string[] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return prefix === "" ? [] : [prefix];
  }
  const paths: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = `${prefix}/${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectPointerPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

function useTaskWorkspaceEventStream(
  taskId: string,
  refreshQueries: () => Promise<void>,
  refreshPersistedActivity: () => Promise<void>,
  onWorkspaceEvent: (event: TaskWorkspaceSseEvent) => void,
  applyStateEvent: (event: TaskWorkspaceSseEvent) => void,
  workBlockId?: string | null,
) {
  const [streamRetryKey, setStreamRetryKey] = useState(0);
  const [isStreamHealthy, setIsStreamHealthy] = useState(true);
  const staleTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasOpenedStreamRef = useRef(false);

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current === null) return;
    window.clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
  }, []);

  const scheduleStreamReconnect = useCallback(() => {
    setIsStreamHealthy(false);
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
    }

    const delayMs = Math.min(
      SSE_RECONNECT_BASE_DELAY_MS * 2 ** streamRetryKey,
      SSE_RECONNECT_MAX_DELAY_MS,
    );
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setStreamRetryKey((current) => current + 1);
    }, delayMs);
  }, [streamRetryKey]);

  const markStreamHealthy = useCallback(() => {
    setIsStreamHealthy(true);
    clearStaleTimer();
    staleTimerRef.current = window.setTimeout(() => {
      abortControllerRef.current?.abort();
      scheduleStreamReconnect();
    }, SSE_STALE_TIMEOUT_MS);
  }, [clearStaleTimer, scheduleStreamReconnect]);

  useEffect(() => {
    const abortController = new AbortController();
    let shouldReconnect = true;
    abortControllerRef.current = abortController;

    markStreamHealthy();

    const query = workBlockId ? `?workBlockId=${encodeURIComponent(workBlockId)}` : "";
    void fetchJsonEventSource(`/api/work/${taskId}/events${query}`, {
      method: "GET",
      signal: abortController.signal,
      headers: { Accept: "text/event-stream" },
      onEvent({ event, data }) {
        markStreamHealthy();
        if (event === "ready") {
          const isReconnect = hasOpenedStreamRef.current;
          hasOpenedStreamRef.current = true;
          if (isReconnect) {
            void Promise.all([refreshPersistedActivity(), refreshQueries()]);
          } else {
            void refreshPersistedActivity();
          }
          return;
        }
        if (STREAM_NOOP_EVENTS.has(event)) return;
        const envelope = { type: event, ...data } as TaskWorkspaceSseEvent;
        if (isWorkspaceStateEvent(envelope)) {
          applyStateEvent(envelope);
          if (envelope.type === "state.update") {
            void refreshQueries();
          }
          return;
        }
        onWorkspaceEvent(envelope);
        if (shouldRefreshWorkspacePageForEvent(envelope)) {
          void refreshQueries();
        }
      },
    }).then(() => {
      if (shouldReconnect && !abortController.signal.aborted) {
        scheduleStreamReconnect();
      }
    }).catch((error) => {
      if (shouldReconnect && !abortController.signal.aborted) {
        logger.warn("event_stream.closed", { taskId, workBlockId: workBlockId ?? null, error });
        scheduleStreamReconnect();
      }
    });

    return () => {
      shouldReconnect = false;
      abortController.abort();
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      clearStaleTimer();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [applyStateEvent, clearStaleTimer, markStreamHealthy, onWorkspaceEvent, refreshPersistedActivity, refreshQueries, scheduleStreamReconnect, streamRetryKey, taskId, workBlockId]);

  return isStreamHealthy;
}

export function useTaskWorkspacePageState(initialData: TaskPageData) {
  const queryClient = useQueryClient();
  const taskId = initialData.task.id;
  const selectedWorkBlockId = initialData.task.currentWorkBlock?.id ?? null;
  const selectedWorkBlockKey = selectedWorkBlockId ?? "__task__";
  // The header state store is per-occurrence. A fresh occurrence must not
  // inherit the prior occurrence's SSE-applied pointer paths, so it is
  // re-created on the same work-block-key transition that swaps the spec.
  const [headerStore, setHeaderStore] = useState<StateStore>(() => createStateStore({}));
  const previousWorkBlockKeyRef = useRef(selectedWorkBlockKey);
  const initialDataRef = useRef(initialData);
  // Header spec and header state store are initialized once from the
  // first-paint header payload (sourced from /api/tasks/:taskId/workspace/header
  // via the SSR loader). They are NOT re-derived from the headerQuery on
  // every refetch — the only writes to headerSpec are (a) the initial
  // render and (b) `spec.patch` SSE events. Re-syncing on every refetch
  // would clobber local spec patches and any in-flight header state.
  const headerInitial = initialData.header ?? null;
  const [headerSpec, setHeaderSpec] = useState<UiDocument>(() => {
    const doc = headerInitial?.spec;
    if (!doc) throw new Error("Task workspace header spec is missing from header payload.");
    return doc;
  });
  const [workspaceEvents, setWorkspaceEvents] = useState<TaskWorkspaceSseEvent[]>([]);
  const pageQueryKey = useMemo(
    () => taskWorkspaceQueryKeys.page(taskId, selectedWorkBlockId),
    [selectedWorkBlockId, taskId],
  );
  const commandCenterQueryKey = useMemo(
    () => commandCenterQueryKeys.detail(taskId, selectedWorkBlockId),
    [selectedWorkBlockId, taskId],
  );
  const pageQuery = useQuery({
    queryKey: pageQueryKey,
    queryFn: () => fetchTaskWorkspacePage(taskId, selectedWorkBlockId),
    initialData,
  });
  const commandCenterQuery = useQuery({
    queryKey: commandCenterQueryKey,
    queryFn: () => fetchTaskCommandCenter(taskId, selectedWorkBlockId),
    initialData: initialData.commandCenter ?? undefined,
  });
  const pageData = pageQuery.data;
  // The runtime source of truth for command-center documents (now / output
  // / trail) is the dedicated query — independent cache key, independent
  // invalidation. First-paint value still flows through
  // `initialData.commandCenter` for SSR consistency.
  const commandCenter = commandCenterQuery.data ?? initialData.commandCenter ?? null;

  useEffect(() => {
    return bindTaskPlanSessionToStateStore(taskId, selectedWorkBlockId, headerStore);
  }, [headerStore, selectedWorkBlockId, taskId]);

  useEffect(() => {
    if (initialDataRef.current === initialData) return;
    initialDataRef.current = initialData;
    queryClient.setQueryData(pageQueryKey, initialData);
  }, [initialData, pageQueryKey, queryClient]);
  const refreshWorkspace = useCallback(async (_options: RefreshOptions = {}) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pageQueryKey }),
      queryClient.invalidateQueries({ queryKey: commandCenterQueryKey }),
      queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.planState(taskId, selectedWorkBlockId) }),
      queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.currentExecution(taskId, selectedWorkBlockId) }),
    ]);
  }, [commandCenterQueryKey, pageQueryKey, queryClient, selectedWorkBlockId, taskId]);
  const refreshPersistedActivity = useCallback(async () => {
    await commandCenterQuery.refetch();
  }, [commandCenterQuery.refetch]);

  const setTask = useCallback((value: React.SetStateAction<TaskData>) => {
    queryClient.setQueryData(pageQueryKey, (current: TaskPageData | undefined) => {
      const previous = current ?? initialData;
      const nextTask = typeof value === "function"
        ? (value as (prevState: TaskData) => TaskData)(previous.task)
        : value;
      return { ...previous, task: nextTask } satisfies TaskPageData;
    });
  }, [initialData, pageQueryKey, queryClient]);
  const handleWorkspaceEvent = useCallback((event: TaskWorkspaceSseEvent) => {
    if (isHeaderSpecPatchEvent(event)) {
      const patches = event.patches;
      setHeaderSpec((prev) => {
        const next = structuredClone(prev) as unknown as Spec;
        for (const patch of patches) {
          applySpecPatch(next, patch satisfies JsonPatch);
        }
        return next as unknown as UiDocument;
      });
      return;
    }
    setWorkspaceEvents((current) => [...current.slice(-199), event]);
  }, []);
  const applyStateEvent = useCallback((event: TaskWorkspaceSseEvent) => {
    if (!isWorkspaceStateEvent(event)) return;
    applyStateEventToStore(headerStore, event);
  }, [headerStore]);
  const isStreamHealthy = useTaskWorkspaceEventStream(taskId, refreshWorkspace, refreshPersistedActivity, handleWorkspaceEvent, applyStateEvent, selectedWorkBlockId);


  useEffect(() => {
    if (previousWorkBlockKeyRef.current === selectedWorkBlockKey) return;
    previousWorkBlockKeyRef.current = selectedWorkBlockKey;
    setWorkspaceEvents([]);
    // The loader hands us a new `initialData` for the new occurrence. Reset
    // the header spec and clear the header state store so the previous
    // occurrence's locally-patched spec fragments and SSE-applied
    // pointer-paths do not bleed into the new header. Without this the
    // header card keeps showing the prior occurrence's status, action
    // disabled flags, and plan generation session state across the switch.
    const nextHeaderSpec = initialData.header?.spec;
    if (!nextHeaderSpec) {
      throw new Error("Task workspace header spec is missing from header payload.");
    }
    setHeaderSpec(nextHeaderSpec);
    // Re-create the store so the prior occurrence's pointer paths are dropped
    // entirely (the StateStore API exposes `set`/`update` but no key delete).
    setHeaderStore(createStateStore({}));
  }, [initialData, selectedWorkBlockKey]);
  useEffect(() => {
    // Fallback poll is the safety net for an unhealthy SSE stream. When the
    // stream is healthy, server-pushed state.update / spec.patch /
    // task_workspace_updated events keep the workspace in sync; the periodic
    // refresh is wasted bandwidth.
    if (!isWorkspaceActive(pageData) || isStreamHealthy) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshWorkspace({ silent: true });
    }, FALLBACK_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isStreamHealthy, pageData, refreshWorkspace]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshWorkspace({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshWorkspace]);

  return {
    pageData,
    commandCenter,
    setTask,
    refreshWorkspace,
    isRefreshing: pageQuery.isFetching,
    workspaceEvents,
    headerSpec,
    headerStore,
    stateStore: headerStore,
  };
}
