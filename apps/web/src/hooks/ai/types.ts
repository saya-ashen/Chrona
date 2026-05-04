"use client";

export type { StructuredSuggestion } from "@chrona/contracts";

// ---------- Shared helpers ----------

/**
 * Generic POST fetch with AbortController support.
 * Returns parsed JSON on success, throws on error.
 */
export async function fetchJSON<T>(
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
