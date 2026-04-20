"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchJSON } from "@/hooks/ai/types";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";

export interface SmartDecompositionTaskInput {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string | Date | null;
  estimatedMinutes?: number;
  planningPrompt?: string;
  forceRefresh?: boolean;
  requestKey?: number;
}

export function useSmartDecomposition(taskInput: SmartDecompositionTaskInput | null) {
  const [result, setResult] = useState<TaskPlanGraphResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const inputKey = taskInput
    ? JSON.stringify({
        taskId: taskInput.taskId,
        title: taskInput.title.trim(),
        description: taskInput.description,
        priority: taskInput.priority,
        dueAt: taskInput.dueAt,
        estimatedMinutes: taskInput.estimatedMinutes,
        planningPrompt: taskInput.planningPrompt,
        forceRefresh: taskInput.forceRefresh,
        requestKey: taskInput.requestKey ?? 0,
      })
    : null;

  useEffect(() => {
    if (!taskInput || !inputKey || taskInput.title.trim().length < 3) {
      setResult(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetchJSON<TaskPlanGraphResponse>(
      "/api/ai/generate-task-plan",
      {
        taskId: taskInput.taskId,
        title: taskInput.title,
        description: taskInput.description,
        priority: taskInput.priority,
        dueAt: taskInput.dueAt,
        estimatedMinutes: taskInput.estimatedMinutes,
        planningPrompt: taskInput.planningPrompt,
        forceRefresh: taskInput.forceRefresh,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult(data);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to generate task plan");
          setResult(null);
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return { result, isLoading, error };
}

interface BatchApplyPlanResponse {
  parentTaskId: string;
  childTasks: unknown[];
  planGraph: unknown;
}

export function useBatchApplyPlan() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyPlan = useCallback(async (taskId: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchJSON<BatchApplyPlanResponse>(
        "/api/ai/batch-apply-plan",
        { taskId },
        controller.signal,
      );

      if (!controller.signal.aborted) {
        setIsLoading(false);
      }

      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return undefined;
      }
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "Failed to apply task plan";
        setError(message);
        setIsLoading(false);
      }
      return undefined;
    }
  }, []);

  return { applyPlan, isLoading, error };
}

/** @deprecated Use useBatchApplyPlan instead */
export const useBatchDecompose = useBatchApplyPlan;
