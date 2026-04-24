import {
  DEFAULT_BRIDGE_ENVIRONMENT,
  FEATURE_FUNCTION_TOOL,
  FUNCTION_TOOL_SCHEMAS,
} from "../shared/constants";
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
import { buildFeatureResultFromResponse, buildStructuredResult, extractOutputText } from "../features/feature-contracts";
import { parseFunctionItems, mapGatewaySseEvent, mapUsage } from "../parse/gateway-response";
import { summarizeBridgeRequest } from "../parse/requests";
import { routeLabel } from "../parse/routes";
import { toErrorMessage } from "../shared/json";

const sessionPreviousResponseMap = new Map<string, string>();

type OpenResponsesTurnState = {
  sessionKey: string;
  previousResponseId?: string;
};

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

function normalizeOpenResponsesSessionKey(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : crypto.randomUUID();
}

function resolveOpenResponsesTurnState(
  request: BridgeRequest,
  fallbackSessionId: string,
): OpenResponsesTurnState {
  const requestRecord = request as Record<string, unknown>;
  const requestedSessionKey =
    typeof requestRecord.sessionKey === "string" ? requestRecord.sessionKey : undefined;
  const sessionKey = normalizeOpenResponsesSessionKey(
    requestedSessionKey ?? request.sessionId ?? fallbackSessionId,
  );
  return {
    sessionKey,
    previousResponseId: sessionPreviousResponseMap.get(sessionKey),
  };
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

export function buildGatewayBody(
  route: RouteKind,
  request: BridgeRequest,
  sessionId: string,
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
): Record<string, unknown> {
  const { sessionKey, previousResponseId } = resolveOpenResponsesTurnState(
    request,
    sessionId,
  );

  if (route.kind === "feature") {
    const featureRequest = request as BridgeFeatureRequest<Record<string, unknown>>;
    const requiredTool = FEATURE_FUNCTION_TOOL[route.feature];
    const body: Record<string, unknown> = {
      model: "openclaw",
      user: sessionKey,
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
    model: "openclaw",
    input: stringifyExecutionInput(execution),
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
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
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

  const requestRecord = request as (Record<string, unknown> | undefined);
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
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
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

export function statusForResponse(route: RouteKind, response: BridgeResponse): number {
  if (!response.error) {
    return 200;
  }
  if (route.kind === "feature") {
    return 422;
  }
  return 500;
}

export async function executeGatewayRequest(
  route: RouteKind,
  request: BridgeRequest,
  logger: BridgeLogger,
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
): Promise<ExecutionResult> {
  const sessionId = request.sessionId ?? crypto.randomUUID();
  const { sessionKey } = resolveOpenResponsesTurnState(request, sessionId);
  const startedAt = Date.now();
  const body = buildGatewayBody(route, request, sessionId, environment);

  logger.info("bridge.request.start", {
    sessionId,
    gateway: environment.gatewayHttpUrl,
    request: summarizeBridgeRequest(route, request),
  });

  const timeoutMs = ((request.timeout ?? 300) + 15) * 1000;
  const response = await fetch(`${environment.gatewayHttpUrl}/v1/responses`, {
    method: "POST",
    headers: gatewayHeaders(environment, request),
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
    if (responseId) sessionPreviousResponseMap.set(sessionKey, responseId);

    const { toolCalls, toolCallOutputs } = parseFunctionItems(gateway);
    const outputText = extractOutputText(gateway);

    let feature = null;
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

      if (currentEventType === "response.completed" || currentEventType === "response.failed") {
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
  if (responseId) sessionPreviousResponseMap.set(sessionKey, responseId);

  const { toolCalls, toolCallOutputs } = parseFunctionItems(finalGatewayResponse);
  const outputText = extractOutputText(finalGatewayResponse);

  let feature = null;
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

export function resetBridgeSessions(): void {
  sessionPreviousResponseMap.clear();
}

export function executionErrorData(
  route: RouteKind,
  request: BridgeRequest,
  error: unknown,
): Record<string, unknown> {
  return {
    route: routeLabel(route),
    request: summarizeBridgeRequest(route, request),
    error: toErrorMessage(error),
  };
}
