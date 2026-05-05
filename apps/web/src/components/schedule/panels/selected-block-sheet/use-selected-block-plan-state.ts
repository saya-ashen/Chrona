"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduledItem, ScheduleAiPlanGenerationStatus, LegacySavedPlan } from "@/components/schedule/schedule-page-types";
import type { TaskPlanGraphResponse, CompiledPlan } from "@chrona/contracts/ai";

export type SavedTaskPlan = {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  revision?: number;
  summary?: string | null;
  updatedAt: string;
  plan?: CompiledPlan;
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
    plan: { title: "", goal: "", nodes: [], edges: [] },
    source: "saved",
    planGraph: saved.plan as unknown,
    savedPlan: {
      id: saved.id,
      status: saved.status,
      prompt: saved.prompt,
      revision: saved.revision ?? 0,
      summary: saved.summary ?? null,
      updatedAt: saved.updatedAt,
    } as unknown,
  };
}

function acceptedResponseFromGeneratedResult(result: TaskPlanGraphResponse): TaskPlanGraphResponse {
  const rSavedPlan = result.savedPlan as Record<string, unknown> | undefined;
  const rPlanGraph = result.planGraph as Record<string, unknown> | undefined;
  return {
    ...result,
    source: "saved",
    savedPlan: rSavedPlan
      ? { ...rSavedPlan, status: "accepted" }
      : rSavedPlan,
    planGraph: rPlanGraph
      ? { ...rPlanGraph, status: "accepted" }
      : rPlanGraph,
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
        const curSaved = current?.savedPlan as LegacySavedPlan | undefined;
        const accSaved = accepted.savedPlan as LegacySavedPlan | undefined;
        if (
          curSaved?.id === accSaved?.id
          && curSaved?.status === accSaved?.status
          && curSaved?.revision === accSaved?.revision
          && curSaved?.updatedAt === accSaved?.updatedAt
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
      const curSaved = current?.savedPlan as LegacySavedPlan | undefined;
      const accSaved = accepted.savedPlan as LegacySavedPlan | undefined;
      if (
        curSaved?.id === accSaved?.id
        && curSaved?.status === accSaved?.status
        && curSaved?.revision === accSaved?.revision
        && curSaved?.updatedAt === accSaved?.updatedAt
      ) {
        return current;
      }

      return accepted;
    });
  }, []);

  const handleApplyPlan = useCallback(async (result: TaskPlanGraphResponse) => {
    const savedPlan = result.savedPlan as LegacySavedPlan | undefined;
    if (!savedPlan?.id) return;
    setIsApplying(true);
    try {
      const res = await fetch(`/api/tasks/${item.taskId}/plan/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: savedPlan.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to accept plan");

      const accepted = acceptedResponseFromGeneratedResult(result);
      const accSavedPlan = accepted.savedPlan as LegacySavedPlan;
      setAcceptedPlan(accepted);
      const acceptedSavedPlan: SavedTaskPlan = {
        id: accSavedPlan.id,
        status: "accepted",
        prompt: accSavedPlan.prompt,
        revision: accSavedPlan.revision,
        summary: accSavedPlan.summary,
        updatedAt: accSavedPlan.updatedAt,
        plan: accepted.planGraph as CompiledPlan | undefined,
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
