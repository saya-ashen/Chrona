"use client";

import { useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { TaskPlanReadModel } from "@chrona/contracts"
import {
  startTaskPlanGenerationSession,
  stopTaskPlanGenerationSession,
  useTaskPlanGenerationSession,
} from "./task-plan-generation-session-store";

type UseTaskPlanGenerationOptions = {
  taskId?: string;
  workBlockId?: string | null;
  autoRequest?: boolean;
  forceRefresh?: boolean;
  onPlanLoaded?: (savedPlan: TaskPlanReadModel | null) => void;
};

export function useTaskPlanGeneration({
  taskId,
  workBlockId = null,
  autoRequest = false,
  forceRefresh = false,
  onPlanLoaded,
}: UseTaskPlanGenerationOptions) {
  const state = useTaskPlanGenerationSession(taskId, workBlockId, { hydrate: autoRequest });
  const onPlanLoadedRef = useRef(onPlanLoaded);

  useEffect(() => {
    onPlanLoadedRef.current = onPlanLoaded;
  }, [onPlanLoaded]);

  const requestGeneration = useCallback(
    (input?: { forceRefresh?: boolean; userInstruction?: string | null; selectedNodeId?: string | null }) => {
      if (!taskId) {
        return;
      }

      void startTaskPlanGenerationSession({
        taskId,
        workBlockId,
        forceRefresh: input?.forceRefresh ?? true,
        userInstruction: input?.userInstruction,
        selectedNodeId: input?.selectedNodeId,
        idempotencyKey: uuidv4(),
      });
    },
    [taskId, workBlockId],
  );

  const stopGeneration = useCallback(() => {
    if (!taskId) {
      return Promise.resolve();
    }

    return stopTaskPlanGenerationSession(taskId, workBlockId);
  }, [taskId, workBlockId]);

  useEffect(() => {
    if (!autoRequest || !taskId || !state.hydrated || state.sessionStatus !== "idle" || state.result) {
      return;
    }
    void startTaskPlanGenerationSession({
      taskId,
      workBlockId,
      forceRefresh,
      idempotencyKey: uuidv4(),
    });
  }, [autoRequest, forceRefresh, state.hydrated, state.result, state.sessionStatus, taskId, workBlockId]);

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
    requestGeneration,
    stopGeneration,
  };
}
