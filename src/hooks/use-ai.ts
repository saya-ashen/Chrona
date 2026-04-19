"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

/** Structured suggestion from the AI API */
export interface StructuredSuggestion {
  id: string;
  /** One-line human-readable summary */
  summary: string;
  /** Structured actionable data — can be sent to apply-suggestion */
  action: {
    type: "create_task";
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    estimatedMinutes: number;
    tags: string[];
    scheduledStartAt?: string;
    scheduledEndAt?: string;
  };
}

/** Legacy flat shape — kept for backward compat in components */
export interface AutoCompleteSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
}

/** Stream event types from the SSE auto-complete endpoint */
export interface StreamToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface StreamToolResult {
  tool: string;
  result: string;
}

export type StreamPhase =
  | "idle"
  | "connecting"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

interface BatchDecomposeResponse {
  parentTaskId: string;
  subtasks: unknown[];
  decomposition: {
    totalEstimatedMinutes: number;
    feasibilityScore: number;
    warnings: string[];
  };
}

// ---------- 1. useAutoComplete (SSE streaming) ----------
//
// Timing policy:
//   - Only fires when trimmed title length >= 3 characters
//   - Debounce: 800ms after last keystroke
//   - Dedup: skips fetch if trimmed title hasn't changed since last fetch
//   - Streams SSE events for real-time UI feedback (status, tool calls, partial text)

export function useAutoComplete(title: string | null, debounceMs = 800) {
  const [structuredSuggestions, setStructuredSuggestions] = useState<StructuredSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<StreamToolCall[]>([]);
  const [toolResults, setToolResults] = useState<StreamToolResult[]>([]);
  const [partialText, setPartialText] = useState("");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = title?.trim() ?? "";

    if (!title || trimmed.length < 3) {
      setStructuredSuggestions([]);
      setIsLoading(false);
      setError(null);
      setPhase("idle");
      setStatusMessage(null);
      setToolCalls([]);
      setToolResults([]);
      setPartialText("");
      lastFetchedRef.current = null;
      return;
    }

    // Skip if we already fetched for this exact title
    if (lastFetchedRef.current === trimmed) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setPhase("connecting");
    setToolCalls([]);
    setToolResults([]);
    setPartialText("");

    timerRef.current = setTimeout(async () => {
      // Abort previous in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ai/auto-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ?? `Request failed (${res.status})`,
          );
        }

        // Check if SSE stream
        const contentType = res.headers.get("Content-Type") ?? "";
        if (contentType.includes("text/event-stream") && res.body) {
          // SSE streaming
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done || controller.signal.aborted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            let eventType = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                const raw = line.slice(6).trim();
                try {
                  const data = JSON.parse(raw) as Record<string, unknown>;
                  switch (eventType) {
                    case "status":
                      setPhase("thinking");
                      setStatusMessage(data.message as string);
                      break;
                    case "tool_call":
                      setPhase("thinking");
                      setToolCalls((prev) => [...prev, {
                        tool: data.tool as string,
                        input: data.input as Record<string, unknown>,
                      }]);
                      break;
                    case "tool_result":
                      setToolResults((prev) => [...prev, {
                        tool: data.tool as string,
                        result: data.result as string,
                      }]);
                      break;
                    case "partial":
                      setPhase("streaming");
                      setPartialText((prev) => prev + (data.text as string));
                      break;
                    case "suggestions": {
                      const suggestions = data.suggestions as StructuredSuggestion[];
                      const isFinal = data.isFinal as boolean;
                      if (suggestions?.length) {
                        setStructuredSuggestions(suggestions);
                      }
                      if (isFinal) {
                        lastFetchedRef.current = trimmed;
                      }
                      break;
                    }
                    case "error":
                      setError(data.message as string);
                      setPhase("error");
                      break;
                    case "done":
                      setPhase("done");
                      setIsLoading(false);
                      break;
                  }
                } catch {
                  // skip unparseable
                }
                eventType = "";
              }
            }
          }
          // Stream ended
          if (!controller.signal.aborted) {
            setIsLoading(false);
            if (phase !== "error") setPhase("done");
          }
        } else {
          // Legacy JSON response (fallback)
          const data = (await res.json()) as { suggestions?: StructuredSuggestion[] };
          if (!controller.signal.aborted) {
            setStructuredSuggestions(data.suggestions ?? []);
            setIsLoading(false);
            setPhase("done");
            lastFetchedRef.current = trimmed;
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
          setStructuredSuggestions([]);
          setIsLoading(false);
          setPhase("error");
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [title, debounceMs]);

  // Flatten to legacy shape for backward compat
  const suggestions: AutoCompleteSuggestion[] = useMemo(
    () =>
      structuredSuggestions.map((s) => ({
        title: s.action.title,
        description: s.action.description,
        priority: s.action.priority,
        estimatedMinutes: s.action.estimatedMinutes,
        tags: s.action.tags,
      })),
    [structuredSuggestions],
  );

  return {
    suggestions,
    structuredSuggestions,
    isLoading,
    error,
    // Streaming state
    phase,
    statusMessage,
    toolCalls,
    toolResults,
    partialText,
  };
}

// ---------- 2. useApplySuggestion ----------

/**
 * Hook to apply a structured AI suggestion via the apply-suggestion API.
 */
export function useApplySuggestion() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (workspaceId: string, suggestion: StructuredSuggestion) => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchJSON<{
          success: boolean;
          taskId?: string;
          suggestionId: string;
          action?: string;
          summary?: string;
        }>("/api/ai/apply-suggestion", { workspaceId, suggestion });

        setIsLoading(false);
        return data;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to apply suggestion";
        setError(message);
        setIsLoading(false);
        return undefined;
      }
    },
    [],
  );

  return { apply, isLoading, error };
}

// ---------- 3. useSmartAutomation ----------

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

  // Stabilize dependency
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

// ---------- 4. useSmartDecomposition ----------

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

  const inputKey = taskInput
    ? JSON.stringify({
        taskId: taskInput.taskId,
        title: taskInput.title.trim(),
        description: taskInput.description,
        priority: taskInput.priority,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return { result, isLoading, error };
}

// ---------- 5. useBatchDecompose ----------

export function useBatchDecompose() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const decompose = useCallback(async (taskId: string) => {
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

// ---------- 6. useSmartTimeslot ----------

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

  const inputKey = taskInput
    ? JSON.stringify({
        workspaceId: taskInput.workspaceId,
        taskId: taskInput.taskId,
        date: taskInput.date,
      })
    : null;

  useEffect(() => {
    if (!taskInput || !inputKey) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return { result, isLoading, error };
}
