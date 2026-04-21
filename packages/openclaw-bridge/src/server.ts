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
} from "@chrona/runtime-client/openclaw/structured-result";

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
  };
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

// Shared types from @chrona/runtime-client
export type {
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "@chrona/runtime-client/openclaw/bridge-types";

import type {
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "@chrona/runtime-client/openclaw/bridge-types";

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

function redactBridgeResultForError(result: BridgeResponse) {
  return {
    error: result.error,
    sessionId: result.sessionId,
    runId: result.runId,
    durationMs: result.durationMs,
    output: result.output,
    toolCalls: result.toolCalls,
    structured: result.structured,
  };
}

function buildHttpChatResponse(result: BridgeResponse): Response {
  if (!shouldReturnHttpError(result)) {
    return Response.json(result, { headers: CORS_HEADERS });
  }

  return Response.json(redactBridgeResultForError(result), {
    status: httpStatusForBridgeResult(result),
    headers: CORS_HEADERS,
  });
}

function buildStreamDonePayload(result: BridgeResponse) {
  if (!shouldReturnHttpError(result)) {
    return result;
  }

  return redactBridgeResultForError(result);
}

function buildStreamErrorPayload(result: BridgeResponse) {
  return {
    error: result.error,
    sessionId: result.sessionId,
    runId: result.runId,
    structured: result.structured,
    output: result.output,
  };
}

function resultHasStructuredFailure(result: BridgeResponse): boolean {
  return Boolean(result.structured && !result.structured.ok);
}

function resultHasTerminalError(result: BridgeResponse): boolean {
  return Boolean(result.error);
}

function logStructuredFailure(result: BridgeResponse) {
  logger.warn("agent.structured_failure", {
    sessionId: result.sessionId,
    runId: result.runId,
    error: result.error,
    structuredError: result.structured?.error ?? null,
    outputChars: result.output.length,
    toolCallCount: result.toolCalls.length,
    reliability: result.structured?.reliability ?? null,
  });
}

function logHttpStructuredFailure(eventName: string, result: BridgeResponse, startedAt: number) {
  logger.warn(eventName, {
    sessionId: result.sessionId,
    runId: result.runId,
    durationMs: Date.now() - startedAt,
    error: result.error,
    structuredError: result.structured?.error ?? null,
    outputChars: result.output.length,
    structuredOk: result.structured?.ok ?? false,
    structuredStatus: result.structured?.status ?? null,
  });
}

function assertStructuredBridgeResult(result: BridgeResponse): BridgeResponse {
  if (resultHasStructuredFailure(result)) {
    logStructuredFailure(result);
  }
  return result;
}

function isStructuredModeRequest(request: BridgeRequest): boolean {
  return Boolean(request.systemPrompt?.includes(SUBMIT_STRUCTURED_RESULT_TOOL_NAME));
}

function decorateStructuredFailureError(request: BridgeRequest, result: BridgeResponse): BridgeResponse {
  if (!isStructuredModeRequest(request) || result.structured?.ok) {
    return result;
  }

  return {
    ...result,
    error: result.error ?? result.structured?.error ?? "Structured mode failed in bridge",
  };
}

function finalizeBridgeResult(request: BridgeRequest, result: BridgeResponse): BridgeResponse {
  return assertStructuredBridgeResult(decorateStructuredFailureError(request, result));
}

function legacyBlobContainsStructuredIntent(blob: LegacyBlob): boolean {
  const serialized = JSON.stringify(blob);
  return serialized.includes(SUBMIT_STRUCTURED_RESULT_TOOL_NAME)
    || serialized.includes("schemaName")
    || serialized.includes("task_plan_graph")
    || serialized.includes("needs_clarification");
}

export function executeAgent(
  request: BridgeRequest,
  onEvent?: (event: NDJSONEvent) => void,
): Promise<BridgeResponse> {
  const sessionId = request.sessionId ?? randomUUID();
  const startTime = Date.now();
  const runId = `bridge-run-${Date.now()}`;

  const args = ["agent", "--local", "--json"];
  args.push("--session-id", sessionId);

  let message = request.message;
  if (request.systemPrompt) {
    message = `[System Prompt]\n${request.systemPrompt}\n\n[User Message]\n${message}`;
  }
  args.push("--message", message);

  if (request.timeout) {
    args.push("--timeout", String(request.timeout));
  }

  logger.info("agent.spawn", {
    sessionId,
    runId,
    args,
    request: summarizeBridgeRequest(request),
  });

  return new Promise((resolve) => {
    const proc = spawn(OPENCLAW_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      timeout: (request.timeout ?? 300) * 1000 + 10000,
    });

    logger.info("agent.spawned", {
      sessionId,
      runId,
      pid: proc.pid ?? null,
      timeoutMs: (request.timeout ?? 300) * 1000 + 10000,
    });

    proc.stdin?.end();

    const stderrPreview: string[] = [];
    const stdoutPreview: string[] = [];

    const stderrChunks: string[] = [];
    const stderrLines: string[] = [];

    const textChunks: string[] = [];
    const toolCalls = new Map<string, ToolCallInfo>();
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let errorMessage: string | null = null;
    let gotNDJSON = false;

    let buffer = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      const str = chunk.toString();
      stderrChunks.push(str);
      if (stderrPreview.length < 20) {
        stderrPreview.push(str.slice(0, 500));
      }

      buffer += str;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        stderrLines.push(line);
        const trimmed = line.trim();
        if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;

        let event: NDJSONEvent;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (!event.type) continue;
        gotNDJSON = true;
        onEvent?.(event);
        processEvent(event);
      }
    });

    function processEvent(event: NDJSONEvent) {
      switch (event.type) {
        case "text":
          if (event.text) textChunks.push(event.text);
          break;
        case "tool_use":
          if (event.callId) {
            toolCalls.set(event.callId, {
              tool: event.tool ?? "unknown",
              callId: event.callId,
              input: event.input ?? {},
              status: "pending",
            });
          }
          break;
        case "tool_result":
          if (event.callId && toolCalls.has(event.callId)) {
            const tc = toolCalls.get(event.callId)!;
            tc.result = event.text;
            tc.status = "completed";
          }
          break;
        case "step_finish":
          if (event.usage) {
            const u = event.usage;
            usage = {
              inputTokens: (u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0) as number,
              outputTokens: (u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0) as number,
            };
          }
          break;
        case "error":
          errorMessage = event.text ?? event.error?.data?.message ?? event.error?.name ?? "Unknown error";
          break;
        case "lifecycle":
          if (event.phase === "failed" || event.phase === "error" || event.phase === "cancelled") {
            errorMessage = event.message ?? `Lifecycle: ${event.phase}`;
          }
          break;
      }
    }

    proc.stdout!.on("data", (chunk: Buffer) => {
      const str = chunk.toString();
      if (stdoutPreview.length < 20) {
        stdoutPreview.push(str.slice(0, 500));
      }
      logger.debug("agent.stdout", {
        sessionId,
        runId,
        chunk: str.slice(0, 500),
      });
    });

    proc.on("close", (code) => {
      if (buffer.trim()) {
        stderrLines.push(buffer);
      }

      const fullStderr = stderrChunks.join("");
      let legacyToolCalls: ToolCallInfo[] = [];
      let legacyExtractionError: string | null = null;
      let blobDetected = false;

      if (!gotNDJSON) {
        const blob = extractFinalBlob(fullStderr);
        if (blob) {
          blobDetected = true;
          const blobText = (blob.payloads ?? [])
            .map((p) => p.text ?? "")
            .filter(Boolean)
            .join("\n");

          if (blobText) textChunks.push(blobText);

          const blobUsage = blob.meta?.agentMeta?.usage;
          if (blobUsage) {
            usage = {
              inputTokens: blobUsage.inputTokens ?? blobUsage.input_tokens ?? 0,
              outputTokens: blobUsage.outputTokens ?? blobUsage.output_tokens ?? 0,
            };
          }

          const transcriptToolCalls = loadToolCallsFromSessionTranscript(sessionId);
          if (transcriptToolCalls.length > 0) {
            legacyToolCalls = transcriptToolCalls;
          } else {
            const legacyExtraction = extractLegacyToolCallsFromBlob(blob);
            legacyToolCalls = legacyExtraction.toolCalls;
            if (legacyExtraction.extractionError && legacyBlobContainsStructuredIntent(blob)) {
              legacyExtractionError = legacyExtraction.extractionError;
            }
          }

          if (blob.meta?.stopReason === "error" && !errorMessage) {
            const errorText = textChunks.join("");
            if (errorText.includes("unavailable") || errorText.includes("error")) {
              errorMessage = errorText;
            }
          }
        }
      }

      const output = textChunks.join("");
      const toolCallList = [
        ...Array.from(toolCalls.values()),
        ...legacyToolCalls,
      ];
      const preliminaryStructured = buildStructuredResult({
        sessionId,
        runId,
        toolCalls: Array.from(toolCalls.values()),
        legacyToolCalls,
        legacyExtractionError,
        output,
        error: errorMessage ?? (code !== 0 && code !== null ? `Process exited with code ${code}` : null),
      });
      const terminalError = buildStructuredBridgeError({
        baseError: errorMessage ?? (code !== 0 && code !== null ? `Process exited with code ${code}` : null),
        structured: preliminaryStructured,
        output,
        blobDetected,
      });
      const structured = buildStructuredResult({
        sessionId,
        runId,
        toolCalls: Array.from(toolCalls.values()),
        legacyToolCalls,
        legacyExtractionError,
        output,
        error: terminalError,
      });

      const result = finalizeBridgeResult(request, {
        sessionId,
        runId,
        output,
        toolCalls: toolCallList,
        usage,
        error: terminalError,
        durationMs: Date.now() - startTime,
        structured,
      } satisfies BridgeResponse);

      logger.info("agent.exit", {
        sessionId,
        runId,
        pid: proc.pid ?? null,
        code,
        durationMs: result.durationMs,
        error: result.error,
        outputChars: result.output.length,
        toolCallCount: result.toolCalls.length,
        structuredOk: result.structured?.ok ?? false,
        structuredStatus: result.structured?.status ?? null,
        stderrPreview: stderrPreview.join("\n").slice(0, 4000),
        stdoutPreview: stdoutPreview.join("\n").slice(0, 2000),
      });

      resolve(result);
    });

    proc.on("error", (err) => {
      const output = textChunks.join("");
      const toolCallList = Array.from(toolCalls.values());
      const terminalError = `Spawn error: ${err.message}`;
      logger.error("agent.spawn_error", {
        sessionId,
        runId,
        pid: proc.pid ?? null,
        message: err.message,
      });
      resolve({
        sessionId,
        runId,
        output,
        toolCalls: toolCallList,
        usage,
        error: terminalError,
        durationMs: Date.now() - startTime,
        structured: buildStructuredResult({
          sessionId,
          runId,
          toolCalls: toolCallList,
          output,
          error: terminalError,
        }),
      });
    });
  });
}

// ────────────────────────────────────────────────────────────────────
// HTTP Server (Bun.serve)
// ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.OPENCLAW_BRIDGE_PORT ?? 7677);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const startedAt = Date.now();
  logger.info("http.request", {
    method: req.method,
    path: url.pathname,
    search: url.search || null,
  });

  if (req.method === "OPTIONS") {
    logger.debug("http.options", { path: url.pathname });
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/v1/health" && req.method === "GET") {
    const available = await checkCLIAvailable();
    logger.info("http.health", {
      available,
      durationMs: Date.now() - startedAt,
    });
    return Response.json(
      { status: available ? "ok" : "unavailable", bin: OPENCLAW_BIN },
      { headers: CORS_HEADERS },
    );
  }

  if (url.pathname === "/v1/chat" && req.method === "POST") {
    const body = await parseBody(req);
    if (body instanceof Response) return body;

    logger.info("http.chat.start", summarizeBridgeRequest(body));
    const result = await executeAgent(body);
    if (shouldReturnHttpError(result)) {
      logHttpStructuredFailure("http.chat.failed", result, startedAt);
    } else {
      logger.info("http.chat.done", {
        sessionId: result.sessionId,
        runId: result.runId,
        durationMs: Date.now() - startedAt,
        error: result.error,
        outputChars: result.output.length,
        structuredOk: result.structured?.ok ?? false,
        structuredStatus: result.structured?.status ?? null,
      });
    }
    return buildHttpChatResponse(result);
  }

  if (url.pathname === "/v1/chat/stream" && req.method === "POST") {
    const body = await parseBody(req);
    if (body instanceof Response) return body;

    logger.info("http.chat_stream.start", summarizeBridgeRequest(body));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        function send(eventName: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        }

        executeAgent(body, (event) => send("event", event))
          .then((result) => {
            if (shouldReturnHttpError(result)) {
              logHttpStructuredFailure("http.chat_stream.failed", result, startedAt);
              send("error", buildStreamErrorPayload(result));
            } else {
              logger.info("http.chat_stream.done", {
                sessionId: result.sessionId,
                runId: result.runId,
                durationMs: Date.now() - startedAt,
                error: result.error,
                outputChars: result.output.length,
                structuredOk: result.structured?.ok ?? false,
                structuredStatus: result.structured?.status ?? null,
              });
              send("done", buildStreamDonePayload(result));
            }
            controller.close();
          })
          .catch((err) => {
            logger.error("http.chat_stream.error", {
              message: String(err),
              durationMs: Date.now() - startedAt,
            });
            send("error", { error: String(err) });
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  logger.warn("http.not_found", {
    method: req.method,
    path: url.pathname,
    durationMs: Date.now() - startedAt,
  });
  return Response.json(
    { error: "Not found", endpoints: ["GET /v1/health", "POST /v1/chat", "POST /v1/chat/stream"] },
    { status: 404, headers: CORS_HEADERS },
  );
}

async function parseBody(req: Request): Promise<BridgeRequest | Response> {
  let body: BridgeRequest;
  try {
    body = (await req.json()) as BridgeRequest;
  } catch {
    logger.warn("http.invalid_json", {
      method: req.method,
      url: req.url,
    });
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!body.message) {
    logger.warn("http.missing_message", {
      method: req.method,
      url: req.url,
      sessionId: body.sessionId ?? null,
    });
    return Response.json({ error: "message is required" }, { status: 400, headers: CORS_HEADERS });
  }
  return body;
}

export async function startBridgeServer(options?: { port?: number }) {
  const port = options?.port ?? PORT;
  logger.info("bridge.starting", {
    port,
    bin: OPENCLAW_BIN,
    pid: process.pid,
    logLevel: parseLogLevel(process.env.OPENCLAW_BRIDGE_LOG_LEVEL),
  });

  const available = await checkCLIAvailable();
  if (!available) {
    logger.warn("bridge.cli_unavailable", {
      bin: OPENCLAW_BIN,
    });
  } else {
    logger.info("bridge.cli_available", {
      bin: OPENCLAW_BIN,
    });
  }

  try {
    const server = Bun.serve({ port, fetch: handleRequest });
    logger.info("bridge.listening", {
      port,
      url: `http://localhost:${port}`,
      endpoints: ["GET /v1/health", "POST /v1/chat", "POST /v1/chat/stream"],
    });
    return server;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("bridge.listen_failed", {
      port,
      message: err.message,
      name: err.name,
    });
    throw error;
  }
}

if (import.meta.main) {
  await startBridgeServer();
}
