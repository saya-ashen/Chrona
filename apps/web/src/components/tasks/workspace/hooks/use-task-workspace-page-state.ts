import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import { fetchTaskWorkspacePage, taskWorkspaceQueryKeys } from "../model/task-workspace-query";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";

type RefreshOptions = {
  silent?: boolean;
};

type RefreshWorkspace = (options?: RefreshOptions) => Promise<void>;

export type TaskWorkspaceSseEvent = {
  type: string;
  sequence?: number;
  commandId?: string;
  commandType?: string;
  message?: string;
  eventKind?: string;
};

const SSE_STALE_TIMEOUT_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_STALE_TIMEOUT_MS ?? 45000);
const SSE_RECONNECT_BASE_DELAY_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_RECONNECT_BASE_DELAY_MS ?? 5000);
const SSE_RECONNECT_MAX_DELAY_MS = Number(import.meta.env.VITE_TASK_WORKSPACE_SSE_RECONNECT_MAX_DELAY_MS ?? 60000);
const FALLBACK_REFRESH_INTERVAL_MS = Number(
  import.meta.env.VITE_TASK_WORKSPACE_FALLBACK_REFRESH_INTERVAL_MS ??
    import.meta.env.VITE_TASK_WORKSPACE_POLL_INTERVAL_MS ??
    30000,
);
const NON_REFRESH_WORKSPACE_EVENTS = new Set(["ready", "heartbeat"]);

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

function useTaskWorkspaceEventStream(
  taskId: string,
  refreshWorkspace: RefreshWorkspace,
  onWorkspaceEvent: (event: TaskWorkspaceSseEvent) => void,
) {
  const [streamRetryKey, setStreamRetryKey] = useState(0);
  const [isStreamHealthy, setIsStreamHealthy] = useState(true);
  const staleTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

    void fetchJsonEventSource(`/api/work/${taskId}/events`, {
      method: "GET",
      signal: abortController.signal,
      headers: { Accept: "text/event-stream" },
      onEvent({ event, data }) {
        markStreamHealthy();
        if (!NON_REFRESH_WORKSPACE_EVENTS.has(event)) {
          onWorkspaceEvent({ type: event, ...data });
          void refreshWorkspace({ silent: true });
        }
      },
    }).then(() => {
      if (shouldReconnect && !abortController.signal.aborted) {
        scheduleStreamReconnect();
      }
    }).catch((error) => {
      if (shouldReconnect && !abortController.signal.aborted) {
        console.warn("Task workspace event stream closed", error);
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
  }, [clearStaleTimer, markStreamHealthy, onWorkspaceEvent, refreshWorkspace, scheduleStreamReconnect, streamRetryKey, taskId]);

  return isStreamHealthy;
}

export function useTaskWorkspacePageState(initialData: TaskPageData) {
  const queryClient = useQueryClient();
  const taskId = initialData.task.id;
  const [workspaceEvents, setWorkspaceEvents] = useState<TaskWorkspaceSseEvent[]>([]);
  const pageQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.page(taskId),
    queryFn: () => fetchTaskWorkspacePage(taskId),
    initialData,
  });
  const pageData = pageQuery.data;

  const refreshWorkspace = useCallback(async (_options: RefreshOptions = {}) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.page(taskId) }),
      queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.planState(taskId) }),
      queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.currentExecution(taskId) }),
    ]);
  }, [queryClient, taskId]);

  const setTask = useCallback((value: React.SetStateAction<TaskData>) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.page(taskId), (current: TaskPageData | undefined) => {
      const previous = current ?? initialData;
      const nextTask = typeof value === "function"
        ? (value as (prevState: TaskData) => TaskData)(previous.task)
        : value;
      return { ...previous, task: nextTask } satisfies TaskPageData;
    });
  }, [initialData, queryClient, taskId]);
  const handleWorkspaceEvent = useCallback((event: TaskWorkspaceSseEvent) => {
    setWorkspaceEvents((current) => [...current.slice(-199), event]);
  }, []);
  useTaskWorkspaceEventStream(taskId, refreshWorkspace, handleWorkspaceEvent);

  useEffect(() => {
    if (!isWorkspaceActive(pageData)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshWorkspace({ silent: true });
    }, FALLBACK_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [pageData, refreshWorkspace]);

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
    setTask,
    refreshWorkspace,
    isRefreshing: pageQuery.isFetching,
    workspaceEvents,
  };
}
