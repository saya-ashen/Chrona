"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { TaskPlanReadModel } from "@chrona/contracts/ai";

import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";

import type { StreamPhase, StreamToolCall, StreamToolResult } from "./types";

type ActivePlanRequest = {
  taskId: string;
  forceRefresh: boolean;
  requestKey: number;
};

type TaskPlanGenerationState = {
  result: TaskPlanReadModel | null;
  isLoading: boolean;
  error: string | null;
  phase: StreamPhase;
  statusMessage: string | null;
  partialText: string;
  toolCalls: StreamToolCall[];
  toolResults: StreamToolResult[];
};

type TaskPlanGenerationAction =
  | { type: "reset" }
  | { type: "start" }
  | { type: "status"; message: string | null }
  | { type: "tool_call"; call: StreamToolCall }
  | { type: "tool_result"; result: StreamToolResult }
  | { type: "partial"; text: string }
  | { type: "result"; result: TaskPlanReadModel | null }
  | { type: "error"; message: string }
  | { type: "finish" };

const initialTaskPlanGenerationState: TaskPlanGenerationState = {
  result: null,
  isLoading: false,
  error: null,
  phase: "idle",
  statusMessage: null,
  partialText: "",
  toolCalls: [],
  toolResults: [],
};

function taskPlanGenerationReducer(
  state: TaskPlanGenerationState,
  action: TaskPlanGenerationAction,
): TaskPlanGenerationState {
  switch (action.type) {
    case "reset":
      return initialTaskPlanGenerationState;
    case "start":
      return {
        ...initialTaskPlanGenerationState,
        isLoading: true,
        phase: "connecting",
      };
    case "status":
      return {
        ...state,
        phase: "thinking",
        statusMessage: action.message,
      };
    case "tool_call":
      return {
        ...state,
        phase: "thinking",
        toolCalls: [...state.toolCalls, action.call],
      };
    case "tool_result":
      return {
        ...state,
        toolResults: [...state.toolResults, action.result],
      };
    case "partial":
      return {
        ...state,
        phase: "streaming",
        partialText: state.partialText + action.text,
      };
    case "result":
      return {
        ...state,
        result: action.result,
        isLoading: false,
        phase: "done",
      };
    case "error":
      return {
        ...state,
        error: action.message,
        isLoading: false,
        phase: "error",
      };
    case "finish":
      if (!state.isLoading) {
        return state;
      }

      return {
        ...state,
        isLoading: false,
        phase: state.phase === "error" ? "error" : "done",
      };
    default:
      return state;
  }
}

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
  const [state, dispatch] = useReducer(
    taskPlanGenerationReducer,
    initialTaskPlanGenerationState,
  );
  const [activeRequest, setActiveRequest] = useState<ActivePlanRequest | null>(
    autoRequest && taskId
      ? {
          taskId,
          forceRefresh,
          requestKey: 0,
        }
      : null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const hasInitializedAutoRequestRef = useRef(autoRequest);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "finish" });
  }, []);

  const requestGeneration = useCallback(
    (nextForceRefresh = true) => {
      if (!taskId) {
        return;
      }

      setActiveRequest((current) => ({
        taskId,
        forceRefresh: nextForceRefresh,
        requestKey: (current?.requestKey ?? 0) + 1,
      }));
    },
    [taskId],
  );

  useEffect(() => {
    if (!taskId) {
      stopGeneration();
      setActiveRequest(null);
      dispatch({ type: "reset" });
    }
  }, [stopGeneration, taskId]);

  useEffect(() => {
    if (!autoRequest || hasInitializedAutoRequestRef.current || !taskId) {
      return;
    }

    hasInitializedAutoRequestRef.current = true;
    setActiveRequest({
      taskId,
      forceRefresh,
      requestKey: 0,
    });
  }, [autoRequest, forceRefresh, taskId]);

  useEffect(() => {
    if (!activeRequest?.taskId) {
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const requestId = ++requestSeqRef.current;
    const isActive = () =>
      requestId === requestSeqRef.current && !controller.signal.aborted;

    dispatch({ type: "start" });

    const run = async () => {
      try {
        await fetchJsonEventSource(
          `/api/tasks/${activeRequest.taskId}/plan/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              forceRefresh: activeRequest.forceRefresh,
            }),
            signal: controller.signal,
            onEvent({ event, data }) {
              if (!isActive()) {
                return;
              }

              switch (event) {
                case "status":
                  dispatch({
                    type: "status",
                    message:
                      typeof data.message === "string" ? data.message : null,
                  });
                  break;
                case "tool_call":
                  dispatch({
                    type: "tool_call",
                    call: {
                      tool:
                        typeof data.tool === "string" ? data.tool : "unknown",
                      input:
                        (data.input as Record<string, unknown> | undefined) ??
                        {},
                    },
                  });
                  break;
                case "tool_result":
                  dispatch({
                    type: "tool_result",
                    result: {
                      tool:
                        typeof data.tool === "string" ? data.tool : "unknown",
                      result:
                        typeof data.result === "string"
                          ? data.result
                          : JSON.stringify(data.result ?? ""),
                    },
                  });
                  break;
                case "partial":
                  dispatch({
                    type: "partial",
                    text: typeof data.text === "string" ? data.text : "",
                  });
                  break;
                case "result":
                  dispatch({
                    type: "result",
                    result:
                      (data.result as TaskPlanReadModel | undefined) ?? null,
                  });
                  break;
                case "error":
                  dispatch({
                    type: "error",
                    message:
                      typeof data.message === "string"
                        ? data.message
                        : "Failed to generate task plan",
                  });
                  break;
              }
            },
          },
        );

        if (isActive()) {
          dispatch({ type: "finish" });
        }
      } catch (streamError) {
        if (
          streamError instanceof DOMException &&
          streamError.name === "AbortError"
        ) {
          return;
        }

        if (isActive()) {
          dispatch({
            type: "error",
            message:
              streamError instanceof Error
                ? streamError.message
                : "Failed to generate task plan",
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    void run();

    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [activeRequest]);

  useEffect(() => {
    if (!state.result) {
      return;
    }

    onPlanLoaded?.(state.result);
  }, [onPlanLoaded, state.result]);

  return {
    ...state,
    requestGeneration,
    stopGeneration,
  };
}
