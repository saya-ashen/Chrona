"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchJSON } from "./types";
import type { TaskPlanGraphResponse } from "@chrona/contracts/ai";
import type { StreamToolCall, StreamToolResult, StreamPhase } from "./types";
import { createLogger, summarizeText } from "../logger";

const logger = createLogger("hook.use-smart-decomposition");

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
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<StreamToolCall[]>([]);
  const [toolResults, setToolResults] = useState<StreamToolResult[]>([]);
  const [partialText, setPartialText] = useState("");
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
      setPhase("idle");
      setStatusMessage(null);
      setToolCalls([]);
      setToolResults([]);
      setPartialText("");
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    logger.info("request.start", {
      taskId: taskInput.taskId ?? null,
      title: summarizeText(taskInput.title),
      requestKey: taskInput.requestKey ?? 0,
    });
    setIsLoading(true);
    setError(null);
    setPhase("connecting");
    setStatusMessage(null);
    setToolCalls([]);
    setToolResults([]);
    setPartialText("");

    fetch("/api/ai/generate-task-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        taskId: taskInput.taskId,
        title: taskInput.title,
        description: taskInput.description,
        priority: taskInput.priority,
        dueAt: taskInput.dueAt,
        estimatedMinutes: taskInput.estimatedMinutes,
        planningPrompt: taskInput.planningPrompt,
        forceRefresh: taskInput.forceRefresh,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(
            (errorBody as { error?: string }).error ?? `Request failed (${response.status})`,
          );
        }

        const contentType = response.headers.get("Content-Type") ?? "";
        if (contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
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
                  logger.info("stream.event", {
                    taskId: taskInput.taskId ?? null,
                    eventType,
                  });
                  switch (eventType) {
                    case "status":
                      setPhase("thinking");
                      setStatusMessage(data.message as string);
                      break;
                    case "tool_call":
                      setToolCalls((prev) => [
                        ...prev,
                        { tool: data.tool as string, input: (data.input as Record<string, unknown>) ?? {} },
                      ]);
                      break;
                    case "tool_result":
                      setToolResults((prev) => [
                        ...prev,
                        { tool: data.tool as string, result: (data.result as string) ?? "" },
                      ]);
                      break;
                    case "partial":
                      setPhase("streaming");
                      setPartialText((prev) => prev + ((data.text as string) ?? ""));
                      break;
                    case "result":
                      setResult(data as unknown as TaskPlanGraphResponse);
                      break;
                    case "error":
                      setError((data.message as string) ?? "Failed to generate task plan");
                      setPhase("error");
                      break;
                    case "done":
                      setPhase("done");
                      setIsLoading(false);
                      break;
                  }
                } catch {
                  // ignore malformed event payloads
                }
                eventType = "";
              }
            }
          }

          if (!controller.signal.aborted) {
            setIsLoading(false);
            setPhase((current) => (current === "error" ? current : "done"));
          }
          return;
        }

        const data = (await response.json()) as TaskPlanGraphResponse;
        if (!controller.signal.aborted) {
          setResult(data);
          setIsLoading(false);
          setPhase("done");
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to generate task plan");
          setResult(null);
          setIsLoading(false);
          setPhase("error");
        }
      });

    return () => {
      controller.abort();
    };

  }, [inputKey]);

  return {
    result,
    isLoading,
    error,
    phase,
    statusMessage,
    toolCalls,
    toolResults,
    partialText,
  };
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
