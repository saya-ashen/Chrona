"use client";

export type { StructuredSuggestion } from "@chrona/contracts";

// ---------- Shared helpers ----------

/**
 * Generic POST fetch with AbortController support.
 * Returns parsed JSON on success, throws on error.
 */
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
