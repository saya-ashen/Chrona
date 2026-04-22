/**
 * OpenClaw CLI Bridge — HTTP service that wraps `openclaw agent` CLI.
 *
 * Runs on the same machine as OpenClaw. Exposes a simple REST API
 * that spawns `openclaw agent --local --json` subprocesses and
 * parses the output from stderr.
 *
 * Output format handling:
 *   The CLI writes machine-readable JSON to stderr in one of two formats:
 *   (A) NDJSON stream — one JSON event per line (text, tool_use, etc.)
 *   (B) Single JSON blob — { payloads, meta } at the end of stderr
 *   The bridge detects and handles both.
 *
 * Endpoints:
 *   POST /v1/chat          — send a message, get full response (blocking)
 *   POST /v1/chat/stream   — send a message, get SSE stream of events
 *   GET  /v1/health        — check if openclaw CLI is available
 *
 * Request body (POST):
 *   {
 *     "sessionId": "optional-session-id",
 *     "message": "user message",
 *     "systemPrompt": "optional-system-prompt",
 *     "timeout": 300
 *   }
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
  extractStructuredResultFromToolCalls,
  type StructuredAgentResult,
} from "../../openclaw-integration/src/openclaw/structured-result";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface BridgeLogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

export function summarizeBridgeRequest(request: BridgeRequest): Record<string, unknown> {
  return {
    sessionId: request.sessionId ?? null,
    timeout: request.timeout ?? null,
    messageChars: request.message.length,
    hasSystemPrompt: Boolean(request.systemPrompt),
    systemPromptChars: request.systemPrompt?.length ?? 0,
    hasExecution: Boolean(request.execution),
    executionMode: request.execution?.mode ?? null,
    runtimeAdapterKey: request.execution?.runtimeAdapterKey ?? null,
    taskId: request.execution?.taskId ?? null,
    runtimeInputKeys: request.execution?.runtimeInput
      ? Object.keys(request.execution.runtimeInput).sort()
      : [],
  };
}

export function buildAgentMessage(request: BridgeRequest): string {
  let message = request.message;

  if (request.execution?.mode === "task") {
    const runtimeInput = request.execution.runtimeInput ?? {};
    const lines = [
      "[Chrona Task Execution Request]",
      request.execution.taskTitle ? `Task: ${request.execution.taskTitle}` : null,
      request.execution.taskId ? `Task ID: ${request.execution.taskId}` : null,
      request.execution.workspaceId ? `Workspace ID: ${request.execution.workspaceId}` : null,
      request.execution.runtimeAdapterKey
        ? `Runtime adapter: ${request.execution.runtimeAdapterKey}`
        : null,
      typeof runtimeInput.model === "string" && runtimeInput.model.trim()
        ? `Model: ${runtimeInput.model.trim()}`
        : null,
      typeof runtimeInput.approvalPolicy === "string" && runtimeInput.approvalPolicy.trim()
        ? `Approval policy: ${runtimeInput.approvalPolicy.trim()}`
        : null,
      typeof runtimeInput.toolMode === "string" && runtimeInput.toolMode.trim()
        ? `Tool mode: ${runtimeInput.toolMode.trim()}`
        : null,
      typeof runtimeInput.temperature === "number"
        ? `Temperature: ${runtimeInput.temperature}`
        : null,
      "",
      "[Task Instructions]",
      message,
    ].filter((line): line is string => line !== null);

    message = lines.join("\n");
  }

  if (request.systemPrompt) {
    message = `[System Prompt]\n${request.systemPrompt}\n\n[User Message]\n${message}`;
  }

  return message;
}

export function createBridgeLogger(options?: {
  minLevel?: LogLevel;
  sink?: (entry: BridgeLogEntry) => void;
}) {
  const minLevel = options?.minLevel ?? parseLogLevel(process.env.OPENCLAW_BRIDGE_LOG_LEVEL);
  const sink = options?.sink ?? ((entry: BridgeLogEntry) => console.log(JSON.stringify(entry)));

  const shouldLog = (level: LogLevel) => LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];

  const emit = (level: LogLevel, event: string, data?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;
    sink({
      ts: new Date().toISOString(),
      level,
      event,
      data,
    });
  };

  return {
    debug: (event: string, data?: Record<string, unknown>) => emit("debug", event, data),
    info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
    warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
    error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
  };
}

const logger = createBridgeLogger();

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

// Shared types from openclaw-integration
export type {
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "../../openclaw-integration/src/openclaw/bridge-types";

import type {
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "../../openclaw-integration/src/openclaw/bridge-types";

// ── Legacy single-blob format ──
interface LegacyBlobPayload {
  text: string | null;
  mediaUrl?: string | null;
}
interface LegacyBlobMeta {
  durationMs?: number;
  agentMeta?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  stopReason?: string;
}
interface LegacyBlob {
  payloads?: LegacyBlobPayload[];
  meta?: LegacyBlobMeta;
}

function getSessionTranscriptPath(sessionId: string): string {
  return `${process.env.HOME ?? ""}/.openclaw/agents/main/sessions/${sessionId}.jsonl`;
}

export function parseToolCallsFromSessionTranscript(transcriptText: string): ToolCallInfo[] {
  const toolCalls = new Map<string, ToolCallInfo>();
  const lines = transcriptText.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== "message") continue;
    const message = record.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const role = message.role;
    if (role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const part = item as Record<string, unknown>;
        if (part.type !== "toolCall") continue;
        const name = part.name;
        if (typeof name !== "string") continue;
        const callId = typeof part.id === "string" ? part.id : `session-${toolCalls.size + 1}`;
        const argumentsValue = part.arguments;
        if (!argumentsValue || typeof argumentsValue !== "object") continue;
        toolCalls.set(callId, {
          tool: name,
          callId,
          input: argumentsValue as Record<string, unknown>,
          status: "pending",
        });
      }
      continue;
    }

    if (role === "toolResult") {
      const toolName = message.toolName;
      const toolCallId = message.toolCallId;
      if (typeof toolName !== "string" || typeof toolCallId !== "string") continue;
      const details = message.details;
      const existing = toolCalls.get(toolCallId);
      if (existing) {
        existing.status = "completed";
        if (details && typeof details === "object") {
          existing.input = details as Record<string, unknown>;
        }
        continue;
      }

      if (details && typeof details === "object") {
        toolCalls.set(toolCallId, {
          tool: toolName,
          callId: toolCallId,
          input: details as Record<string, unknown>,
          status: "completed",
        });
      }
    }
  }

  return Array.from(toolCalls.values());
}

function loadToolCallsFromSessionTranscript(sessionId: string): ToolCallInfo[] {
  const path = getSessionTranscriptPath(sessionId);
  try {
    const text = readFileSync(path, "utf8");
    return parseToolCallsFromSessionTranscript(text);
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────
// CLI Executor
// ────────────────────────────────────────────────────────────────────

const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";

export async function checkCLIAvailable(): Promise<boolean> {
  try {
    const proc = spawn(OPENCLAW_BIN, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return new Promise((resolve) => {
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

/**
 * Try to extract the final multi-line JSON blob from stderr output.
 * Returns null if no valid JSON blob found.
 */
function extractFinalBlob(text: string): LegacyBlob | null {
  let braceCount = 0;
  let end = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "}") {
      if (braceCount === 0) end = i + 1;
      braceCount++;
    } else if (text[i] === "{") {
      braceCount--;
      if (braceCount === 0) {
        try {
          return JSON.parse(text.slice(i, end)) as LegacyBlob;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseNDJSONEvents(lines: string[]): NDJSONEvent[] {
  const events: NDJSONEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const obj = JSON.parse(trimmed) as NDJSONEvent;
      if (obj.type) events.push(obj);
    } catch {
      // skip
    }
  }
  return events;
}

export function buildStructuredResult(
  params: {
    sessionId: string;
    runId?: string;
    toolCalls: ToolCallInfo[];
    output: string;
    error: string | null;
    legacyToolCalls?: ToolCallInfo[];
    legacyExtractionError?: string | null;
  },
): StructuredAgentResult {
  const effectiveToolCalls = [
    ...params.toolCalls,
    ...(params.legacyToolCalls ?? []),
  ];

  const extracted = extractStructuredResultFromToolCalls(effectiveToolCalls);
  if (extracted.toolCall && extracted.validation) {
    return {
      ok: extracted.validation.ok,
      parsed: extracted.validation.ok ? extracted.validation.parsed?.result ?? null : null,
      structured: extracted.validation.parsed,
      rawToolCall: extracted.toolCall,
      rawOutput: params.output,
      status: extracted.validation.parsed?.status ?? null,
      error: extracted.validation.ok
        ? params.error
        : extracted.validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
      validationIssues: extracted.validation.issues,
      reliability: "tool_call",
      sessionId: params.sessionId,
      runId: params.runId,
      bridgeToolCalls: effectiveToolCalls.map((toolCall) => ({
        tool: toolCall.tool,
        callId: toolCall.callId,
        input: toolCall.input,
        result: toolCall.result,
        status: toolCall.status,
      })),
    };
  }

  return {
    ok: false,
    parsed: null,
    structured: null,
    rawOutput: params.output,
    status: null,
    error:
      params.legacyExtractionError ??
      params.error ??
      `Structured result tool '${SUBMIT_STRUCTURED_RESULT_TOOL_NAME}' was not called; raw assistant text fallback is unreliable.`,
    reliability: "fallback_text",
    sessionId: params.sessionId,
    runId: params.runId,
  };
}

function extractLegacyToolCallsFromBlob(blob: LegacyBlob): {
  toolCalls: ToolCallInfo[];
  extractionError: string | null;
} {
  const candidates: unknown[] = [];
  const meta = blob.meta as Record<string, unknown> | undefined;
  const agentMeta = meta?.agentMeta as Record<string, unknown> | undefined;

  const pushIfPresent = (value: unknown) => {
    if (value != null) candidates.push(value);
  };

  pushIfPresent(meta?.toolCalls);
  pushIfPresent(meta?.tool_calls);
  pushIfPresent(meta?.calls);
  pushIfPresent(meta?.events);
  pushIfPresent(meta?.trace);
  pushIfPresent(agentMeta?.toolCalls);
  pushIfPresent(agentMeta?.tool_calls);
  pushIfPresent(agentMeta?.calls);
  pushIfPresent(agentMeta?.events);
  pushIfPresent(agentMeta?.trace);

  const toolCalls: ToolCallInfo[] = [];

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const toolName = typeof record.tool === "string"
      ? record.tool
      : typeof record.name === "string"
        ? record.name
        : typeof record.toolName === "string"
          ? record.toolName
          : null;

    const input = record.input ?? record.args ?? record.arguments ?? record.details ?? null;
    if (toolName === SUBMIT_STRUCTURED_RESULT_TOOL_NAME && input && typeof input === "object") {
      toolCalls.push({
        tool: toolName,
        callId:
          typeof record.callId === "string"
            ? record.callId
            : typeof record.id === "string"
              ? record.id
              : `legacy-${toolCalls.length + 1}`,
        input: input as Record<string, unknown>,
        result: typeof record.result === "string" ? record.result : undefined,
        status: "completed",
      });
    }

    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };

  for (const candidate of candidates) {
    visit(candidate);
  }

  if (toolCalls.length > 0) {
    return { toolCalls, extractionError: null };
  }

  return {
    toolCalls: [],
    extractionError: "Legacy blob detected but did not contain submit_structured_result metadata",
  };
}

function buildStructuredBridgeError(params: {
  baseError: string | null;
  structured: StructuredAgentResult;
  output: string;
  blobDetected: boolean;
}): string | null {
  if (params.structured.ok) {
    return params.baseError;
  }

  const detail = params.structured.error ?? "Structured result missing or invalid";
  const outputPreview = params.output.slice(0, 500);
  const blobHint = params.blobDetected ? " legacy_blob_detected=true;" : "";
  return `${detail};${blobHint} outputPreview=${JSON.stringify(outputPreview)}`;
}

function shouldReturnHttpError(result: BridgeResponse): boolean {
  return Boolean(result.error) || Boolean(result.structured && !result.structured.ok);
}

function httpStatusForBridgeResult(result: BridgeResponse): number {
  if (!result.error && result.structured?.ok) {
    return 200;
  }

  if (result.structured && !result.structured.ok) {
    return 422;
  }

  return 500;
}


