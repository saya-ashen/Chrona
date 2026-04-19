"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type {
  StructuredSuggestion,
  AutoCompleteSuggestion,
  StreamPhase,
  StreamToolCall,
  StreamToolResult,
} from "@/hooks/ai/types";

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

        const contentType = res.headers.get("Content-Type") ?? "";
        if (contentType.includes("text/event-stream") && res.body) {
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
          if (!controller.signal.aborted) {
            setIsLoading(false);
            if (phase !== "error") setPhase("done");
          }
        } else {
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
    phase,
    statusMessage,
    toolCalls,
    toolResults,
    partialText,
  };
}
