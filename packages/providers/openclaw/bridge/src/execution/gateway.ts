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

export function gatewayHeaders(
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": environment.agentId,
  };
  if (environment.gatewayToken) {
    headers.Authorization = `Bearer ${environment.gatewayToken}`;
  }
  return headers;
}

export async function checkGatewayAvailable(
  environment: BridgeEnvironment = DEFAULT_BRIDGE_ENVIRONMENT,
): Promise<boolean> {
  try {
    const res = await fetch(`${environment.gatewayUrl}/v1/health`, {
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
  const startedAt = Date.now();
  const body = buildGatewayBody(route, request, sessionId);

  logger.info("bridge.request.start", {
    sessionId,
    gateway: environment.gatewayUrl,
    request: summarizeBridgeRequest(route, request),
  });

  const timeoutMs = ((request.timeout ?? 300) + 15) * 1000;
  const response = await fetch(`${environment.gatewayUrl}/v1/responses`, {
    method: "POST",
    headers: gatewayHeaders(environment),
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
  if (responseId) sessionPreviousResponseMap.set(sessionId, responseId);

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
