"use client";

import { useEffect, useMemo, useRef, useState } from "react";
export type { StructuredSuggestion } from "@chrona/contracts";
import type { StructuredSuggestion } from "@chrona/contracts";
import { createLogger, fetchJsonEventSource, summarizeText } from "@shared/http";

export type AutoCompleteSuggestion = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
};

type StreamToolCall = {
  tool: string;
  input: Record<string, unknown>;
};

type StreamToolResult = {
  tool: string;
  result: string;
};

type StreamPhase =
  | "idle"
  | "connecting"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

const logger = createLogger("schedule.use-auto-complete");

export function useAutoComplete(title: string | null, debounceMs = 500) {
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
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = title?.trim() ?? "";

    if (!title || trimmed.length < 3) {
      abortRef.current?.abort();
      abortRef.current = null;
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

    if (lastFetchedRef.current === trimmed) return;

    const requestId = ++requestSeqRef.current;
    logger.info("request.start", { requestId, title: summarizeText(trimmed) });
    setIsLoading(true);
    setError(null);
    setPhase("idle");
    setStatusMessage(null);
    setToolCalls([]);
    setToolResults([]);
    setPartialText("");

    timerRef.current = setTimeout(async () => {
      if (requestId !== requestSeqRef.current) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("connecting");
      const isActiveRequest = () =>
        requestId === requestSeqRef.current && !controller.signal.aborted;

      try {
        let handledNonStreamResponse = false;
        let sawTerminalError = false;

        await fetchJsonEventSource("/api/ai/auto-complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ title: trimmed }),
          signal: controller.signal,
          async onNonStreamResponse(response) {
            handledNonStreamResponse = true;
            const data = (await response.json().catch(() => ({}))) as {
              suggestions?: StructuredSuggestion[];
            };
            if (!isActiveRequest()) return;
            setStructuredSuggestions(data.suggestions ?? []);
            setIsLoading(false);
            setPhase("done");
            lastFetchedRef.current = trimmed;
          },
          onEvent({ event, data }) {
            if (!isActiveRequest()) return;
            logger.info("stream.event", { requestId, eventType: event });

            switch (event) {
              case "status":
                setPhase("thinking");
                setStatusMessage(typeof data.message === "string" ? data.message : null);
                break;
              case "tool_call":
                setPhase("thinking");
                setToolCalls((previous) => [
                  ...previous,
                  {
                    tool: typeof data.tool === "string" ? data.tool : "unknown",
                    input: (data.input as Record<string, unknown> | undefined) ?? {},
                  },
                ]);
                break;
              case "tool_result":
                setPhase("thinking");
                setToolResults((previous) => [
                  ...previous,
                  {
                    tool: typeof data.tool === "string" ? data.tool : "unknown",
                    result:
                      typeof data.result === "string"
                        ? data.result
                        : JSON.stringify(data.result ?? ""),
                  },
                ]);
                break;
              case "partial":
                setPhase("streaming");
                setPartialText((previous) =>
                  previous + (typeof data.text === "string" ? data.text : ""),
                );
                break;
              case "suggestions": {
                const suggestions = data.suggestions as StructuredSuggestion[] | undefined;
                const isFinal = data.isFinal === true;
                setStructuredSuggestions(suggestions ?? []);
                if (isFinal) lastFetchedRef.current = trimmed;
                break;
              }
              case "error":
                sawTerminalError = true;
                setError(
                  typeof data.message === "string"
                    ? data.message
                    : "Failed to fetch suggestions",
                );
                setIsLoading(false);
                setPhase("error");
                break;
              case "done":
                setPhase("done");
                setIsLoading(false);
                break;
            }
          },
        });

        if (handledNonStreamResponse) return;
        if (isActiveRequest()) {
          setIsLoading(false);
          if (!sawTerminalError) setPhase("done");
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (isActiveRequest()) {
          setError(cause instanceof Error ? cause.message : "Failed to fetch suggestions");
          setStructuredSuggestions([]);
          setIsLoading(false);
          setPhase("error");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, debounceMs]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const suggestions: AutoCompleteSuggestion[] = useMemo(
    () =>
      structuredSuggestions.map((suggestion) => {
        const action = (suggestion as StructuredSuggestion & {
          action?: StructuredSuggestion["action"];
        }).action;
        if (action) {
          return {
            title: action.title,
            description: action.description,
            priority: action.priority,
            estimatedMinutes: action.estimatedMinutes,
            tags: action.tags,
          };
        }

        const legacy = suggestion as unknown as AutoCompleteSuggestion;
        return {
          title: legacy.title,
          description: legacy.description,
          priority: legacy.priority,
          estimatedMinutes: legacy.estimatedMinutes,
          tags: legacy.tags,
        };
      }),
    [structuredSuggestions],
  );

  return {
    suggestions,
    structuredSuggestions,
    isLoading,
    error,
    phase,
    statusMessage,
    toolCalls,
    toolResults,
    partialText,
  };
}
