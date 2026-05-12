"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import {
  startTaskPlanGenerationSession,
  stopTaskPlanGenerationSession,
  useTaskPlanGenerationSession,
} from "./task-plan-generation-session-store";

type UseTaskPlanGenerationOptions = {
  taskId?: string;
  autoRequest?: boolean;
  forceRefresh?: boolean;
  onPlanLoaded?: (savedPlan: TaskPlanReadModel | null) => void;
};

export function useTaskPlanGeneration({
  taskId,
  autoRequest = false,
  forceRefresh = false,
  onPlanLoaded,
}: UseTaskPlanGenerationOptions) {
  const state = useTaskPlanGenerationSession(taskId, { hydrate: autoRequest });
  const onPlanLoadedRef = useRef(onPlanLoaded);

  useEffect(() => {
    onPlanLoadedRef.current = onPlanLoaded;
  }, [onPlanLoaded]);

  const requestGeneration = useCallback(
    (nextForceRefresh = true) => {
      if (!taskId) {
        return;
      }

      void startTaskPlanGenerationSession(taskId, nextForceRefresh);
    },
    [taskId],
  );

  const stopGeneration = useCallback(() => {
    if (!taskId) {
      return Promise.resolve();
    }

    return stopTaskPlanGenerationSession(taskId);
  }, [taskId]);

  useEffect(() => {
    if (!autoRequest || !taskId) {
      return;
    }

    if (state.hydrated && state.sessionStatus === "idle" && !state.result) {
      void startTaskPlanGenerationSession(taskId, forceRefresh);
    }
  }, [autoRequest, forceRefresh, state.hydrated, state.result, state.sessionStatus, taskId]);

  useEffect(() => {
    if (!state.result) {
      return;
    }

    onPlanLoadedRef.current?.(state.result);
  }, [state.result]);

  return {
    result: state.result,
    isLoading: state.isLoading,
    error: state.error,
    phase: state.phase,
    statusMessage: state.statusMessage,
    partialText: state.partialText,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
    requestGeneration,
    stopGeneration,
  };
}
