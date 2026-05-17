"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import { api } from "@/lib/rpc-client";
import { useAppRouter } from "@/lib/router";
import type { WorkCopy, WorkPageData } from "./work-page-types";

type RefreshOptions = {
  silent?: boolean;
  epoch?: number;
};

function isProjectionActive(data: WorkPageData) {
  const planExecutionActive = data.planExecution
    ? ["running", "started", "waiting_for_user", "waiting_for_approval", "blocked"].includes(
        data.planExecution.status,
      )
    : false;

  const runActive =
    data.currentRun && ["Running", "WaitingForInput", "WaitingForApproval"].includes(data.currentRun.status);

  return planExecutionActive || runActive;
}

export function useWorkPageProjectionState(initialData: WorkPageData, copy: WorkCopy, isPending: boolean) {
  const normalizedInitialData = {
    ...initialData,
    composerValue: initialData.composerValue ?? "",
  };
  const router = useAppRouter();
  const [data, setData] = useState<WorkPageData>(normalizedInitialData);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const refreshEpochRef = useRef(0);
  const composerValueRef = useRef(normalizedInitialData.composerValue);

  useEffect(() => {
    composerValueRef.current = data.composerValue ?? "";
  }, [data.composerValue]);

  const refresh = useCallback(
    async ({ silent = false, epoch = refreshEpochRef.current }: RefreshOptions = {}) => {
      try {
        const response = await api.work[":taskId"].$get({
          param: { taskId: data.taskShell.id },
        });

        if (!response.ok) {
          throw new Error(copy.actionFailed);
        }

        const next = (await response.json()) as unknown as WorkPageData;

        if (epoch !== refreshEpochRef.current) {
          return true;
        }

        startTransition(() =>
          setData(() => ({
            ...next,
            composerValue: composerValueRef.current,
          })),
        );
        return true;
      } catch (error) {
        if (silent) {
          return false;
        }

        router.refresh();
        throw error instanceof Error ? error : new Error(copy.actionFailed);
      }
    },
    [copy.actionFailed, data.taskShell.id, router],
  );

  useEffect(() => {
    if (isPending || !isProjectionActive(data)) {
      return;
    }

    const intervalMs = Number(import.meta.env.VITE_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data, isPending, refresh]);

  useEffect(() => {
    const abortController = new AbortController();

    void fetchJsonEventSource(`/api/work/${data.taskShell.id}/events`, {
      method: "GET",
      signal: abortController.signal,
      headers: {
        Accept: "text/event-stream",
      },
      onEvent({ event }) {
        if (event === "task_projection_updated") {
          void refresh({ silent: true });
        }
      },
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        console.warn("Work page event stream closed", error);
      }
    });

    return () => abortController.abort();
  }, [data.taskShell.id, refresh]);

  const resetComposer = useCallback(() => {
    composerValueRef.current = "";
    setData((current) => ({ ...current, composerValue: "" }));
    setComposerResetKey((value) => value + 1);
  }, []);

  const beginRefreshEpoch = useCallback(() => ++refreshEpochRef.current, []);

  return {
    data,
    setData,
    composerResetKey,
    refresh,
    resetComposer,
    beginRefreshEpoch,
  };
}
