"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AutomationSuggestion, TimeslotSuggestionResult } from "@/modules/ai/types";
import type { TaskDecompositionResult } from "@/modules/ai/task-decomposer";

// ---------- Shared helpers ----------

/**
 * Generic POST fetch with AbortController support.
 * Returns parsed JSON on success, throws on error.
 */
async function fetchJSON<T>(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      (errorBody as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  }

  return res.json() as Promise<T>;
}

// ---------- Types ----------

export interface AutoCompleteSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
}

interface AutoCompleteResponse {
  suggestions: AutoCompleteSuggestion[];
}

interface BatchDecomposeResponse {
  parentTaskId: string;
  subtasks: unknown[];
  decomposition: {
    totalEstimatedMinutes: number;
    feasibilityScore: number;
    warnings: string[];
  };
}

// ---------- 1. useAutoComplete ----------

export function useAutoComplete(title: string | null, debounceMs = 500) {
  const [suggestions, setSuggestions] = useState<AutoCompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Clear previous debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Don't fetch if title is too short or null
    if (!title || title.trim().length < 3) {
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    timerRef.current = setTimeout(() => {
      // Abort previous in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetchJSON<AutoCompleteResponse>(
        "/api/ai/auto-complete",
        { title: title.trim() },
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setSuggestions(data.suggestions ?? []);
            setIsLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
            setSuggestions([]);
            setIsLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [title, debounceMs]);

  return { suggestions, isLoading, error };
}

// ---------- 2. useSmartAutomation ----------

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

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!taskInput || taskInput.title.trim().length < 3) {
      setSuggestion(null);
      setIsLoading(false);
      setError(null);
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
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [taskInput]);

  return { suggestion, isLoading, error };
}

// ---------- 3. useSmartDecomposition ----------

export interface SmartDecompositionTaskInput {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string | Date | null;
  estimatedMinutes?: number;
}

export function useSmartDecomposition(taskInput: SmartDecompositionTaskInput | null) {
  const [result, setResult] = useState<TaskDecompositionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!taskInput || taskInput.title.trim().length < 3) {
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

    fetchJSON<TaskDecompositionResult>(
      "/api/ai/decompose-task",
      {
        taskId: taskInput.taskId,
        title: taskInput.title,
        description: taskInput.description,
        priority: taskInput.priority,
        dueAt: taskInput.dueAt,
        estimatedMinutes: taskInput.estimatedMinutes,
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
          setError(err instanceof Error ? err.message : "Failed to decompose task");
          setResult(null);
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [taskInput]);

  return { result, isLoading, error };
}

// ---------- 4. useBatchDecompose ----------

export function useBatchDecompose() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const decompose = useCallback(async (taskId: string) => {
    // Abort any previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchJSON<BatchDecomposeResponse>(
        "/api/ai/batch-decompose",
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
        const message = err instanceof Error ? err.message : "Failed to batch decompose task";
        setError(message);
        setIsLoading(false);
      }
      return undefined;
    }
  }, []);

  return { decompose, isLoading, error };
}

// ---------- 5. useSmartTimeslot ----------

export interface SmartTimeslotTaskInput {
  workspaceId: string;
  taskId: string;
  date?: string | Date;
}

export function useSmartTimeslot(taskInput: SmartTimeslotTaskInput | null) {
  const [result, setResult] = useState<TimeslotSuggestionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!taskInput) {
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

    fetchJSON<TimeslotSuggestionResult>(
      "/api/ai/suggest-timeslot",
      {
        workspaceId: taskInput.workspaceId,
        taskId: taskInput.taskId,
        date: taskInput.date,
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
          setError(err instanceof Error ? err.message : "Failed to suggest timeslot");
          setResult(null);
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [taskInput]);

  return { result, isLoading, error };
}
