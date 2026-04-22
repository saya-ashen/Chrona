/**
 * OpenClaw CLI Bridge — explicit feature/execution REST API over `openclaw agent`.
 *
 * Output format handling:
 * - stderr NDJSON event stream
 * - transcript JSONL fallback
 * - legacy single-blob JSON fallback embedded in stderr
 */

import { spawn } from "node:child_process";
import {
  type BridgeExecutionTaskRequest,
  type BridgeFeature,
  type BridgeFeatureRequest,
  type BridgeFeatureResult,
  type BridgeRequest,
  type BridgeResponse,
  type NDJSONEvent,
  type ToolCallInfo,
} from "../../openclaw-integration/src/transport/bridge-types";
import {
  extractStructuredResultFromToolCalls,
  type StructuredAgentResult,
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
} from "../../openclaw-integration/src/protocol/structured-result";

type LogLevel = "debug" | "info" | "warn" | "error";
type BridgeLogger = ReturnType<typeof createBridgeLogger>;

type RouteKind =
  | { kind: "feature"; feature: BridgeFeature; stream: boolean }
  | { kind: "execution"; stream: boolean };

interface ExecutionResult {
  response: BridgeResponse;
  events: NDJSONEvent[];
}

export interface BridgeLogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

export interface StartBridgeServerOptions {
  port?: number;
  hostname?: string;
  logger?: BridgeLogger;
  checkCLIAvailable?: () => Promise<boolean>;
  executeRequest?: (
    route: RouteKind,
    request: BridgeRequest,
  ) => Promise<ExecutionResult>;
}

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
    toolCalls?: unknown;
    tool_calls?: unknown;
    calls?: unknown;
    events?: unknown;
    trace?: unknown;
  };
  toolCalls?: unknown;
  tool_calls?: unknown;
  calls?: unknown;
  events?: unknown;
  trace?: unknown;
  stopReason?: string;
}

interface LegacyBlob {
  payloads?: LegacyBlobPayload[];
  meta?: LegacyBlobMeta;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
const DEFAULT_BRIDGE_PORT = Number(process.env.OPENCLAW_BRIDGE_PORT ?? "7677");

const FEATURE_TOOL_PREFERENCE: Record<BridgeFeature, string | null> = {
  suggest: "suggest_task_completions",
  generate_plan: "generate_task_plan_graph",
  conflicts: null,
  timeslots: null,
  chat: null,
};

const FEATURE_ENDPOINTS: Array<{
  pathname: string;
  feature: BridgeFeature;
  stream: boolean;
}> = [
  { pathname: "/v1/features/suggest", feature: "suggest", stream: false },
  { pathname: "/v1/features/suggest/stream", feature: "suggest", stream: true },
  {
    pathname: "/v1/features/generate-plan",
    feature: "generate_plan",
    stream: false,
  },
  {
    pathname: "/v1/features/generate-plan/stream",
    feature: "generate_plan",
    stream: true,
  },
  {
    pathname: "/v1/features/analyze-conflicts",
    feature: "conflicts",
    stream: false,
  },
  {
    pathname: "/v1/features/suggest-timeslot",
    feature: "timeslots",
    stream: false,
  },
  { pathname: "/v1/features/chat", feature: "chat", stream: false },
];

function parseLogLevel(value: string | undefined): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "info";
}

function routeLabel(route: RouteKind): string {
  return route.kind === "feature"
    ? route.stream
      ? `features.${route.feature}.stream`
      : `features.${route.feature}`
    : route.stream
      ? "execution.task.stream"
      : "execution.task";
}

function getSessionTranscriptPath(sessionId: string): string {
  return `${process.env.HOME ?? ""}/.openclaw/agents/main/sessions/${sessionId}.jsonl`;
}

function isFeatureRequest(
  request: BridgeRequest,
): request is BridgeFeatureRequest<Record<string, unknown>> {
  return "input" in request;
}

function isExecutionRequest(
  request: BridgeRequest,
): request is BridgeExecutionTaskRequest {
  return "instructions" in request;
}

function encodeSSE(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      ...(init?.headers ?? {}),
    },
    status: init?.status,
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseUsageFromLegacyBlob(blob: LegacyBlob | null): BridgeResponse["usage"] {
  const usage = blob?.meta?.agentMeta?.usage;
  if (!usage) return null;
  const inputTokens = usage.inputTokens ?? usage.input_tokens;
  const outputTokens = usage.outputTokens ?? usage.output_tokens;
  if (typeof inputTokens === "number" || typeof outputTokens === "number") {
    return {
      inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
      outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
    };
  }
  return null;
}

function summarizeInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: typeof value };
  }
  return { keys: Object.keys(value).sort() };
}

export function summarizeBridgeRequest(
  route: RouteKind,
  request: BridgeRequest,
): Record<string, unknown> {
  if (isFeatureRequest(request)) {
    return {
      route: routeLabel(route),
      sessionId: request.sessionId ?? null,
      timeout: request.timeout ?? null,
      input: summarizeInput(request.input),
    };
  }

  return {
    route: routeLabel(route),
    sessionId: request.sessionId ?? null,
    timeout: request.timeout ?? null,
    instructionsChars: request.instructions.length,
    taskId: request.taskId ?? null,
    workspaceId: request.workspaceId ?? null,
    taskTitle: request.taskTitle ?? null,
    runtimeAdapterKey: request.runtimeAdapterKey ?? null,
    runtimeInputKeys: request.runtimeInput
      ? Object.keys(request.runtimeInput).sort()
      : [],
  };
}

export function buildAgentMessage(
  route: RouteKind,
  request: BridgeRequest,
): string {
  if (route.kind === "execution") {
    const execution = request as BridgeExecutionTaskRequest;
    const runtimeInput = execution.runtimeInput ?? {};
    return [
      "[Chrona Task Execution Request]",
      execution.taskTitle ? `Task: ${execution.taskTitle}` : null,
      execution.taskId ? `Task ID: ${execution.taskId}` : null,
      execution.workspaceId ? `Workspace ID: ${execution.workspaceId}` : null,
      execution.runtimeAdapterKey
        ? `Runtime adapter: ${execution.runtimeAdapterKey}`
        : null,
      typeof runtimeInput.model === "string" && runtimeInput.model.trim()
        ? `Model: ${runtimeInput.model.trim()}`
        : null,
      typeof runtimeInput.approvalPolicy === "string" &&
      runtimeInput.approvalPolicy.trim()
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
      execution.instructions,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  const feature = route.feature;
  const input = (request as BridgeFeatureRequest<Record<string, unknown>>).input;
  return [
    `[Chrona Feature Request]`,
    `Feature: ${feature}`,
    `Protocol: Respond using the '${FEATURE_TOOL_PREFERENCE[feature] ?? "feature-specific structured payload"}' semantic contract for this endpoint.`,
    "",
    "[Structured Input JSON]",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export function buildAgentCLIArgs(
  route: RouteKind,
  request: BridgeRequest,
  sessionId: string,
) {
  const agentMessage = buildAgentMessage(route, request);
  return [
    "agent",
    "--local",
    "--json",
    "--session-id",
    sessionId,
    "--message",
    agentMessage,
    "--timeout",
    String(request.timeout ?? 300),
  ];
}

export function createBridgeLogger(options?: {
  minLevel?: LogLevel;
  sink?: (entry: BridgeLogEntry) => void;
}) {
  const minLevel =
    options?.minLevel ?? parseLogLevel(process.env.OPENCLAW_BRIDGE_LOG_LEVEL);
  const sink =
    options?.sink ??
    ((entry: BridgeLogEntry) => console.log(JSON.stringify(entry)));

  const shouldLog = (level: LogLevel) =>
    LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];

  const emit = (
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ) => {
    if (!shouldLog(level)) return;
    sink({
      ts: new Date().toISOString(),
      level,
      event,
      data,
    });
  };

  return {
    debug: (event: string, data?: Record<string, unknown>) =>
      emit("debug", event, data),
    info: (event: string, data?: Record<string, unknown>) =>
      emit("info", event, data),
    warn: (event: string, data?: Record<string, unknown>) =>
      emit("warn", event, data),
    error: (event: string, data?: Record<string, unknown>) =>
      emit("error", event, data),
  };
}

export type {
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeFeatureResult,
  BridgeRequest,
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
} from "../../openclaw-integration/src/transport/bridge-types";

export function parseToolCallsFromSessionTranscript(
  transcriptText: string,
): ToolCallInfo[] {
  const toolCalls = new Map<string, ToolCallInfo>();
  const lines = transcriptText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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
        const callId =
          typeof part.id === "string"
            ? part.id
            : `session-${toolCalls.size + 1}`;
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
      if (typeof toolName !== "string" || typeof toolCallId !== "string") {
        continue;
      }
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

function extractFinalBlob(text: string): LegacyBlob | null {
  let braceCount = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      continue;
    }

    if (ch === "}") {
      if (braceCount === 0) end = i + 1;
      braceCount += 1;
      continue;
    }

    if (ch === "{") {
      braceCount -= 1;
      if (braceCount === 0 && end > i) {
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

function extractLegacyToolCallsFromBlob(blob: LegacyBlob | null): {
  toolCalls: ToolCallInfo[];
  extractionError: string | null;
} {
  if (!blob) {
    return { toolCalls: [], extractionError: null };
  }

  const candidates: unknown[] = [];
  const pushIfPresent = (value: unknown) => {
    if (value != null) candidates.push(value);
  };

  pushIfPresent(blob.meta?.toolCalls);
  pushIfPresent(blob.meta?.tool_calls);
  pushIfPresent(blob.meta?.calls);
  pushIfPresent(blob.meta?.events);
  pushIfPresent(blob.meta?.trace);
  pushIfPresent(blob.meta?.agentMeta?.toolCalls);
  pushIfPresent(blob.meta?.agentMeta?.tool_calls);
  pushIfPresent(blob.meta?.agentMeta?.calls);
  pushIfPresent(blob.meta?.agentMeta?.events);
  pushIfPresent(blob.meta?.agentMeta?.trace);

  const toolCalls: ToolCallInfo[] = [];

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const tool =
      typeof record.tool === "string"
        ? record.tool
        : typeof record.name === "string"
          ? record.name
          : typeof record.toolName === "string"
            ? record.toolName
            : null;
    const input = record.input ?? record.args ?? record.arguments ?? record.details;
    if (tool && input && typeof input === "object") {
      toolCalls.push({
        tool,
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
    extractionError: "Legacy blob detected but did not contain tool metadata",
  };
}

function extractOutputFromLegacyBlob(blob: LegacyBlob | null): string {
  if (!blob?.payloads?.length) return "";
  return blob.payloads
    .map((payload) => (typeof payload?.text === "string" ? payload.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseAssistantText(events: NDJSONEvent[]): string {
  return events
    .filter((event) => event.type === "text" && typeof event.text === "string")
    .map((event) => event.text as string)
    .join("")
    .trim();
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
      // ignore malformed stderr lines
    }
  }
  return events;
}

function dedupeToolCalls(toolCalls: ToolCallInfo[]): ToolCallInfo[] {
  const byId = new Map<string, ToolCallInfo>();
  for (const toolCall of toolCalls) {
    const existing = byId.get(toolCall.callId);
    if (!existing) {
      byId.set(toolCall.callId, toolCall);
      continue;
    }
    byId.set(toolCall.callId, {
      ...existing,
      ...toolCall,
      input:
        Object.keys(toolCall.input ?? {}).length > 0
          ? toolCall.input
          : existing.input,
      result: toolCall.result ?? existing.result,
      status:
        toolCall.status === "completed" || existing.status !== "completed"
          ? toolCall.status
          : existing.status,
    });
  }
  return Array.from(byId.values());
}

function toolCallsFromEvents(events: NDJSONEvent[]): ToolCallInfo[] {
  const pending = new Map<string, ToolCallInfo>();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "tool_use" && typeof event.tool === "string") {
      const callId = event.callId ?? `event-${index + 1}`;
      pending.set(callId, {
        tool: event.tool,
        callId,
        input: event.input ?? {},
        status: "pending",
      });
      continue;
    }

    if (event.type === "tool_result" && typeof event.tool === "string") {
      const callId = event.callId ?? `event-${index + 1}`;
      const existing = pending.get(callId);
      pending.set(callId, {
        tool: existing?.tool ?? event.tool,
        callId,
        input: existing?.input ?? {},
        result:
          typeof event.result === "string"
            ? event.result
            : typeof event.text === "string"
              ? event.text
              : undefined,
        status: "completed",
      });
    }
  }

  return Array.from(pending.values());
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function buildStructuredResult(params: {
  sessionId: string;
  runId?: string;
  toolCalls: ToolCallInfo[];
  output: string;
  error: string | null;
  legacyToolCalls?: ToolCallInfo[];
  legacyExtractionError?: string | null;
}): StructuredAgentResult {
  const effectiveToolCalls = dedupeToolCalls([
    ...params.toolCalls,
    ...(params.legacyToolCalls ?? []),
  ]);
  const extracted = extractStructuredResultFromToolCalls(effectiveToolCalls);

  if (extracted.toolCall && extracted.validation) {
    return {
      ok: extracted.validation.ok,
      parsed: extracted.validation.ok
        ? ((extracted.validation.parsed?.result ?? null) as unknown)
        : null,
      structured: extracted.validation.parsed,
      rawToolCall: extracted.toolCall,
      rawOutput: params.output,
      status: extracted.validation.parsed?.status ?? null,
      error: extracted.validation.ok
        ? params.error
        : extracted.validation.issues
            .map((issue) => `${issue.path} ${issue.message}`)
            .join("; "),
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
    bridgeToolCalls: effectiveToolCalls.map((toolCall) => ({
      tool: toolCall.tool,
      callId: toolCall.callId,
      input: toolCall.input,
      result: toolCall.result,
      status: toolCall.status,
    })),
  };
}

function findFeaturePayloadFromToolCalls(
  feature: BridgeFeature,
  toolCalls: ToolCallInfo[],
): BridgeFeatureResult | null {
  const preferredTool = FEATURE_TOOL_PREFERENCE[feature];
  if (!preferredTool) return null;
  const matched = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.tool === preferredTool && toolCall.input);
  if (!matched) return null;
  return {
    feature,
    source: "business_tool",
    toolName: preferredTool,
    payload: matched.input,
  };
}

function findFeaturePayloadFromOutput(
  feature: BridgeFeature,
  output: string,
): BridgeFeatureResult | null {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    if (feature === "chat" && output.trim()) {
      return {
        feature,
        source: "assistant_text",
        payload: { content: output.trim() },
      };
    }
    return null;
  }

  return {
    feature,
    source: "output_json",
    payload: parsed,
  };
}

function buildFeatureResult(
  feature: BridgeFeature,
  toolCalls: ToolCallInfo[],
  output: string,
): BridgeFeatureResult | null {
  return (
    findFeaturePayloadFromToolCalls(feature, toolCalls) ??
    findFeaturePayloadFromOutput(feature, output)
  );
}

function validateFeatureSuccess(
  feature: BridgeFeature,
  toolCalls: ToolCallInfo[],
  output: string,
): { featureResult: BridgeFeatureResult | null; error: string | null } {
  const featureResult = buildFeatureResult(feature, toolCalls, output);
  const preferredTool = FEATURE_TOOL_PREFERENCE[feature];

  if (preferredTool) {
    if (!featureResult || featureResult.source !== "business_tool") {
      return {
        featureResult,
        error: `Feature '${feature}' requires business tool '${preferredTool}' but no matching payload was extracted`,
      };
    }
    return { featureResult, error: null };
  }

  if (!featureResult) {
    return {
      featureResult: null,
      error: `Feature '${feature}' did not yield any structured payload or assistant output`,
    };
  }

  return { featureResult, error: null };
}

function normalizeFeatureRequest(
  payload: unknown,
): BridgeFeatureRequest<Record<string, unknown>> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const request = payload as Record<string, unknown>;
  const input = request.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  return {
    sessionId:
      typeof request.sessionId === "string" && request.sessionId.trim()
        ? request.sessionId
        : undefined,
    input: input as Record<string, unknown>,
    timeout: typeof request.timeout === "number" ? request.timeout : undefined,
  };
}

function normalizeExecutionRequest(
  payload: unknown,
): BridgeExecutionTaskRequest | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const request = payload as Record<string, unknown>;
  if (
    typeof request.instructions !== "string" ||
    !request.instructions.trim()
  ) {
    return null;
  }

  return {
    sessionId:
      typeof request.sessionId === "string" && request.sessionId.trim()
        ? request.sessionId
        : undefined,
    instructions: request.instructions,
    taskId: typeof request.taskId === "string" ? request.taskId : undefined,
    workspaceId:
      typeof request.workspaceId === "string" ? request.workspaceId : undefined,
    taskTitle:
      typeof request.taskTitle === "string" ? request.taskTitle : undefined,
    runtimeAdapterKey:
      typeof request.runtimeAdapterKey === "string"
        ? request.runtimeAdapterKey
        : undefined,
    runtimeInput:
      request.runtimeInput &&
      typeof request.runtimeInput === "object" &&
      !Array.isArray(request.runtimeInput)
        ? (request.runtimeInput as Record<string, unknown>)
        : undefined,
    timeout: typeof request.timeout === "number" ? request.timeout : undefined,
  };
}

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

async function executeRouteRequest(
  route: RouteKind,
  request: BridgeRequest,
  logger: BridgeLogger,
): Promise<ExecutionResult> {
  const sessionId = request.sessionId ?? crypto.randomUUID();
  const startedAt = Date.now();
  const args = buildAgentCLIArgs(route, request, sessionId);

  logger.info("bridge.request.start", {
    sessionId,
    request: summarizeBridgeRequest(route, request),
  });

  const proc = spawn(OPENCLAW_BIN, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: (request.timeout ?? 300) * 1000,
  });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const closeResult = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code, signal) => resolve({ code, signal }));
  });

  const stderrLines = stderr.split(/\r?\n/).filter(Boolean);
  const events = parseNDJSONEvents(stderrLines);
  const transcriptPath = getSessionTranscriptPath(sessionId);

  let transcriptToolCalls: ToolCallInfo[] = [];
  let transcriptError: string | null = null;
  try {
    const transcriptFile = Bun.file(transcriptPath);
    if (await transcriptFile.exists()) {
      transcriptToolCalls = parseToolCallsFromSessionTranscript(
        await transcriptFile.text(),
      );
    }
  } catch (error) {
    transcriptError = toErrorMessage(error);
  }

  const legacyBlob = extractFinalBlob(stderr);
  const legacyOutput = extractOutputFromLegacyBlob(legacyBlob);
  const legacyTools = extractLegacyToolCallsFromBlob(legacyBlob);
  const eventTools = toolCallsFromEvents(events);
  const toolCalls = dedupeToolCalls([
    ...eventTools,
    ...transcriptToolCalls,
    ...legacyTools.toolCalls,
  ]);

  const output =
    stdout.trim() || legacyOutput || parseAssistantText(events) || "";

  const cliError =
    closeResult.code === 0 && !closeResult.signal
      ? null
      : `openclaw exited with code ${closeResult.code ?? "null"}${closeResult.signal ? ` signal ${closeResult.signal}` : ""}`;

  const structured = buildStructuredResult({
    sessionId,
    toolCalls,
    legacyToolCalls: legacyTools.toolCalls,
    legacyExtractionError:
      transcriptError ?? legacyTools.extractionError ?? null,
    output,
    error: cliError,
  });

  let feature: BridgeFeatureResult | null = null;
  let semanticError: string | null = null;

  if (route.kind === "feature") {
    const validated = validateFeatureSuccess(route.feature, toolCalls, output);
    feature = validated.featureResult;
    semanticError = validated.error;
  }

  const response: BridgeResponse = {
    sessionId,
    output,
    toolCalls,
    usage: parseUsageFromLegacyBlob(legacyBlob),
    error: cliError ?? semanticError,
    durationMs:
      typeof legacyBlob?.meta?.durationMs === "number"
        ? legacyBlob.meta.durationMs
        : Date.now() - startedAt,
    structured,
    feature,
  };

  logger.info("bridge.request.finish", {
    sessionId,
    route: routeLabel(route),
    durationMs: response.durationMs,
    eventCount: events.length,
    toolCallCount: toolCalls.length,
    outputChars: response.output.length,
    error: response.error,
  });

  return { response, events };
}

function statusForResponse(route: RouteKind, response: BridgeResponse): number {
  if (!response.error) {
    return 200;
  }
  if (route.kind === "feature") {
    return 422;
  }
  return 500;
}

function matchRoute(pathname: string): RouteKind | null {
  const featureRoute = FEATURE_ENDPOINTS.find((endpoint) => endpoint.pathname === pathname);
  if (featureRoute) {
    return {
      kind: "feature",
      feature: featureRoute.feature,
      stream: featureRoute.stream,
    };
  }
  if (pathname === "/v1/execution/task") {
    return { kind: "execution", stream: false };
  }
  if (pathname === "/v1/execution/task/stream") {
    return { kind: "execution", stream: true };
  }
  return null;
}

export function startBridgeServer(options: StartBridgeServerOptions = {}) {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const hostname = options.hostname ?? "0.0.0.0";
  const logger = options.logger ?? createBridgeLogger();
  const cliAvailability = options.checkCLIAvailable ?? checkCLIAvailable;
  const executeRequest =
    options.executeRequest ??
    ((route: RouteKind, request: BridgeRequest) =>
      executeRouteRequest(route, request, logger));

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          },
        });
      }

      if (req.method === "GET" && url.pathname === "/v1/health") {
        const available = await cliAvailability();
        return json({ status: available ? "ok" : "unavailable", bin: OPENCLAW_BIN });
      }

      const route = matchRoute(url.pathname);
      if (!route || req.method !== "POST") {
        return json({ error: "Not found" }, { status: 404 });
      }

      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const normalized =
        route.kind === "feature"
          ? normalizeFeatureRequest(payload)
          : normalizeExecutionRequest(payload);

      if (!normalized) {
        return json(
          {
            error:
              route.kind === "feature"
                ? "Missing required field: input"
                : "Missing required field: instructions",
          },
          { status: 400 },
        );
      }

      try {
        const { response, events } = await executeRequest(route, normalized);

        if (!route.stream) {
          return json(response, { status: statusForResponse(route, response) });
        }

        const stream = new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encodeSSE("event", event));
            }
            controller.enqueue(encodeSSE("done", response));
            controller.close();
          },
        });

        return new Response(stream, {
          status: response.error ? statusForResponse(route, response) : 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          },
        });
      } catch (error) {
        logger.error("bridge.request.error", {
          route: routeLabel(route),
          request: summarizeBridgeRequest(route, normalized),
          error: toErrorMessage(error),
        });

        if (route.stream) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encodeSSE("error", { error: toErrorMessage(error) }),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            status: 500,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type",
              "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            },
          });
        }

        return json({ error: toErrorMessage(error) }, { status: 500 });
      }
    },
  });

  logger.info("bridge.started", {
    port,
    hostname,
    pid: process.pid,
    bin: OPENCLAW_BIN,
  });

  return server;
}

if (import.meta.main) {
  startBridgeServer();
}
