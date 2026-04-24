import type { StructuredAgentResult, StructuredResultReliability } from "@chrona/openclaw-integration/protocol/structured-result";
import type { BridgeResponse } from "@chrona/openclaw-integration/bridge/contracts";

import { AiClientError } from "./types";

export type { StructuredAgentResult, StructuredResultReliability };

export type OpenClawStructuredMode = "text" | "structured";

export type OpenClawCallResult<T = unknown> = {
  mode: OpenClawStructuredMode;
  text: string;
  structured: StructuredAgentResult<T> | null;
  bridge: BridgeResponse;
};

export function coerceStructuredResult<T = unknown>(
  bridge: BridgeResponse,
  mode: OpenClawStructuredMode,
): OpenClawCallResult<T> {
  return {
    mode,
    text: bridge.output,
    structured: bridge.structured
      ? { ...bridge.structured, parsed: (bridge.structured.parsed ?? null) as T | null }
      : null,
    bridge,
  };
}

export function parseTextJsonWithFallback<T>(
  raw: string,
  clientType: string,
): T {
  const jsonMatch =
    raw.match(/```(?:json|tool)?\s*\n?([\s\S]*?)```/) ??
    raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? raw;
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new AiClientError(
      `Failed to parse JSON: ${raw.slice(0, 200)}`,
      clientType,
      "invalid_response",
    );
  }
}

export function requireStructuredResult<T>(
  result: OpenClawCallResult<T>,
  clientType = "openclaw",
): StructuredAgentResult<T> {
  if (!result.structured) {
    throw new AiClientError(
      "Structured mode result missing parsed feature payload",
      clientType,
      "invalid_response",
    );
  }

  if (!result.structured.ok) {
    throw new AiClientError(
      result.structured.error ?? "Structured feature payload missing or invalid",
      clientType,
      "invalid_response",
    );
  }

  return result.structured;
}

export function parseDirectStructuredEnvelope<T>(
  value: unknown,
  clientType: string,
): StructuredAgentResult<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiClientError(
      "Structured result payload is not a valid object",
      clientType,
      "invalid_response",
    );
  }

  return {
    ok: true,
    parsed: value as T,
    source: "output_json",
    error: null,
    validationIssues: [],
  };
}
