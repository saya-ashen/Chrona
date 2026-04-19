"use client";

import { useState, useEffect, useRef } from "react";
import { fetchJSON } from "@/hooks/ai/types";
import type { AutomationSuggestion } from "@/modules/ai/types";

export interface SmartAutomationTaskInput {
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string | Date | null;
  scheduledStartAt?: string | Date | null;
  scheduledEndAt?: string | Date | null;
  isRunnable?: boolean;
  runnabilityState?: string;
  ownerType?: string;
}

export function useSmartAutomation(taskInput: SmartAutomationTaskInput | null) {
  const [suggestion, setSuggestion] = useState<AutomationSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchedRef = useRef<string | null>(null);

  const inputKey = taskInput
    ? JSON.stringify({
        title: taskInput.title.trim(),
        description: taskInput.description,
        priority: taskInput.priority,
      })
    : null;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!taskInput || !inputKey || taskInput.title.trim().length < 3) {
      setSuggestion(null);
      setIsLoading(false);
      setError(null);
      lastFetchedRef.current = null;
      return;
    }

    if (lastFetchedRef.current === inputKey) {
      return;
    }

    setIsLoading(true);
    setError(null);

    timerRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetchJSON<AutomationSuggestion>(
        "/api/ai/suggest-automation",
        { taskId: "preview", ...taskInput },
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setSuggestion(data);
            setIsLoading(false);
            lastFetchedRef.current = inputKey;
          }
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Failed to suggest automation");
            setSuggestion(null);
            setIsLoading(false);
          }
        });
    }, 800);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return { suggestion, isLoading, error };
}
