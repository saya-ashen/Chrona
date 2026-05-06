"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createLogger, summarizeText } from "@/lib/logger";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";

const logger = createLogger("hook.use-auto-complete");
import type {
  StructuredSuggestion,
  AutoCompleteSuggestion,
  StreamPhase,
  StreamToolCall,
  StreamToolResult,
} from "./types";

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
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
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

    if (lastFetchedRef.current === trimmed) {
      return;
    }

    const requestId = ++requestSeqRef.current;
    logger.info("request.start", {
      requestId,
      title: summarizeText(trimmed),
    });
    setIsLoading(true);
    setError(null);
    setPhase("idle");
    setStatusMessage(null);
    setToolCalls([]);
    setToolResults([]);
    setPartialText("");

    timerRef.current = setTimeout(async () => {
      if (requestId !== requestSeqRef.current) return;

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("connecting");

      const isActiveRequest = () => requestId === requestSeqRef.current && !controller.signal.aborted;

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
                setToolCalls((prev) => [...prev, {
                  tool: typeof data.tool === "string" ? data.tool : "unknown",
                  input: (data.input as Record<string, unknown> | undefined) ?? {},
                }]);
                break;
              case "tool_result":
                setToolResults((prev) => [...prev, {
                  tool: typeof data.tool === "string" ? data.tool : "unknown",
                  result:
                    typeof data.result === "string"
                      ? data.result
                      : JSON.stringify(data.result ?? ""),
                }]);
                break;
              case "partial":
                setPhase("streaming");
                setPartialText((prev) => prev + (typeof data.text === "string" ? data.text : ""));
                break;
              case "suggestions": {
                const suggestions = data.suggestions as StructuredSuggestion[] | undefined;
                const isFinal = data.isFinal === true;
                setStructuredSuggestions(suggestions ?? []);
                if (isFinal) {
                  lastFetchedRef.current = trimmed;
                }
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

        if (handledNonStreamResponse) {
          return;
        }

        if (isActiveRequest()) {
          setIsLoading(false);
          if (!sawTerminalError) {
            setPhase("done");
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (isActiveRequest()) {
          setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
          setStructuredSuggestions([]);
          setIsLoading(false);
          setPhase("error");
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, debounceMs]);

  useEffect(() => () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const suggestions: AutoCompleteSuggestion[] = useMemo(
    () =>
      structuredSuggestions.map((s) => {
        const action = (s as StructuredSuggestion & { action?: StructuredSuggestion["action"] }).action;
        if (action) {
          return {
            title: action.title,
            description: action.description,
            priority: action.priority,
            estimatedMinutes: action.estimatedMinutes,
            tags: action.tags,
          };
        }

        const legacy = s as unknown as AutoCompleteSuggestion;
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
