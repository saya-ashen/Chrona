import type {
  BridgeExecutionTaskRequest,
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeRequest,
  BridgeResponse,
} from "../transport/bridge-types";
import {
  DEFAULT_OPENCLAW_ENVIRONMENT,
  FEATURE_FUNCTION_TOOL,
  FUNCTION_TOOL_SCHEMAS,
} from "./constants";
import {
  buildFeatureResultFromResponse,
  buildStructuredResult,
  extractOutputText,
} from "./feature-contracts";
import {
  mapGatewaySseEvent,
  mapUsage,
  parseFunctionItems,
} from "./gateway-response";
import { toErrorMessage } from "./json";
import type {
  BridgeEnvironment,
  BridgeLogger,
  ExecutionResult,
  RouteKind,
} from "./types";
export type { BridgeEnvironment, BridgeLogger, ExecutionResult, RouteKind } from "./types";
export { DEFAULT_OPENCLAW_ENVIRONMENT } from "./constants";

function previewText(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function summarizeToolCalls(
  toolCalls: Array<{
    tool: string;
    callId: string;
    input: Record<string, unknown>;
    result?: string;
    status?: string;
  }>,
): Array<Record<string, unknown>> {
  return toolCalls.map((toolCall) => ({
    tool: toolCall.tool,
    callId: toolCall.callId,
    status: toolCall.status ?? null,
    inputPreview: previewText(JSON.stringify(toolCall.input ?? {}), 240),
    resultPreview:
      typeof toolCall.result === "string"
        ? previewText(toolCall.result, 240)
        : null,
  }));
}

function summarizeToolCallOutputs(
  toolCallOutputs: Array<{
    callId: string;
    output: unknown;
  }>,
): Array<Record<string, unknown>> {
  return toolCallOutputs.map((toolCallOutput) => ({
    callId: toolCallOutput.callId,
    outputPreview:
      typeof toolCallOutput.output === "string"
        ? previewText(toolCallOutput.output, 240)
        : toolCallOutput.output == null
          ? null
          : previewText(JSON.stringify(toolCallOutput.output), 240),
  }));
}

const sessionPreviousResponseMap = new Map<string, string>();
const sessionPendingToolOutputMap = new Map<
  string,
  Array<{ type: "function_call_output"; call_id: string; output: string }>
>();

type OpenResponsesTurnState = {
  sessionKey: string;
  previousResponseId?: string;
  pendingToolOutputs: Array<{
    type: "function_call_output";
    call_id: string;
    output: string;
  }>;
};

export const noopBridgeLogger: BridgeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function routeLabel(route: RouteKind): string {
  return route.kind === "feature"
    ? `${route.feature}${route.stream ? ":stream" : ""}`
    : `execution${route.stream ? ":stream" : ""}`;
}

function summarizeBridgeRequest(
  route: RouteKind,
  request: BridgeRequest,
): Record<string, unknown> {
  const requestRecord = request as unknown as Record<string, unknown>;
  return {
    route: routeLabel(route),
    sessionId: request.sessionId ?? null,
    sessionKey:
      typeof requestRecord.sessionKey === "string"
        ? requestRecord.sessionKey
        : null,
    timeout: request.timeout ?? null,
  };
}

function defaultFeatureInstructions(feature: BridgeFeature): string {
  switch (feature) {
    case "suggest":
      return "Return suggestions only via function call suggest_task_completions.";
    case "generate_plan":
      return [
        "You are Chrona's task planning assistant.",
        "Your job is to immediately create a practical execution plan graph from the current task snapshot only.",
        "Do not ask follow-up questions, do not request more context, and do not answer with free text.",
        "Make reasonable assumptions when details are sparse.",
        "Call generate_task_plan_graph exactly once with a complete graph payload.",
        "The graph payload must include summary, nodes, and edges.",
      ].join("\n");
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

function toolDescription(toolName: string): string {
  if (toolName === "generate_task_plan_graph") {
    return [
      "Create and persist the Chrona task plan graph for the provided task snapshot.",
      "Return a complete graph with summary, nodes, and edges; do not ask follow-up questions.",
    ].join(" ");
  }

  return `Chrona structured feature tool: ${toolName}`;
}

function stringifyFeatureInput(
  feature: BridgeFeature,
  input: Record<string, unknown>,
): string {
  if (feature !== "generate_plan") {
    return JSON.stringify(input);
  }

  const task =
    input.task && typeof input.task === "object" && !Array.isArray(input.task)
      ? (input.task as Record<string, unknown>)
      : input;
  const parts: string[] = [
    "Create an execution-ready plan graph for the task below.",
    "Use only the information provided in this message. Do not ask follow-up questions.",
    "Make reasonable assumptions if the task is underspecified, and directly call generate_task_plan_graph.",
    "",
    "Task to plan",
  ];

  if (typeof task.title === "string" && task.title.trim()) {
    parts.push(`Title: ${task.title.trim()}`);
  }
  if (typeof task.description === "string" && task.description.trim()) {
    parts.push(`Description: ${task.description.trim()}`);
  }
  const estimatedDuration =
    typeof task.estimatedDurationMinutes === "number"
      ? task.estimatedDurationMinutes
      : typeof task.estimatedMinutes === "number"
        ? task.estimatedMinutes
        : null;
  if (estimatedDuration !== null) {
    parts.push(`Estimated duration: ${estimatedDuration} minutes`);
  }

    parts.push(
      "",
      "Output requirements",
      "- Call generate_task_plan_graph exactly once.",
      "- Include summary, nodes, and edges as top-level fields.",
      "- For each node, include id, type, title, objective, and estimatedMinutes when possible.",
      "- For each node, explicitly set executor to either 'human' or 'automation'.",
      "- Use executor='automation' ONLY when the node can be completed entirely in software without human input, approval, payment, travel, pickup, waiting, or other manual action.",
      "- Use executor='human' for approvals, choices, clarification, communication, payment, pickup, travel, waiting, receiving items, and any physical/manual action.",
      "- Do NOT emit executionMode, autoRunnable, blockingReason, status, linkedTaskId, or completionSummary; Chrona derives them.",
      "- Use type=user_input for human clarification/input, decision for approval/choice gates, and tool_action only for truly automatable actions.",
      "- Do not return prose instead of the tool call.",
    );

  return parts.join("\n");
}

function normalizeSessionSegment(
  value: string | undefined,
  fallback: string,
): string {
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
  route: RouteKind,
  toolCall: { tool: string; input: Record<string, unknown> },
): string {
  if (route.kind === "feature" && route.feature === "generate_plan") {
    const nodes = Array.isArray(toolCall.input.nodes) ? toolCall.input.nodes.length : 0;
    const edges = Array.isArray(toolCall.input.edges) ? toolCall.input.edges.length : 0;
    return JSON.stringify({
      ok: true,
      message: "Chrona accepted the generated task plan graph.",
      tool: toolCall.tool,
      nodes,
      edges,
    });
  }

  return JSON.stringify({
    ok: true,
    message: "Chrona accepted the structured tool result.",
    tool: toolCall.tool,
  });
}

function buildToolOutputItems(
  route: RouteKind,
  toolCalls: Array<{
    callId: string;
    tool: string;
    input: Record<string, unknown>;
  }>,
): Array<{ type: "function_call_output"; call_id: string; output: string }> {
  return toolCalls.map((toolCall) => ({
    type: "function_call_output" as const,
    call_id: toolCall.callId,
    output: buildToolAcknowledgementOutput(route, toolCall),
  }));
}

function shouldAcknowledgeFeatureToolCalls(
  route: RouteKind,
  toolCalls: Array<{ callId: string; tool: string }>,
  toolCallOutputs: Array<{ callId: string }>,
): boolean {
  if (route.kind !== "feature") return false;
  const requiredTool = FEATURE_FUNCTION_TOOL[route.feature];
  if (!requiredTool) return false;
  if (toolCalls.length === 0) return false;
  if (!toolCalls.some((toolCall) => toolCall.tool === requiredTool)) return false;
  const acknowledged = new Set(toolCallOutputs.map((output) => output.callId));
  return toolCalls.some((toolCall) => !acknowledged.has(toolCall.callId));
}

function stringifyExecutionInput(execution: BridgeExecutionTaskRequest): string {
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

export function buildGatewayBody(
  route: RouteKind,
  request: BridgeRequest,
  sessionId: string,
  environment: BridgeEnvironment = DEFAULT_OPENCLAW_ENVIRONMENT,
): Record<string, unknown> {
  const { sessionKey, previousResponseId, pendingToolOutputs } =
    resolveOpenResponsesTurnState(request, sessionId);

  if (route.kind === "feature") {
    const featureRequest = request as BridgeFeatureRequest<Record<string, unknown>>;
    const requiredTool = FEATURE_FUNCTION_TOOL[route.feature];
    const featureInstructions =
      featureRequest.instructions?.trim() ||
      defaultFeatureInstructions(route.feature);
    const body: Record<string, unknown> = {
      model: "openclaw",
      user: sessionKey,
      instructions: `[Chrona Feature Request]\nFeature: ${route.feature}\n${featureInstructions}`,
      input:
        pendingToolOutputs.length > 0
          ? [
              ...pendingToolOutputs,
              stringifyFeatureInput(route.feature, featureRequest.input),
            ]
          : stringifyFeatureInput(route.feature, featureRequest.input),
      stream: route.stream,
    };

    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    if (requiredTool) {
      body.tools = [
        {
          type: "function",
          name: requiredTool,
          description: toolDescription(requiredTool),
          parameters: FUNCTION_TOOL_SCHEMAS[requiredTool],
        },
      ];
      body.tool_choice = "required";
    }

    return body;
  }

  const execution = request as BridgeExecutionTaskRequest;
  const body: Record<string, unknown> = {
    model: "openclaw",
    input:
      pendingToolOutputs.length > 0
        ? [...pendingToolOutputs, stringifyExecutionInput(execution)]
        : stringifyExecutionInput(execution),
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
  environment: BridgeEnvironment = DEFAULT_OPENCLAW_ENVIRONMENT,
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

  const requestRecord = request as unknown as Record<string, unknown> | undefined;
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
  environment: BridgeEnvironment = DEFAULT_OPENCLAW_ENVIRONMENT,
): Promise<boolean> {
  try {
    const res = await fetch(`${environment.gatewayHttpUrl}/health`, {
      headers: gatewayHeaders(environment),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return false;
    }

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; status?: string }
      | null;

    return body?.ok === true && body.status === "live";
  } catch {
    return false;
  }
}

export async function executeGatewayRequest(
  route: RouteKind,
  request: BridgeRequest,
  logger: BridgeLogger = noopBridgeLogger,
  environment: BridgeEnvironment = DEFAULT_OPENCLAW_ENVIRONMENT,
): Promise<ExecutionResult> {
  const sessionId = resolveSessionId(route, request);
  const { sessionKey, pendingToolOutputs } = resolveOpenResponsesTurnState(
    request,
    sessionId,
  );
  const startedAt = Date.now();
  const body = buildGatewayBody(route, request, sessionId, environment);

  const timeoutMs = ((request.timeout ?? 300) + 15) * 1000;
  const headers = gatewayHeaders(environment, request);

  logger.info("openclaw.request.start", {
    sessionId,
    sessionKey,
    gateway: environment.gatewayHttpUrl,
    route: routeLabel(route),
    timeoutMs,
    request: summarizeBridgeRequest(route, request),
  });

  let response: Response;
  try {
    response = await fetch(`${environment.gatewayHttpUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Gateway request failed: ${toErrorMessage(error)}`);
  }

  const responseClone = response.clone();
  const responseText = await responseClone.text().catch(() => "");
  let responseJsonPreview: unknown = null;
  try {
    responseJsonPreview = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJsonPreview = null;
  }

  logger.info("openclaw.gateway.response", {
    sessionId,
    sessionKey,
    route: routeLabel(route),
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? null,
    bodyPreview: responseJsonPreview ?? previewText(responseText),
  });

  if (!response.ok) {
    const errBody = responseText;
    const detailedError = `Gateway /v1/responses failed (${response.status}): ${errBody.slice(0, 1200)}`;
    const bridgeResponse: BridgeResponse = {
      sessionId,
      output: "",
      toolCalls: [],
      toolCallOutputs: [],
      usage: null,
      error: detailedError,
      durationMs: Date.now() - startedAt,
      structured: buildStructuredResult({
        sessionId,
        output: "",
        toolCalls: [],
        error: detailedError,
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
    if (pendingToolOutputs.length > 0) {
      sessionPendingToolOutputMap.delete(sessionKey);
    }
    if (
      responseId &&
      shouldAcknowledgeFeatureToolCalls(route, toolCalls, toolCallOutputs)
    ) {
      sessionPendingToolOutputMap.set(
        sessionKey,
        buildToolOutputItems(route, toolCalls),
      );
    }

    const outputText = extractOutputText(gateway);
    let feature = null;
    let semanticError: string | null = null;

    if (route.kind === "feature") {
      const built = buildFeatureResultFromResponse(
        route.feature,
        outputText,
        toolCalls,
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
      error: semanticError ?? (gateway.error ? JSON.stringify(gateway.error) : null),
      durationMs: Date.now() - startedAt,
      structured: buildStructuredResult({
        sessionId,
        runId: responseId,
        output: outputText,
        toolCalls,
        error: semanticError ?? (gateway.error ? JSON.stringify(gateway.error) : null),
        feature: route.kind === "feature" ? route.feature : null,
        featurePayload: feature?.payload,
        featureToolName: feature?.toolName ?? null,
        featureSource: feature?.source,
      }),
      feature,
    };
    logger.info("openclaw.gateway.parsed", {
      sessionId,
      sessionKey,
      route: routeLabel(route),
      responseId,
      responseStatus: bridgeResponse.responseStatus ?? null,
      semanticError,
      outputPreview: previewText(outputText, 400),
      toolCalls: summarizeToolCalls(toolCalls),
      toolCallOutputs: summarizeToolCallOutputs(toolCallOutputs),
      structured: bridgeResponse.structured
        ? {
            ok: bridgeResponse.structured.ok,
            error: bridgeResponse.structured.error,
            feature: bridgeResponse.structured.feature ?? null,
            toolName: bridgeResponse.structured.toolName ?? null,
            source: bridgeResponse.structured.source ?? null,
          }
        : null,
    });
    return { response: bridgeResponse, events: [] };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Stream response missing body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";
  let finalGatewayResponse: Record<string, unknown> | null = null;
  const events = [] as ExecutionResult["events"];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;

      const raw = line.slice(6).trim();
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (
          currentEventType === "response.completed" ||
          currentEventType === "response.failed"
        ) {
          finalGatewayResponse =
            data.response &&
            typeof data.response === "object" &&
            !Array.isArray(data.response)
              ? (data.response as Record<string, unknown>)
              : data;
        }

        const mapped = mapGatewaySseEvent(currentEventType, data, sessionId);
        if (mapped) {
          events.push(mapped);
        }
      } catch {
        // ignore malformed chunks
      }

      currentEventType = "";
    }
  }

  if (!finalGatewayResponse) {
    throw new Error("Gateway stream completed without terminal response payload");
  }

  const responseId =
    typeof finalGatewayResponse.id === "string" ? finalGatewayResponse.id : undefined;
  if (responseId) sessionPreviousResponseMap.set(sessionKey, responseId);

  const { toolCalls, toolCallOutputs } = parseFunctionItems(finalGatewayResponse);
  if (pendingToolOutputs.length > 0) {
    sessionPendingToolOutputMap.delete(sessionKey);
  }
  if (
    responseId &&
    shouldAcknowledgeFeatureToolCalls(route, toolCalls, toolCallOutputs)
  ) {
    sessionPendingToolOutputMap.set(
      sessionKey,
      buildToolOutputItems(route, toolCalls),
    );
  }

  const outputText = extractOutputText(finalGatewayResponse);
  let feature = null;
  let semanticError: string | null = null;

  if (route.kind === "feature") {
    const built = buildFeatureResultFromResponse(
      route.feature,
      outputText,
      toolCalls,
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
      (finalGatewayResponse.error ? JSON.stringify(finalGatewayResponse.error) : null),
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

  logger.info("openclaw.gateway.parsed", {
    sessionId,
    sessionKey,
    route: routeLabel(route),
    responseId,
    responseStatus: bridgeResponse.responseStatus ?? null,
    semanticError,
    outputPreview: previewText(outputText, 400),
    toolCalls: summarizeToolCalls(toolCalls),
    toolCallOutputs: summarizeToolCallOutputs(toolCallOutputs),
    structured: bridgeResponse.structured
      ? {
          ok: bridgeResponse.structured.ok,
          error: bridgeResponse.structured.error,
          feature: bridgeResponse.structured.feature ?? null,
          toolName: bridgeResponse.structured.toolName ?? null,
          source: bridgeResponse.structured.source ?? null,
        }
      : null,
    eventCount: events.length,
  });

  return { response: bridgeResponse, events };
}

export function resetOpenClawProviderSessions(): void {
  sessionPreviousResponseMap.clear();
  sessionPendingToolOutputMap.clear();
}
