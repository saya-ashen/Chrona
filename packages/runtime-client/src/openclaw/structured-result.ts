export const SUBMIT_STRUCTURED_RESULT_TOOL_NAME = "submit_structured_result" as const;

export const STRUCTURED_RESULT_STATUSES = [
  "success",
  "needs_clarification",
  "error",
] as const;

export type StructuredResultStatus = (typeof STRUCTURED_RESULT_STATUSES)[number];
export type StructuredResultReliability = "tool_call" | "fallback_text";

export interface StructuredSubmissionEnvelope {
  schemaName: string;
  schemaVersion: string;
  status: StructuredResultStatus;
  confidence: number | null;
  result: unknown;
  missingFields: string[];
  followUpQuestions: string[];
  notes: string[];
}

export interface StructuredValidationIssue {
  path: string;
  message: string;
}

export interface StructuredAgentResult<T = unknown> {
  ok: boolean;
  parsed: T | null;
  structured: StructuredSubmissionEnvelope | null;
  rawToolCall?: unknown;
  rawOutput?: string | null;
  status?: StructuredResultStatus | null;
  error?: string | null;
  validationIssues?: StructuredValidationIssue[];
  reliability?: StructuredResultReliability;
  sessionId?: string;
  runId?: string;
  bridgeToolCalls?: Array<{
    tool: string;
    callId?: string;
    input: Record<string, unknown>;
    result?: string;
    status?: "pending" | "completed" | "error";
  }>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, path: string, issues: StructuredValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array of strings" });
    return [];
  }

  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex >= 0) {
    issues.push({ path: `${path}[${invalidIndex}]`, message: "must be a string" });
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function validateStructuredSubmission(value: unknown): {
  ok: boolean;
  parsed: StructuredSubmissionEnvelope | null;
  issues: StructuredValidationIssue[];
} {
  const issues: StructuredValidationIssue[] = [];
  const parsedValue = parseMaybeJson(value);

  if (!isPlainObject(parsedValue)) {
    return {
      ok: false,
      parsed: null,
      issues: [{ path: "$", message: "must be an object" }],
    };
  }

  const schemaName = typeof parsedValue.schemaName === "string" ? parsedValue.schemaName.trim() : "";
  if (!schemaName) {
    issues.push({ path: "schemaName", message: "is required and must be a non-empty string" });
  }

  const schemaVersion = typeof parsedValue.schemaVersion === "string"
    ? parsedValue.schemaVersion.trim()
    : "";
  if (!schemaVersion) {
    issues.push({ path: "schemaVersion", message: "is required and must be a non-empty string" });
  }

  const status = parsedValue.status;
  if (!STRUCTURED_RESULT_STATUSES.includes(status as StructuredResultStatus)) {
    issues.push({
      path: "status",
      message: `must be one of ${STRUCTURED_RESULT_STATUSES.join(", ")}`,
    });
  }

  const confidenceValue = parsedValue.confidence;
  let confidence: number | null = null;
  if (confidenceValue == null) {
    confidence = null;
  } else if (typeof confidenceValue === "number" && Number.isFinite(confidenceValue)) {
    if (confidenceValue < 0 || confidenceValue > 1) {
      issues.push({ path: "confidence", message: "must be between 0 and 1" });
    } else {
      confidence = confidenceValue;
    }
  } else {
    issues.push({ path: "confidence", message: "must be a number between 0 and 1 or null" });
  }

  const missingFields = asStringArray(parsedValue.missingFields, "missingFields", issues);
  const followUpQuestions = asStringArray(
    parsedValue.followUpQuestions,
    "followUpQuestions",
    issues,
  );
  const notes = asStringArray(parsedValue.notes, "notes", issues);

  const envelope: StructuredSubmissionEnvelope = {
    schemaName,
    schemaVersion,
    status: (STRUCTURED_RESULT_STATUSES.includes(status as StructuredResultStatus)
      ? status
      : "error") as StructuredResultStatus,
    confidence,
    result: parsedValue.result ?? null,
    missingFields,
    followUpQuestions,
    notes,
  };

  return {
    ok: issues.length === 0,
    parsed: issues.length === 0 ? envelope : envelope,
    issues,
  };
}

export function extractStructuredResultFromToolCalls(
  toolCalls: Array<{ tool: string; input: unknown }> | null | undefined,
): {
  toolCall: { tool: string; input: unknown } | null;
  validation: ReturnType<typeof validateStructuredSubmission> | null;
} {
  const matched = (toolCalls ?? []).find((toolCall) => toolCall.tool === SUBMIT_STRUCTURED_RESULT_TOOL_NAME);
  if (!matched) {
    return { toolCall: null, validation: null };
  }

  return {
    toolCall: matched,
    validation: validateStructuredSubmission(matched.input),
  };
}
