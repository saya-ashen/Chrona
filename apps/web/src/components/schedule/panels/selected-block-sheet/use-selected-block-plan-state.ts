"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ScheduledItem,
  ScheduleAiPlanGenerationStatus,
  ScheduleTaskPlanSnapshot,
} from "@/components/schedule/schedule-page-types";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import { useTaskPlanGenerationSession } from "@/hooks/ai/task-plan-generation-session-store";
import { api } from "@/lib/rpc-client";

/** Subset of TaskPlanReadModel used as the accepted-plan shape in UI state. */
export type SavedTaskPlan = TaskPlanReadModel;

function hasFullPlan(saved: ScheduleTaskPlanSnapshot | TaskPlanReadModel | null | undefined): saved is TaskPlanReadModel {
  return Boolean(saved && "blueprint" in saved && "compiledPlan" in saved && "effectivePlan" in saved);
}

function savedPlanKey(saved: ScheduleTaskPlanSnapshot | SavedTaskPlan | null) {
  return saved ? `${saved.id}:${saved.status}:${saved.revision}:${saved.updatedAt}` : null;
}

function acceptedResponseFromSavedPlan(saved: SavedTaskPlan | null): TaskPlanReadModel | null {
  if (!saved || saved.status !== "accepted") {
    return null;
  }

  return saved;
}

function deriveGenerationStatus(
  savedPlan: ScheduleTaskPlanSnapshot | SavedTaskPlan | null,
  sessionStatus: "idle" | "running" | "completed" | "failed" | "cancelled",
): ScheduleAiPlanGenerationStatus {
  if (sessionStatus === "running") {
    return "generating";
  }

  if (savedPlan?.status === "accepted") {
    return "accepted";
  }

  return savedPlan ? "waiting_acceptance" : "idle";
}

export function useSelectedBlockPlanState({
  item,
  onMutatedAction,
}: {
  item: ScheduledItem;
  onMutatedAction: () => Promise<void>;
}) {
  const generationSession = useTaskPlanGenerationSession(item.taskId, item.workBlockId ?? null);
  const [displayedSavedPlan, setDisplayedSavedPlan] = useState<SavedTaskPlan | null>(() => hasFullPlan(item.savedPlan) ? item.savedPlan : null);
  const [generationStatus, setGenerationStatus] = useState(item.aiPlanGenerationStatus ?? "idle");
  const [acceptedPlan, setAcceptedPlan] = useState<TaskPlanReadModel | null>(() => hasFullPlan(item.savedPlan) ? acceptedResponseFromSavedPlan(item.savedPlan) : null);
  const [isApplying, setIsApplying] = useState(false);
  const lastDisplayedSavedPlanKeyRef = useRef<string | null>(savedPlanKey(item.savedPlan ?? null));
  const generationStatusRef = useRef<ScheduleAiPlanGenerationStatus>(item.aiPlanGenerationStatus ?? "idle");

  const applyPlanStateSnapshot = useCallback((snapshot: {
    savedPlan: ScheduleTaskPlanSnapshot | SavedTaskPlan | null;
    aiPlanGenerationStatus: ScheduleAiPlanGenerationStatus;
  }) => {
    const next = snapshot.savedPlan;
    const nextKey = savedPlanKey(next);
    const nextStatus = snapshot.aiPlanGenerationStatus;
    if (displayedSavedPlan?.status === "accepted" && next?.status !== "accepted") {
      generationStatusRef.current = "accepted";
      setGenerationStatus("accepted");
      return;
    }

    const currentPlanKey = lastDisplayedSavedPlanKeyRef.current;
    generationStatusRef.current = nextStatus;
    setGenerationStatus((current) => (current === nextStatus ? current : nextStatus));

    if (currentPlanKey === nextKey && (!hasFullPlan(next) || displayedSavedPlan?.id === next.id)) {
      return;
    }

    lastDisplayedSavedPlanKeyRef.current = nextKey;
    setDisplayedSavedPlan(hasFullPlan(next) ? next : null);

    const accepted = hasFullPlan(next) ? acceptedResponseFromSavedPlan(next) : null;
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
  }, [displayedSavedPlan?.id, displayedSavedPlan?.status, generationSession.sessionStatus]);

  useEffect(() => {
    generationStatusRef.current = item.aiPlanGenerationStatus ?? "idle";
    applyPlanStateSnapshot({
      savedPlan: item.savedPlan ?? null,
      aiPlanGenerationStatus: item.aiPlanGenerationStatus ?? "idle",
    });
  }, [applyPlanStateSnapshot, item.aiPlanGenerationStatus, item.savedPlan]);

  useEffect(() => {
    lastDisplayedSavedPlanKeyRef.current = savedPlanKey(item.savedPlan ?? null);
  }, [item.taskId, item.workBlockId, item.savedPlan]);

  useEffect(() => {
    const snapshot = item.savedPlan ?? null;
    if (
      !snapshot
      || hasFullPlan(snapshot)
      || item.aiPlanGenerationStatus === "generating"
      || generationSession.sessionStatus === "running"
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/tasks/${item.taskId}/plan${item.workBlockId ? `?workBlockId=${encodeURIComponent(item.workBlockId)}` : ""}`,
      );
      if (!response.ok || cancelled) {
        return;
      }

      const payload = await response.json() as {
        savedPlan?: TaskPlanReadModel | null;
        aiPlanGenerationStatus?: ScheduleAiPlanGenerationStatus;
      };
      if (cancelled) {
        return;
      }

      applyPlanStateSnapshot({
        savedPlan: payload.savedPlan ?? null,
        aiPlanGenerationStatus: payload.aiPlanGenerationStatus ?? deriveGenerationStatus(payload.savedPlan ?? snapshot, generationSession.sessionStatus),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [applyPlanStateSnapshot, generationSession.sessionStatus, item.savedPlan, item.taskId, item.workBlockId, item.aiPlanGenerationStatus]);

  useEffect(() => {
    const nextSavedPlan = displayedSavedPlan?.status === "accepted"
      ? displayedSavedPlan
      : generationSession.result ?? displayedSavedPlan;
    const nextStatus = deriveGenerationStatus(nextSavedPlan, generationSession.sessionStatus);

    applyPlanStateSnapshot({
      savedPlan: nextSavedPlan,
      aiPlanGenerationStatus:
        generationStatusRef.current === "generating" && nextStatus === "idle"
          ? "generating"
          : nextStatus,
    });
  }, [applyPlanStateSnapshot, displayedSavedPlan, generationSession.result, generationSession.sessionStatus]);

  const handlePlanLoaded = useCallback((saved: SavedTaskPlan | null) => {
    const nextKey = savedPlanKey(saved);
    if (lastDisplayedSavedPlanKeyRef.current !== nextKey) {
      lastDisplayedSavedPlanKeyRef.current = nextKey;
      setDisplayedSavedPlan(saved);
      const nextStatus = deriveGenerationStatus(saved, generationSession.sessionStatus);
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
  }, [generationSession.sessionStatus]);

  const handleApplyPlan = useCallback(async (result: TaskPlanReadModel) => {
    if (!result.id) return;
    setIsApplying(true);
    try {
      const res = await api.tasks[":taskId"].plan.accept.$post({
        param: { taskId: item.taskId },
        json: { planId: result.id, workBlockId: item.workBlockId ?? null },
      });
      if (!res.ok) throw new Error("Failed to accept plan");
      const payload = await res.json() as { savedPlan?: TaskPlanReadModel | null };
      const accepted = payload.savedPlan ?? { ...result, status: "accepted" as const };
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
  }, [item.taskId, item.workBlockId, onMutatedAction]);

  return {
    displayedSavedPlan,
    generationStatus,
    acceptedPlan,
    isApplying,
    handlePlanLoaded,
    handleApplyPlan,
  };
}
