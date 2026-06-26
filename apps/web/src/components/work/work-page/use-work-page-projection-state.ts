"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import { appendTaskPrimaryNodeAction } from "@/components/tasks/plan/task-action-node-action";
import { api } from "@/lib/rpc-client";
import { useAppRouter } from "@/lib/router";
import { createLogger } from "@/lib/logger";

import type { WorkCopy, WorkPageData } from "./work-page-types";

const logger = createLogger("web.work-page.projection-state");



function normalizeWorkPageData(data: WorkPageData): WorkPageData {
  const steps = Array.isArray(data.taskPlan.steps) ? data.taskPlan.steps : [];
  const nodes = Array.isArray(data.taskPlan.nodes) ? data.taskPlan.nodes : steps;
  const edges = Array.isArray(data.taskPlan.edges) ? data.taskPlan.edges : [];
  const analytics = data.taskPlan.analytics;

  const taskPlan = appendTaskPrimaryNodeAction(data, {
    ...data.taskPlan,
    state: data.taskPlan.state,
    nodes,
    edges,
    steps: steps.length > 0 ? steps : nodes,
    analytics: {
      entryNodeIds: analytics.entryNodeIds,
      terminalNodeIds: analytics.terminalNodeIds,
      activeNodeIds: analytics.activeNodeIds,
      reachableFromActiveIds: analytics.reachableFromActiveIds,
      criticalPathNodeIds: analytics.criticalPathNodeIds,
      attentionNodeIds: analytics.attentionNodeIds,
      blockedNodeIds: analytics.blockedNodeIds,
      rankByNodeId: analytics.rankByNodeId,
      laneByNodeId: analytics.laneByNodeId,
      upstreamByNodeId: analytics.upstreamByNodeId,
      downstreamByNodeId: analytics.downstreamByNodeId,
    },
  });
  const normalizedTaskPlan = taskPlan ?? data.taskPlan;

  return {
    ...data,
    composerValue: data.composerValue,
    taskPlan: normalizedTaskPlan,
  };
}

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
  const normalizedInitialData = normalizeWorkPageData(initialData);
  const router = useAppRouter();
  const [data, setData] = useState<WorkPageData>(normalizedInitialData);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const refreshEpochRef = useRef(0);
  const composerValueRef = useRef(normalizedInitialData.composerValue);

  useEffect(() => {
    composerValueRef.current = data.composerValue;
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

        const next = normalizeWorkPageData((await response.json()) as unknown as WorkPageData);

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
        if (event === "task_projection_updated" || event === "task_workspace_updated") {
          void refresh({ silent: true });
        }
      },
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        logger.warn("event_stream.closed", { taskId: data.taskShell.id, error });
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
