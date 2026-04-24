import {
  type BridgeExecutionTaskRequest,
  type BridgeFeature,
  type BridgeFeatureRequest,
  type BridgeFeatureResult,
  type BridgeRequest,
  type BridgeResponse,
  type NDJSONEvent,
  type ToolCallInfo,
  type ToolCallOutputInfo,
} from "../../openclaw-integration/src/transport/bridge-types";
import { type StructuredAgentResult } from "../../openclaw-integration/src/protocol/structured-result";

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
  checkGatewayAvailable?: () => Promise<boolean>;
  executeRequest?: (
    route: RouteKind,
    request: BridgeRequest,
  ) => Promise<ExecutionResult>;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_BRIDGE_PORT = Number(process.env.OPENCLAW_BRIDGE_PORT ?? "7677");
const OPENCLAW_GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789"
).replace(/\/+$/, "");
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID ?? "main";

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
  {
    pathname: "/v1/features/dispatch-task",
    feature: "dispatch_task",
    stream: false,
  },
];

const FUNCTION_TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  suggest_task_completions: {
    type: "object",
    additionalProperties: true,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string" },
            estimatedMinutes: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title"],
        },
      },
    },
    required: ["suggestions"],
  },
  generate_task_plan_graph: {
    type: "object",
    additionalProperties: true,
    properties: {
      summary: { type: "string" },
      reasoning: { type: "string" },
      nodes: { type: "array", items: { type: "object" } },
      edges: { type: "array", items: { type: "object" } },
    },
    required: ["summary", "nodes", "edges"],
  },
  dispatch_next_task_action: {
    type: "object",
    additionalProperties: true,
    properties: {
      schemaName: { const: "task_dispatch_decision" },
      schemaVersion: { const: "1.0.0" },
      action: { type: "string" },
      safety: { type: "object" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: [
      "schemaName",
      "schemaVersion",
      "action",
      "safety",
      "confidence",
      "reason",
    ],
  },
};

const FEATURE_FUNCTION_TOOL: Partial<Record<BridgeFeature, string>> = {
  suggest: "suggest_task_completions",
  generate_plan: "generate_task_plan_graph",
  dispatch_task: "dispatch_next_task_action",
};

const sessionPreviousResponseMap = new Map<string, string>();

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

function isFeatureRequest(
  request: BridgeRequest,
): request is BridgeFeatureRequest<Record<string, unknown>> {
  return "input" in request;
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeParseJsonArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  return parseJsonObject(value);
}

function extractOutputText(response: Record<string, unknown>): string {
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    if (record.type === "message") {
      const content = Array.isArray(record.content) ? record.content : [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const part = block as Record<string, unknown>;
        if (part.type === "output_text") {
          if (typeof part.text === "string") chunks.push(part.text);
          continue;
        }
        if (part.type === "text" && typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
      continue;
    }

    if (record.type === "output_text" && typeof record.text === "string") {
      chunks.push(record.text);
    }
  }

  if (chunks.length > 0) return chunks.join("").trim();
  if (typeof response.output_text === "string") return response.output_text.trim();
  return "";
}

function parseFunctionItems(response: Record<string, unknown>): {
  toolCalls: ToolCallInfo[];
  toolCallOutputs: ToolCallOutputInfo[];
} {
  const output = Array.isArray(response.output) ? response.output : [];
  const toolCalls: ToolCallInfo[] = [];
  const toolCallOutputs: ToolCallOutputInfo[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    if (record.type === "function_call" && typeof record.name === "string") {
      const callId =
        typeof record.call_id === "string"
          ? record.call_id
          : typeof record.id === "string"
            ? record.id
            : `${record.name}-${toolCalls.length + 1}`;
      const parsedArgs = safeParseJsonArguments(record.arguments) ?? {};
      toolCalls.push({
        tool: record.name,
        callId,
        input: parsedArgs,
        status: "completed",
      });
      continue;
    }

    if (record.type === "function_call_output") {
      const callId =
        typeof record.call_id === "string"
          ? record.call_id
          : typeof record.id === "string"
            ? record.id
            : `tool-output-${toolCallOutputs.length + 1}`;
      toolCallOutputs.push({ callId, output: record.output ?? null });
    }
  }

  return { toolCalls, toolCallOutputs };
}

function mapUsage(response: Record<string, unknown>): BridgeResponse["usage"] {
  const usage =
    response.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
      ? (response.usage as Record<string, unknown>)
      : null;
  if (!usage) return null;

  const inputTokens =
    typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : undefined;
  const outputTokens =
    typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : undefined;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;

  if (
    typeof inputTokens !== "number" &&
    typeof outputTokens !== "number" &&
    typeof totalTokens !== "number"
  ) {
    return null;
  }

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
    outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
    totalTokens,
  };
}

function buildStructuredResult(params: {
  sessionId: string;
  runId?: string;
  toolCalls: ToolCallInfo[];
  output: string;
  error: string | null;
  feature?: BridgeFeature | null;
  featurePayload?: unknown;
  featureToolName?: string | null;
  featureSource?: StructuredAgentResult["source"];
}): StructuredAgentResult {
  if (params.featurePayload !== undefined) {
    return {
      ok: true,
      parsed: params.featurePayload,
      source: params.featureSource ?? "business_tool",
      feature: params.feature ?? null,
      toolName: params.featureToolName ?? null,
      rawOutput: params.output,
      error: params.error,
      validationIssues: [],
      sessionId: params.sessionId,
      runId: params.runId,
      bridgeToolCalls: params.toolCalls.map((toolCall) => ({
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
    source: "fallback_text",
    feature: params.feature ?? null,
    toolName: params.featureToolName ?? null,
    rawOutput: params.output,
    error:
      params.error ??
      "No structured payload was extracted from OpenResponses function_call.arguments",
    validationIssues: [],
    sessionId: params.sessionId,
    runId: params.runId,
    bridgeToolCalls: params.toolCalls.map((toolCall) => ({
      tool: toolCall.tool,
      callId: toolCall.callId,
      input: toolCall.input,
      result: toolCall.result,
      status: toolCall.status,
    })),
  };
}

function buildFeatureResultFromResponse(
  feature: BridgeFeature,
  outputText: string,
  toolCalls: ToolCallInfo[],
): { featureResult: BridgeFeatureResult | null; error: string | null } {
  const requiredTool = FEATURE_FUNCTION_TOOL[feature];
  if (requiredTool) {
    const matching = [...toolCalls].reverse().find((call) => call.tool === requiredTool);
    if (!matching) {
      return {
        featureResult: null,
        error: `Feature '${feature}' requires function_call '${requiredTool}' in response.output`,
      };
    }
    return {
      featureResult: {
        feature,
        source: "business_tool",
        toolName: requiredTool,
        payload: matching.input,
      },
      error: null,
    };
  }

  if (feature === "chat") {
    return {
      featureResult: {
        feature,
        source: "assistant_text",
        payload: { content: outputText },
      },
      error: null,
    };
  }

  const parsedJson = parseJsonObject(outputText);
  if (!parsedJson) {
    return {
      featureResult: null,
      error: `Feature '${feature}' did not yield structured output`,
    };
  }

  return {
    featureResult: {
      feature,
      source: "output_json",
      payload: parsedJson,
    },
    error: null,
  };
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

function featureInstructions(feature: BridgeFeature): string {
  switch (feature) {
    case "suggest":
      return "Return suggestions only via function call suggest_task_completions.";
    case "generate_plan":
      return "Return plan graph only via function call generate_task_plan_graph.";
    case "dispatch_task":
      return "Return dispatch decision only via function call dispatch_next_task_action.";
    case "conflicts":
      return "Analyze conflicts and return structured JSON.";
    case "timeslots":
      return "Suggest timeslots and return structured JSON.";
    case "chat":
      return "Answer user request normally.";
  }
}

export function buildGatewayBody(
  route: RouteKind,
  request: BridgeRequest,
  sessionId: string,
): Record<string, unknown> {
  const previousResponseId = sessionPreviousResponseMap.get(sessionId);

  if (route.kind === "feature") {
    const featureRequest = request as BridgeFeatureRequest<Record<string, unknown>>;
    const requiredTool = FEATURE_FUNCTION_TOOL[route.feature];

    const body: Record<string, unknown> = {
      user: sessionId,
      instructions: `[Chrona Feature Request]\nFeature: ${route.feature}\n${featureInstructions(route.feature)}`,
      input: JSON.stringify(featureRequest.input),
      stream: route.stream,
    };

    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    if (requiredTool) {
      body.tools = [
        {
          type: "function",
          function: {
            name: requiredTool,
            description: `Chrona structured feature tool: ${requiredTool}`,
            parameters: FUNCTION_TOOL_SCHEMAS[requiredTool],
          },
        },
      ];
      body.tool_choice = {
        type: "function",
        function: { name: requiredTool },
      };
    }

    return body;
  }

  const execution = request as BridgeExecutionTaskRequest;
  const body: Record<string, unknown> = {
    user: sessionId,
    instructions: execution.instructions,
    input: JSON.stringify({
      taskId: execution.taskId,
      workspaceId: execution.workspaceId,
      taskTitle: execution.taskTitle,
      runtimeAdapterKey: execution.runtimeAdapterKey,
      runtimeInput: execution.runtimeInput ?? {},
    }),
    stream: route.stream,
  };

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  return body;
}

function gatewayHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": OPENCLAW_AGENT_ID,
  };
  if (OPENCLAW_GATEWAY_TOKEN) {
    headers.Authorization = `Bearer ${OPENCLAW_GATEWAY_TOKEN}`;
  }
  return headers;
}

function mapGatewaySseEvent(
  eventType: string,
  data: Record<string, unknown>,
  sessionId: string,
): NDJSONEvent | null {
  const responseRecord =
    data.response && typeof data.response === "object" && !Array.isArray(data.response)
      ? (data.response as Record<string, unknown>)
      : null;

  if (eventType === "response.created" || eventType === "response.in_progress") {
    return {
      type: "status",
      sessionId,
      responseId:
        responseRecord && typeof responseRecord.id === "string"
          ? responseRecord.id
          : undefined,
      status:
        responseRecord && typeof responseRecord.status === "string"
          ? responseRecord.status
          : eventType,
      message: eventType,
    };
  }

  if (eventType === "response.output_text.delta") {
    return {
      type: "text_delta",
      sessionId,
      text:
        typeof data.delta === "string"
          ? data.delta
          : typeof data.text === "string"
            ? data.text
            : "",
    };
  }

  if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
    const item =
      data.item && typeof data.item === "object" && !Array.isArray(data.item)
        ? (data.item as Record<string, unknown>)
        : null;
    if (!item) return null;

    if (item.type === "function_call" && typeof item.name === "string") {
      return {
        type: "tool_call",
        sessionId,
        tool: item.name,
        callId:
          typeof item.call_id === "string"
            ? item.call_id
            : typeof item.id === "string"
              ? item.id
              : undefined,
        input: safeParseJsonArguments(item.arguments) ?? {},
      };
    }

    if (item.type === "function_call_output") {
      return {
        type: "tool_result",
        sessionId,
        callId:
          typeof item.call_id === "string"
            ? item.call_id
            : typeof item.id === "string"
              ? item.id
              : undefined,
        output: item.output ?? null,
      };
    }
  }

  if (eventType === "response.completed") {
    return {
      type: "completed",
      sessionId,
      responseId:
        responseRecord && typeof responseRecord.id === "string"
          ? responseRecord.id
          : undefined,
      status:
        responseRecord && typeof responseRecord.status === "string"
          ? responseRecord.status
          : "completed",
      usage: mapUsage(responseRecord ?? {}) ?? undefined,
    };
  }

  if (eventType === "response.failed") {
    const error =
      typeof data.error === "string"
        ? data.error
        : data.error && typeof data.error === "object"
          ? JSON.stringify(data.error)
          : "response.failed";
    return {
      type: "failed",
      sessionId,
      error,
      message: error,
    };
  }

  return null;
}

async function executeGatewayRequest(
  route: RouteKind,
  request: BridgeRequest,
  logger: BridgeLogger,
): Promise<ExecutionResult> {
  const sessionId = request.sessionId ?? crypto.randomUUID();
  const startedAt = Date.now();
  const body = buildGatewayBody(route, request, sessionId);

  logger.info("bridge.request.start", {
    sessionId,
    gateway: OPENCLAW_GATEWAY_URL,
    request: summarizeBridgeRequest(route, request),
  });

  const timeoutMs = ((request.timeout ?? 300) + 15) * 1000;
  const response = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/responses`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    const bridgeResponse: BridgeResponse = {
      sessionId,
      output: "",
      toolCalls: [],
      toolCallOutputs: [],
      usage: null,
      error: `Gateway /v1/responses failed (${response.status}): ${errBody.slice(0, 300)}`,
      durationMs: Date.now() - startedAt,
      structured: buildStructuredResult({
        sessionId,
        output: "",
        toolCalls: [],
        error: `Gateway /v1/responses failed (${response.status})`,
        feature: route.kind === "feature" ? route.feature : null,
      }),
      feature: null,
    };
    return { response: bridgeResponse, events: [] };
  }

  if (!route.stream) {
    const gateway = (await response.json()) as Record<string, unknown>;
    const responseId = typeof gateway.id === "string" ? gateway.id : undefined;
    if (responseId) sessionPreviousResponseMap.set(sessionId, responseId);

    const { toolCalls, toolCallOutputs } = parseFunctionItems(gateway);
    const outputText = extractOutputText(gateway);

    let feature: BridgeFeatureResult | null = null;
    let semanticError: string | null = null;

    if (route.kind === "feature") {
      const built = buildFeatureResultFromResponse(route.feature, outputText, toolCalls);
      feature = built.featureResult;
      semanticError = built.error;
    }

    const bridgeResponse: BridgeResponse = {
      sessionId,
      responseId,
      responseStatus: typeof gateway.status === "string" ? gateway.status : undefined,
      runId: responseId,
      output: outputText,
      toolCalls,
      toolCallOutputs,
      usage: mapUsage(gateway),
      error:
        semanticError ??
        (gateway.error ? JSON.stringify(gateway.error) : null),
      durationMs: Date.now() - startedAt,
      structured: buildStructuredResult({
        sessionId,
        runId: responseId,
        output: outputText,
        toolCalls,
        error:
          semanticError ??
          (gateway.error ? JSON.stringify(gateway.error) : null),
        feature: route.kind === "feature" ? route.feature : null,
        featurePayload: feature?.payload,
        featureToolName: feature?.toolName ?? null,
        featureSource: feature?.source,
      }),
      feature,
    };

    return { response: bridgeResponse, events: [] };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Gateway stream response missing body");
  }

  const decoder = new TextDecoder();
  const events: NDJSONEvent[] = [];
  let buffer = "";
  let currentEventType = "";
  let finalGatewayResponse: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("event:")) {
        currentEventType = trimmed.slice(6).trim();
        continue;
      }
      if (!trimmed.startsWith("data:")) continue;

      const dataRaw = trimmed.slice(5).trim();
      if (dataRaw === "[DONE]") continue;

      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataRaw) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (currentEventType === "response.completed") {
        const responseObj =
          data.response && typeof data.response === "object" && !Array.isArray(data.response)
            ? (data.response as Record<string, unknown>)
            : null;
        if (responseObj) {
          finalGatewayResponse = responseObj;
        }
      }

      if (currentEventType === "response.failed") {
        const responseObj =
          data.response && typeof data.response === "object" && !Array.isArray(data.response)
            ? (data.response as Record<string, unknown>)
            : null;
        if (responseObj) {
          finalGatewayResponse = responseObj;
        }
      }

      const mapped = mapGatewaySseEvent(currentEventType, data, sessionId);
      if (mapped) {
        events.push(mapped);
      }
      currentEventType = "";
    }
  }

  if (!finalGatewayResponse) {
    finalGatewayResponse = {};
  }

  const responseId =
    typeof finalGatewayResponse.id === "string" ? finalGatewayResponse.id : undefined;
  if (responseId) sessionPreviousResponseMap.set(sessionId, responseId);

  const { toolCalls, toolCallOutputs } = parseFunctionItems(finalGatewayResponse);
  const outputText = extractOutputText(finalGatewayResponse);

  let feature: BridgeFeatureResult | null = null;
  let semanticError: string | null = null;

  if (route.kind === "feature") {
    const built = buildFeatureResultFromResponse(route.feature, outputText, toolCalls);
    feature = built.featureResult;
    semanticError = built.error;
  }

  const bridgeResponse: BridgeResponse = {
    sessionId,
    responseId,
    responseStatus:
      typeof finalGatewayResponse.status === "string"
        ? finalGatewayResponse.status
        : undefined,
    runId: responseId,
    output: outputText,
    toolCalls,
    toolCallOutputs,
    usage: mapUsage(finalGatewayResponse),
    error:
      semanticError ??
      (finalGatewayResponse.error
        ? JSON.stringify(finalGatewayResponse.error)
        : events.some((event) => event.type === "failed")
          ? "response.failed"
          : null),
    durationMs: Date.now() - startedAt,
    structured: buildStructuredResult({
      sessionId,
      runId: responseId,
      output: outputText,
      toolCalls,
      error:
        semanticError ??
        (finalGatewayResponse.error ? JSON.stringify(finalGatewayResponse.error) : null),
      feature: route.kind === "feature" ? route.feature : null,
      featurePayload: feature?.payload,
      featureToolName: feature?.toolName ?? null,
      featureSource: feature?.source,
    }),
    feature,
  };

  return { response: bridgeResponse, events };
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

export async function checkGatewayAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/health`, {
      headers: gatewayHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
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
  const featureRoute = FEATURE_ENDPOINTS.find(
    (endpoint) => endpoint.pathname === pathname,
  );
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
  ToolCallOutputInfo,
} from "../../openclaw-integration/src/transport/bridge-types";

export function startBridgeServer(options: StartBridgeServerOptions = {}) {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const hostname = options.hostname ?? "0.0.0.0";
  const logger = options.logger ?? createBridgeLogger();
  const gatewayAvailability =
    options.checkGatewayAvailable ?? checkGatewayAvailable;
  const executeRequest =
    options.executeRequest ??
    ((route: RouteKind, request: BridgeRequest) =>
      executeGatewayRequest(route, request, logger));

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
        const available = await gatewayAvailability();
        return json({
          status: available ? "ok" : "unavailable",
          gateway: OPENCLAW_GATEWAY_URL,
        });
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
    gateway: OPENCLAW_GATEWAY_URL,
    agentId: OPENCLAW_AGENT_ID,
  });

  return server;
}

if (import.meta.main) {
  startBridgeServer();
}
