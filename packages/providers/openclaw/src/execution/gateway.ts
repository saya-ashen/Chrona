import type { PreparedAiFeatureSpec } from "@chrona/contracts";
import type {
  BridgeEnvironment,
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeRequest,
  BridgeResponse,
  BridgeLogger,
  ExecutionResult,
  NDJSONEvent,
  RouteKind,
} from "../shared/types";
import {
  buildFeatureResultFromResponse,
  buildStructuredResult,
  extractOutputText,
} from "../features/feature-contracts";
import {
  parseFunctionItems,
  mapGatewaySseEvent,
  mapUsage,
} from "../parse/gateway-response";
import { summarizeBridgeRequest } from "../parse/requests";
import { routeLabel } from "../parse/routes";
function previewText(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function summarizeHeaders(headers: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization/i.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

const sessionPreviousResponseMap = new Map<string, string>();
const sessionPendingToolOutputMap = new Map<
  string,
  Array<{ type: "function_call_output"; call_id: string; output: string }>
>();

type OpenResponsesTurnState = {
  sessionKey: string;
  previousResponseId?: string;
  pendingToolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }>;
};

function defaultFeatureInstructions(feature: BridgeFeature): string {
  return feature === "chat"
    ? "Answer user request normally."
    : "Return the structured result through tool arguments.";
}

function stringifyFeatureInput(input: Record<string, unknown>): string {
  return JSON.stringify(input);
}

function resolveFeatureSpec(
  request: BridgeFeatureRequest<Record<string, unknown>>,
): PreparedAiFeatureSpec | undefined {
  return request.featureSpec;
}

function resolveFeatureInstructions(
  route: Extract<RouteKind, { kind: "feature" }>,
  request: BridgeFeatureRequest<Record<string, unknown>>,
  featureSpec?: PreparedAiFeatureSpec,
): string {
  return (
    featureSpec?.instructions ??
    request.instructions?.trim() ??
    defaultFeatureInstructions(route.feature)
  );
}

function resolveFeatureInputText(
  request: BridgeFeatureRequest<Record<string, unknown>>,
  featureSpec?: PreparedAiFeatureSpec,
): string {
  return featureSpec?.inputText ?? request.inputText ?? stringifyFeatureInput(request.input);
}

function resolveRequiredTool(
  featureSpec?: PreparedAiFeatureSpec,
): {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} | null {
  return featureSpec?.requiredTool ?? null;
}

function normalizeSessionSegment(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function timestampSessionSegment(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function buildReadableSessionId(route: RouteKind, request: BridgeRequest): string {
  if (route.kind === "feature") {
    const featureRequest = request as BridgeFeatureRequest<Record<string, unknown>>;
    const input = featureRequest.input ?? {};
    const task =
      input.task && typeof input.task === "object" && !Array.isArray(input.task)
        ? (input.task as Record<string, unknown>)
        : input;
    const taskId = typeof task.taskId === "string" ? task.taskId : undefined;
    const title = typeof task.title === "string" ? task.title : undefined;
    return `${normalizeSessionSegment(route.feature, "feature")}-${normalizeSessionSegment(taskId ?? title, "adhoc")}-${timestampSessionSegment()}`;
  }

  const execution = request as BridgeExecutionTaskRequest;
  return `execution-${normalizeSessionSegment(execution.taskId ?? execution.taskTitle, "adhoc")}-${timestampSessionSegment()}`;
}

function resolveSessionId(route: RouteKind, request: BridgeRequest): string {
  return request.sessionId?.trim() || buildReadableSessionId(route, request);
}

function normalizeOpenResponsesSessionKey(
  value: string | undefined,
  fallbackSessionId: string,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallbackSessionId;
}

function resolveOpenResponsesTurnState(
  request: BridgeRequest,
  fallbackSessionId: string,
): OpenResponsesTurnState {
  const requestRecord = request as unknown as Record<string, unknown>;
  const requestedSessionKey =
    typeof requestRecord.sessionKey === "string"
      ? requestRecord.sessionKey
      : undefined;
  const sessionKey = normalizeOpenResponsesSessionKey(
    requestedSessionKey ?? request.sessionId,
    fallbackSessionId,
  );
  return {
    sessionKey,
    previousResponseId: sessionPreviousResponseMap.get(sessionKey),
    pendingToolOutputs: sessionPendingToolOutputMap.get(sessionKey) ?? [],
  };
}

function buildToolAcknowledgementOutput(
  toolCall: { tool: string; input: Record<string, unknown> },
): string {
  return JSON.stringify({
    ok: true,
    message: "Structured tool result accepted.",
    tool: toolCall.tool,
  });
}

function buildToolOutputItems(
  toolCalls: Array<{ callId: string; tool: string; input: Record<string, unknown> }>,
): Array<{ type: "function_call_output"; call_id: string; output: string }> {
  return toolCalls.map((toolCall) => ({
    type: "function_call_output" as const,
    call_id: toolCall.callId,
    output: buildToolAcknowledgementOutput(toolCall),
  }));
}

function shouldAcknowledgeFeatureToolCalls(
  route: RouteKind,
  toolCalls: Array<{ callId: string; tool: string }>,
  toolCallOutputs: Array<{ callId: string }>,
  featureSpec?: PreparedAiFeatureSpec,
): boolean {
  if (route.kind !== "feature") return false;
  const requiredTool = featureSpec?.requiredTool.name;
  if (!requiredTool) return false;
  if (toolCalls.length === 0) return false;
  if (!toolCalls.some((toolCall) => toolCall.tool === requiredTool)) return false;
  const acknowledged = new Set(toolCallOutputs.map((output) => output.callId));
  return toolCalls.some((toolCall) => !acknowledged.has(toolCall.callId));
}

function stringifyExecutionInput(
  execution: BridgeExecutionTaskRequest,
): string {
  const parts: string[] = [];

  if (execution.taskTitle?.trim()) {
    parts.push(`Task title: ${execution.taskTitle.trim()}`);
  }
  if (execution.taskId?.trim()) {
    parts.push(`Task id: ${execution.taskId.trim()}`);
  }
  if (execution.workspaceId?.trim()) {
    parts.push(`Workspace id: ${execution.workspaceId.trim()}`);
  }
  if (execution.runtimeAdapterKey?.trim()) {
    parts.push(`Runtime adapter: ${execution.runtimeAdapterKey.trim()}`);
  }

  const runtimeInput = execution.runtimeInput ?? {};
  if (Object.keys(runtimeInput).length > 0) {
    parts.push(`Runtime input JSON:\n${JSON.stringify(runtimeInput, null, 2)}`);
  }

  parts.push(execution.instructions);
  return parts.join("\n\n");
}

function buildOpenResponsesInput(
  text: string,
  pendingToolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }>,
): Array<{ type: "function_call_output"; call_id: string; output: string } | { type: "input_text"; text: string }> {
  return [
    ...pendingToolOutputs,
    { type: "input_text", text },
  ];
}

export function buildGatewayBody(
  route: RouteKind,
  request: BridgeRequest,
  sessionId: string,
  environment: BridgeEnvironment,
): Record<string, unknown> {
  const { sessionKey, previousResponseId, pendingToolOutputs } = resolveOpenResponsesTurnState(
    request,
    sessionId,
  );

  if (route.kind === "feature") {
    const featureRequest = request as BridgeFeatureRequest<
      Record<string, unknown>
    >;
    const featureSpec = resolveFeatureSpec(featureRequest);
    const featureInstructions = resolveFeatureInstructions(
      route,
      featureRequest,
      featureSpec,
    );
    const featureInputText = resolveFeatureInputText(
      featureRequest,
      featureSpec,
    );
    const body: Record<string, unknown> = {
      model: "openclaw",
      user: sessionKey,
      instructions: `[Structured Feature Request]\nFeature: ${route.feature}\n${featureInstructions}`,
      input: buildOpenResponsesInput(featureInputText, pendingToolOutputs),
      stream: route.stream,
    };

    const requiredTool = resolveRequiredTool(featureSpec);
    if (requiredTool) {
      body.tools = [requiredTool];
      body.tool_choice = featureSpec?.toolChoice ?? "required";
    }

    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    return body;
  }

  const execution = request as BridgeExecutionTaskRequest;
  const executionInputText = stringifyExecutionInput(execution);
  const body: Record<string, unknown> = {
    model: "openclaw",
    input: buildOpenResponsesInput(executionInputText, pendingToolOutputs),
    stream: route.stream,
    max_output_tokens:
      typeof execution.runtimeInput?.maxTokens === "number"
        ? execution.runtimeInput.maxTokens
        : typeof execution.runtimeInput?.maxOutputTokens === "number"
          ? execution.runtimeInput.maxOutputTokens
          : undefined,
  };

  if (execution.instructions.trim()) {
    body.instructions = execution.instructions;
  }
  if (sessionKey) {
    body.user = sessionKey;
  }
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }
  if (environment.model) {
    body.model = environment.model;
  }

  return body;
}

export function gatewayHeaders(
  environment: BridgeEnvironment,
  request?: BridgeRequest,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": environment.agentId,
  };
  if (environment.gatewayToken) {
    headers.Authorization = `Bearer ${environment.gatewayToken}`;
  }
  if (environment.model) {
    headers["x-openclaw-model"] = environment.model;
  }
  if (environment.messageChannel) {
    headers["x-openclaw-message-channel"] = environment.messageChannel;
  }

  const requestRecord = request as Record<string, unknown> | undefined;
  const sessionKey =
    requestRecord && typeof requestRecord.sessionKey === "string"
      ? requestRecord.sessionKey.trim()
      : "";
  if (sessionKey) {
    headers["x-openclaw-session-key"] = sessionKey;
  }

  return headers;
}

export async function checkGatewayAvailable(
  environment: BridgeEnvironment,
): Promise<boolean> {
  try {
    const res = await fetch(`${environment.gatewayHttpUrl}/v1/health`, {
      headers: gatewayHeaders(environment),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function executeGatewayRequest(
  route: RouteKind,
  request: BridgeRequest,
  logger: BridgeLogger,
  environment: BridgeEnvironment,
): Promise<ExecutionResult> {
  const sessionId = resolveSessionId(route, request);
  const { sessionKey, pendingToolOutputs } = resolveOpenResponsesTurnState(request, sessionId);
  const startedAt = Date.now();
  const body = buildGatewayBody(route, request, sessionId, environment);

  const timeoutMs = ((request.timeout ?? 300) + 15) * 1000;
  const headers = gatewayHeaders(environment, request);

  logger.info("bridge.request.start", {
    sessionId,
    sessionKey,
    gateway: environment.gatewayHttpUrl,
    route: routeLabel(route),
    timeoutMs,
    request: summarizeBridgeRequest(route, request),
  });
  logger.debug("bridge.gateway.request", {
    sessionId,
    sessionKey,
    route: routeLabel(route),
    url: `${environment.gatewayHttpUrl}/v1/responses`,
    headers: summarizeHeaders(headers),
    body,
  });

  const response = await fetch(`${environment.gatewayHttpUrl}/v1/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseClone = response.clone();
  const responseText = await responseClone.text().catch(() => "");
  let responseJsonPreview: unknown = null;
  try {
    responseJsonPreview = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJsonPreview = null;
  }

  logger.info("bridge.gateway.response", {
    sessionId,
    sessionKey,
    route: routeLabel(route),
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? null,
    bodyPreview: responseJsonPreview ?? previewText(responseText),
  });

  if (!response.ok) {
    sessionPendingToolOutputMap.delete(sessionKey);
    const errBody = responseText;
    logger.warn("bridge.gateway.response_error", {
      sessionId,
      sessionKey,
      route: routeLabel(route),
      status: response.status,
      contentType: response.headers.get("content-type") ?? null,
      bodyPreview: previewText(errBody),
    });
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
    const gateway = (responseJsonPreview ?? {}) as Record<string, unknown>;
    const responseId = typeof gateway.id === "string" ? gateway.id : undefined;
    if (responseId) sessionPreviousResponseMap.set(sessionKey, responseId);

    const { toolCalls, toolCallOutputs } = parseFunctionItems(gateway);
    const featureSpec =
      route.kind === "feature"
        ? resolveFeatureSpec(request as BridgeFeatureRequest<Record<string, unknown>>)
        : undefined;
    if (pendingToolOutputs.length > 0) {
      sessionPendingToolOutputMap.delete(sessionKey);
    }
    if (
      responseId &&
      shouldAcknowledgeFeatureToolCalls(route, toolCalls, toolCallOutputs, featureSpec)
    ) {
      sessionPendingToolOutputMap.set(sessionKey, buildToolOutputItems(toolCalls));
    }
    const outputText = extractOutputText(gateway);

    let feature = null;
    let semanticError: string | null = null;

    if (route.kind === "feature") {
      const built = buildFeatureResultFromResponse(
        route.feature,
        outputText,
        toolCalls,
        featureSpec,
      );
      feature = built.featureResult;
      semanticError = built.error;
    }

    const bridgeResponse: BridgeResponse = {
      sessionId,
      responseId,
      responseStatus:
        typeof gateway.status === "string" ? gateway.status : undefined,
      runId: responseId,
      output: outputText,
      toolCalls,
      toolCallOutputs,
      usage: mapUsage(gateway),
      error:
        semanticError ?? (gateway.error ? JSON.stringify(gateway.error) : null),
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

      if (
        currentEventType === "response.completed" ||
        currentEventType === "response.failed"
      ) {
        const responseObj =
          data.response &&
          typeof data.response === "object" &&
          !Array.isArray(data.response)
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
    typeof finalGatewayResponse.id === "string"
      ? finalGatewayResponse.id
      : undefined;
  if (responseId) sessionPreviousResponseMap.set(sessionKey, responseId);

  const { toolCalls, toolCallOutputs } =
    parseFunctionItems(finalGatewayResponse);
  const featureSpec =
    route.kind === "feature"
      ? resolveFeatureSpec(request as BridgeFeatureRequest<Record<string, unknown>>)
      : undefined;
  if (pendingToolOutputs.length > 0) {
    sessionPendingToolOutputMap.delete(sessionKey);
  }
  if (
    responseId &&
    shouldAcknowledgeFeatureToolCalls(route, toolCalls, toolCallOutputs, featureSpec)
  ) {
    sessionPendingToolOutputMap.set(sessionKey, buildToolOutputItems(toolCalls));
  }
  const outputText = extractOutputText(finalGatewayResponse);

  let feature = null;
  let semanticError: string | null = null;

  if (route.kind === "feature") {
    const built = buildFeatureResultFromResponse(
      route.feature,
      outputText,
      toolCalls,
      featureSpec,
    );
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
        (finalGatewayResponse.error
          ? JSON.stringify(finalGatewayResponse.error)
          : null),
      feature: route.kind === "feature" ? route.feature : null,
      featurePayload: feature?.payload,
      featureToolName: feature?.toolName ?? null,
      featureSource: feature?.source,
    }),
    feature,
  };

  return { response: bridgeResponse, events };
}
