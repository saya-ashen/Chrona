"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import { api } from "@/lib/rpc-client";
import { useAppRouter } from "@/lib/router";
import type { WorkCopy, WorkPageData } from "./work-page-types";

type WorkPageTaskPlan = WorkPageData["taskPlan"];

function buildTaskPlanAnalytics(
  nodes: WorkPageTaskPlan["nodes"],
  edges: WorkPageTaskPlan["edges"],
): WorkPageTaskPlan["analytics"] {
  const activeNodeIds = nodes.filter((node) => node.status === "active" || node.status === "in_progress").map((node) => node.id);
  const attentionNodeIds = nodes
    .filter((node) => node.status === "waiting" || node.status === "waiting_for_user" || node.status === "waiting_for_approval")
    .map((node) => node.id);
  const blockedNodeIds = nodes.filter((node) => node.status === "blocked").map((node) => node.id);
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    const from = edge.from ?? edge.fromNodeId;
    const to = edge.to ?? edge.toNodeId;
    if (!from || !to) continue;
    outgoing.get(from)?.push(to);
    incoming.get(to)?.push(from);
  }

  return {
    entryNodeIds: nodes.filter((node) => (incoming.get(node.id)?.length ?? 0) === 0).map((node) => node.id),
    terminalNodeIds: nodes.filter((node) => (outgoing.get(node.id)?.length ?? 0) === 0).map((node) => node.id),
    activeNodeIds,
    reachableFromActiveIds: activeNodeIds.length > 0 ? activeNodeIds : [],
    criticalPathNodeIds: nodes.map((node) => node.id),
    attentionNodeIds,
    blockedNodeIds,
    rankByNodeId: Object.fromEntries(nodes.map((node, index) => [node.id, index])),
    laneByNodeId: Object.fromEntries(nodes.map((node) => [node.id, 0])),
    upstreamByNodeId: Object.fromEntries(nodes.map((node) => [node.id, incoming.get(node.id) ?? []])),
    downstreamByNodeId: Object.fromEntries(nodes.map((node) => [node.id, outgoing.get(node.id) ?? []])),
  };
}

function normalizeWorkPageData(data: WorkPageData): WorkPageData {
  const steps = Array.isArray(data.taskPlan?.steps) ? data.taskPlan.steps : [];
  const nodes = Array.isArray(data.taskPlan?.nodes) ? data.taskPlan.nodes : steps;
  const edges = Array.isArray(data.taskPlan?.edges) ? data.taskPlan.edges : [];
  const analytics = data.taskPlan?.analytics ?? buildTaskPlanAnalytics(nodes, edges);

  return {
    ...data,
    composerValue: data.composerValue ?? "",
    taskPlan: {
      ...data.taskPlan,
      state: data.taskPlan?.state ?? (nodes.length > 0 ? "ready" : "empty"),
      nodes,
      edges,
      steps: steps.length > 0 ? steps : nodes,
      analytics: {
        entryNodeIds: analytics.entryNodeIds ?? [],
        terminalNodeIds: analytics.terminalNodeIds ?? [],
        activeNodeIds: analytics.activeNodeIds ?? [],
        reachableFromActiveIds: analytics.reachableFromActiveIds ?? [],
        criticalPathNodeIds: analytics.criticalPathNodeIds ?? [],
        attentionNodeIds: analytics.attentionNodeIds ?? [],
        blockedNodeIds: analytics.blockedNodeIds ?? [],
        rankByNodeId: analytics.rankByNodeId ?? {},
        laneByNodeId: analytics.laneByNodeId ?? {},
        upstreamByNodeId: analytics.upstreamByNodeId ?? {},
        downstreamByNodeId: analytics.downstreamByNodeId ?? {},
      },
    },
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
