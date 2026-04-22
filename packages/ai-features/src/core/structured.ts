import {
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
  validateStructuredSubmission,
  type StructuredAgentResult,
  type StructuredResultStatus,
  type StructuredSubmissionEnvelope,
  type BridgeResponse,
} from "@chrona/openclaw-integration/openclaw";

import { AiClientError } from "./types";

export { SUBMIT_STRUCTURED_RESULT_TOOL_NAME };
export type { StructuredAgentResult, StructuredResultStatus, StructuredSubmissionEnvelope };

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
    structured: bridge.structured ? { ...bridge.structured, parsed: (bridge.structured.parsed ?? null) as T | null } : null,
    bridge,
  };
}

export function parseTextJsonWithFallback<T>(
  raw: string,
  clientType: string,
): T {
  const jsonMatch =
    raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
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
    throw new AiClientError("Structured mode result missing bridge structured payload", clientType, "invalid_response");
  }

  if (!result.structured.ok || !result.structured.structured) {
    throw new AiClientError(
      result.structured.error ?? `Structured result tool '${SUBMIT_STRUCTURED_RESULT_TOOL_NAME}' missing or invalid`,
      clientType,
      "invalid_response",
    );
  }

  return result.structured;
}

export function parseDirectStructuredEnvelope<T>(value: unknown, clientType: string): StructuredAgentResult<T> {
  const validation = validateStructuredSubmission(value);
  if (!validation.parsed) {
    throw new AiClientError("Structured result payload is not a valid object", clientType, "invalid_response");
  }

  return {
    ok: validation.ok,
    parsed: validation.ok ? (validation.parsed.result as T) : null,
    structured: validation.parsed,
    status: validation.parsed.status,
    error: validation.ok ? null : validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
    validationIssues: validation.issues,
    reliability: "tool_call",
  };
}





