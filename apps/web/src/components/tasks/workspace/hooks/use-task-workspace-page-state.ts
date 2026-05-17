import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import { fetchTaskWorkspacePage, taskWorkspaceQueryKeys } from "../model/task-workspace-query";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";

type RefreshOptions = {
  silent?: boolean;
};

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

export function useTaskWorkspacePageState(initialData: TaskPageData) {
  const queryClient = useQueryClient();
  const taskId = initialData.task.id;
  const pageQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.page(taskId),
    queryFn: () => fetchTaskWorkspacePage(taskId),
    initialData,
  });
  const pageData = pageQuery.data;

  const refreshWorkspace = useCallback(async (_options: RefreshOptions = {}) => {
    await queryClient.invalidateQueries({ queryKey: taskWorkspaceQueryKeys.page(taskId) });
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

  useEffect(() => {
    const abortController = new AbortController();

    void fetchJsonEventSource(`/api/work/${taskId}/events`, {
      method: "GET",
      signal: abortController.signal,
      headers: { Accept: "text/event-stream" },
      onEvent({ event }) {
        if (event === "task_projection_updated") {
          void refreshWorkspace({ silent: true });
        }
      },
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        console.warn("Task workspace event stream closed", error);
      }
    });

    return () => abortController.abort();
  }, [refreshWorkspace, taskId]);

  useEffect(() => {
    if (!isWorkspaceActive(pageData)) {
      return;
    }

    const intervalMs = Number(import.meta.env.VITE_TASK_WORKSPACE_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refreshWorkspace({ silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [pageData, refreshWorkspace]);

  return {
    pageData,
    setTask,
    refreshWorkspace,
    isRefreshing: pageQuery.isFetching,
  };
}
