"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduledItem, ScheduleAiPlanGenerationStatus } from "@/components/schedule/schedule-page-types";
import type { TaskPlanGraph, TaskPlanGraphResponse } from "@/modules/ai/types";

export type SavedTaskPlan = {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  revision?: number;
  summary?: string | null;
  updatedAt: string;
  plan?: TaskPlanGraph;
};

type TaskPlanStateResponse = {
  taskId: string;
  aiPlanGenerationStatus: ScheduleAiPlanGenerationStatus;
  savedAiPlan: SavedTaskPlan | null;
};

function savedPlanKey(saved: SavedTaskPlan | null) {
  return saved ? `${saved.id}:${saved.status}:${saved.revision ?? 0}:${saved.updatedAt}` : null;
}

function acceptedResponseFromSavedPlan(saved: SavedTaskPlan | null): TaskPlanGraphResponse | null {
  if (!saved || saved.status !== "accepted" || !saved.plan) {
    return null;
  }

  return {
    source: "saved",
    planGraph: saved.plan,
    savedPlan: {
      id: saved.id,
      status: saved.status,
      prompt: saved.prompt,
      revision: saved.revision ?? 0,
      summary: saved.summary ?? null,
      updatedAt: saved.updatedAt,
    },
  };
}

function acceptedResponseFromGeneratedResult(result: TaskPlanGraphResponse): TaskPlanGraphResponse {
  return {
    ...result,
    source: "saved",
    savedPlan: result.savedPlan
      ? {
          ...result.savedPlan,
          status: "accepted",
        }
      : result.savedPlan,
    planGraph: result.planGraph
      ? {
          ...result.planGraph,
          status: "accepted",
        }
      : result.planGraph,
  };
}

export function useSelectedBlockPlanState({
  item,
  onMutatedAction,
}: {
  item: ScheduledItem;
  onMutatedAction: () => Promise<void>;
}) {
  const [displayedSavedPlan, setDisplayedSavedPlan] = useState<SavedTaskPlan | null>(item.savedAiPlan ?? null);
  const [generationStatus, setGenerationStatus] = useState(item.aiPlanGenerationStatus ?? "idle");
  const [acceptedPlan, setAcceptedPlan] = useState<TaskPlanGraphResponse | null>(() => acceptedResponseFromSavedPlan(item.savedAiPlan ?? null));
  const [isApplying, setIsApplying] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const lastDisplayedSavedPlanKeyRef = useRef<string | null>(savedPlanKey(item.savedAiPlan ?? null));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const newTaskProbeCountRef = useRef(0);
  const transientIdleWhileGeneratingCountRef = useRef(0);
  const generationStatusRef = useRef<ScheduleAiPlanGenerationStatus>(item.aiPlanGenerationStatus ?? "idle");

  const applyPlanStateSnapshot = useCallback((snapshot: {
    savedAiPlan: SavedTaskPlan | null;
    aiPlanGenerationStatus: ScheduleAiPlanGenerationStatus;
  }) => {
    const next = snapshot.savedAiPlan;
    const nextKey = savedPlanKey(next);
    const nextStatus = snapshot.aiPlanGenerationStatus;
    const currentPlanKey = lastDisplayedSavedPlanKeyRef.current;
    const currentGenerationStatus = generationStatusRef.current;
    const shouldTreatAsTransientIdle = !currentPlanKey
      && !next
      && nextStatus === "idle"
      && currentGenerationStatus === "generating";

    if (nextStatus !== currentGenerationStatus) {
      generationStatusRef.current = nextStatus;
    }

    if (shouldTreatAsTransientIdle && transientIdleWhileGeneratingCountRef.current < 4) {
      transientIdleWhileGeneratingCountRef.current += 1;
      return;
    }

    transientIdleWhileGeneratingCountRef.current = 0;
    setGenerationStatus((current) => (current === nextStatus ? current : nextStatus));

    if (currentPlanKey === nextKey) {
      return;
    }

    lastDisplayedSavedPlanKeyRef.current = nextKey;
    setDisplayedSavedPlan(next);

    const accepted = acceptedResponseFromSavedPlan(next);
    if (accepted) {
      setAcceptedPlan((current) => {
        if (
          current?.savedPlan?.id === accepted.savedPlan?.id
          && current?.savedPlan?.status === accepted.savedPlan?.status
          && current?.savedPlan?.revision === accepted.savedPlan?.revision
          && current?.savedPlan?.updatedAt === accepted.savedPlan?.updatedAt
        ) {
          return current;
        }

        return accepted;
      });
    }
  }, []);

  const fetchPlanState = useCallback(async () => {
    const response = await fetch(`/api/tasks/${item.taskId}/plan-state`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task plan state (${response.status})`);
    }

    const snapshot = await response.json() as TaskPlanStateResponse;
    applyPlanStateSnapshot(snapshot);
    return snapshot;
  }, [applyPlanStateSnapshot, item.taskId]);

  useEffect(() => {
    generationStatusRef.current = item.aiPlanGenerationStatus ?? "idle";
    applyPlanStateSnapshot({
      savedAiPlan: item.savedAiPlan ?? null,
      aiPlanGenerationStatus: item.aiPlanGenerationStatus ?? "idle",
    });
  }, [applyPlanStateSnapshot, item.aiPlanGenerationStatus, item.savedAiPlan]);

  useEffect(() => {
    newTaskProbeCountRef.current = 0;
    setPollCycle(0);
  }, [item.taskId]);

  useEffect(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const status = generationStatusRef.current;
    const hasPlan = Boolean(displayedSavedPlan);
    const shouldPollRunning = status === "generating";
    const shouldProbeJustCreatedTask = status === "idle" && !hasPlan && newTaskProbeCountRef.current < 3;

    if (!shouldPollRunning && !shouldProbeJustCreatedTask) {
      return undefined;
    }

    const delayMs = shouldPollRunning ? 1800 : newTaskProbeCountRef.current === 0 ? 450 : 1400;
    refreshTimerRef.current = setTimeout(() => {
      if (refreshInFlightRef.current) {
        return;
      }

      if (shouldProbeJustCreatedTask) {
        newTaskProbeCountRef.current += 1;
      }

      refreshInFlightRef.current = true;
      void fetchPlanState().catch((error) => {
        console.error("[TaskPlan] Poll failed:", error);
      }).finally(() => {
        refreshInFlightRef.current = false;
        setPollCycle((current) => current + 1);
      });
    }, delayMs);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [displayedSavedPlan, fetchPlanState, generationStatus, pollCycle]);

  const handlePlanLoaded = useCallback((saved: SavedTaskPlan | null) => {
    const nextKey = savedPlanKey(saved);
    if (lastDisplayedSavedPlanKeyRef.current !== nextKey) {
      lastDisplayedSavedPlanKeyRef.current = nextKey;
      setDisplayedSavedPlan(saved);
      const nextStatus = saved?.status === "accepted" ? "accepted" : saved ? "waiting_acceptance" : "idle";
      generationStatusRef.current = nextStatus;
      setGenerationStatus(nextStatus);
    }

    const accepted = saved ? acceptedResponseFromSavedPlan(saved) : null;
    if (!accepted) {
      return;
    }

    setAcceptedPlan((current) => {
      if (
        current?.savedPlan?.id === accepted.savedPlan?.id
        && current?.savedPlan?.status === accepted.savedPlan?.status
        && current?.savedPlan?.revision === accepted.savedPlan?.revision
        && current?.savedPlan?.updatedAt === accepted.savedPlan?.updatedAt
      ) {
        return current;
      }

      return accepted;
    });
  }, []);

  const handleApplyPlan = useCallback(async (result: TaskPlanGraphResponse) => {
    if (!result.savedPlan?.id) return;
    setIsApplying(true);
    try {
      const res = await fetch("/api/ai/task-plan/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: item.taskId,
          planId: result.savedPlan.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to accept plan");

      const accepted = acceptedResponseFromGeneratedResult(result);
      setAcceptedPlan(accepted);
      const acceptedSavedPlan: SavedTaskPlan = {
        id: accepted.savedPlan!.id,
        status: "accepted",
        prompt: accepted.savedPlan!.prompt,
        revision: accepted.savedPlan!.revision,
        summary: accepted.savedPlan!.summary,
        updatedAt: accepted.savedPlan!.updatedAt,
        plan: accepted.planGraph,
      };
      setDisplayedSavedPlan(acceptedSavedPlan);
      generationStatusRef.current = "accepted";
      setGenerationStatus("accepted");
      lastDisplayedSavedPlanKeyRef.current = savedPlanKey(acceptedSavedPlan);

      await onMutatedAction();
    } catch (err) {
      console.error("[TaskPlan] Accept failed:", err);
    } finally {
      setIsApplying(false);
    }
  }, [item.taskId, onMutatedAction]);

  return {
    displayedSavedPlan,
    generationStatus,
    acceptedPlan,
    isApplying,
    handlePlanLoaded,
    handleApplyPlan,
  };
}
