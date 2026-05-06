"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduledItem, ScheduleAiPlanGenerationStatus } from "@/components/schedule/schedule-page-types";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

/** Subset of TaskPlanReadModel used as the accepted-plan shape in UI state. */
export type SavedTaskPlan = TaskPlanReadModel;

type TaskPlanStateResponse = {
  taskId: string;
  aiPlanGenerationStatus: ScheduleAiPlanGenerationStatus;
  savedPlan: SavedTaskPlan | null;
};

function savedPlanKey(saved: SavedTaskPlan | null) {
  return saved ? `${saved.id}:${saved.status}:${saved.revision}:${saved.updatedAt}` : null;
}

function acceptedResponseFromSavedPlan(saved: SavedTaskPlan | null): TaskPlanReadModel | null {
  if (!saved || saved.status !== "accepted") {
    return null;
  }

  return saved;
}

export function useSelectedBlockPlanState({
  item,
  onMutatedAction,
}: {
  item: ScheduledItem;
  onMutatedAction: () => Promise<void>;
}) {
  const [displayedSavedPlan, setDisplayedSavedPlan] = useState<SavedTaskPlan | null>(item.savedPlan ?? null);
  const [generationStatus, setGenerationStatus] = useState(item.aiPlanGenerationStatus ?? "idle");
  const [acceptedPlan, setAcceptedPlan] = useState<TaskPlanReadModel | null>(() => acceptedResponseFromSavedPlan(item.savedPlan ?? null));
  const [isApplying, setIsApplying] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const lastDisplayedSavedPlanKeyRef = useRef<string | null>(savedPlanKey(item.savedPlan ?? null));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const newTaskProbeCountRef = useRef(0);
  const transientIdleWhileGeneratingCountRef = useRef(0);
  const generationStatusRef = useRef<ScheduleAiPlanGenerationStatus>(item.aiPlanGenerationStatus ?? "idle");

  const applyPlanStateSnapshot = useCallback((snapshot: {
    savedPlan: SavedTaskPlan | null;
    aiPlanGenerationStatus: ScheduleAiPlanGenerationStatus;
  }) => {
    const next = snapshot.savedPlan;
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
          current?.id === accepted.id
          && current?.status === accepted.status
          && current?.revision === accepted.revision
          && current?.updatedAt === accepted.updatedAt
        ) {
          return current;
        }

        return accepted;
      });
    }
  }, []);

  const fetchPlanState = useCallback(async () => {
    const response = await fetch(`/api/tasks/${item.taskId}/plan/state`, {
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
      savedPlan: item.savedPlan ?? null,
      aiPlanGenerationStatus: item.aiPlanGenerationStatus ?? "idle",
    });
  }, [applyPlanStateSnapshot, item.aiPlanGenerationStatus, item.savedPlan]);

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
        current?.id === accepted.id
        && current?.status === accepted.status
        && current?.revision === accepted.revision
        && current?.updatedAt === accepted.updatedAt
      ) {
        return current;
      }

      return accepted;
    });
  }, []);

  const handleApplyPlan = useCallback(async (result: TaskPlanReadModel) => {
    if (!result.id) return;
    setIsApplying(true);
    try {
      const res = await fetch(`/api/tasks/${item.taskId}/plan/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: result.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to accept plan");

      // Mark as accepted in local state mirrors
      const accepted: TaskPlanReadModel = {
        ...result,
        status: "accepted",
      };
      setAcceptedPlan(accepted);
      setDisplayedSavedPlan(accepted);
      generationStatusRef.current = "accepted";
      setGenerationStatus("accepted");
      lastDisplayedSavedPlanKeyRef.current = savedPlanKey(accepted);

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
