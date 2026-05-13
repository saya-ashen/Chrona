import type {
  BridgeEnvironment,
  OpenClawGatewayBody,
  OpenClawGatewayInputItem,
  BridgeRequest,
  OpenClawUsage,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "./types";

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

function safeParseJsonArguments(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  return parseJsonObject(value);
}

export function parseFunctionItems(response: Record<string, unknown>): {
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

export function mapUsage(
  response: Record<string, unknown>,
): OpenClawUsage {
  const usage =
    response.usage &&
    typeof response.usage === "object" &&
    !Array.isArray(response.usage)
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

function buildToolAcknowledgementOutput(toolCall: {
  tool: string;
  input: Record<string, unknown>;
}): string {
  return JSON.stringify({
    ok: true,
    message: "Structured tool result accepted.",
    tool: toolCall.tool,
  });
}

function buildToolOutputItems(
  toolCalls: Array<{
    callId: string;
    tool: string;
    input: Record<string, unknown>;
  }>,
): Array<{ type: "function_call_output"; call_id: string; output: string }> {
  return toolCalls.map((toolCall) => ({
    type: "function_call_output",
    call_id: toolCall.callId,
    output: buildToolAcknowledgementOutput(toolCall),
  }));
}

function shouldAcknowledgeFeatureToolCalls(
  request: BridgeRequest,
  toolCalls: Array<{ callId: string; tool: string }>,
  toolCallOutputs: Array<{ callId: string }>,
): boolean {
  const requestedToolName = resolveRequestedFunctionToolName(request);
  if (!requestedToolName) return false;
  if (toolCalls.length === 0) return false;
  if (!toolCalls.some((toolCall) => toolCall.tool === requestedToolName)) {
    return false;
  }
  const acknowledged = new Set(toolCallOutputs.map((output) => output.callId));
  return toolCalls.some((toolCall) => !acknowledged.has(toolCall.callId));
}

export function resolveRequestedFunctionToolName(
  request: BridgeRequest,
): string | undefined {
  return request.structuredOutputSchema?.name;
}

export function commitGatewayTurnState(input: {
  request: BridgeRequest;
  responseId?: string;
  toolCalls: ToolCallInfo[];
  toolCallOutputs: ToolCallOutputInfo[];
}) {
  const { request, responseId, toolCalls, toolCallOutputs } = input;
  const { sessionKey, pendingToolOutputs } = resolveOpenResponsesTurnState(
    request,
    request.sessionId,
  );

  if (responseId) {
    sessionPreviousResponseMap.set(sessionKey, responseId);
  }
  if (pendingToolOutputs.length > 0) {
    sessionPendingToolOutputMap.delete(sessionKey);
  }
  if (
    responseId &&
    shouldAcknowledgeFeatureToolCalls(request, toolCalls, toolCallOutputs)
  ) {
    sessionPendingToolOutputMap.set(
      sessionKey,
      buildToolOutputItems(toolCalls),
    );
  }
}

export function normalizeGatewayHttpUrl(
  url: string,
  sourceName = "gatewayHttpUrl",
): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("ws://")) {
    if (sourceName === "OPENCLAW_GATEWAY_URL") {
      return `http://${trimmed.slice("ws://".length)}`.replace(/\/+$/, "");
    }
    throw new Error(
      `${sourceName} must be an http(s) URL for the Gateway OpenResponses compatibility endpoint, not a ws(s) URL`,
    );
  }
  if (trimmed.startsWith("wss://")) {
    if (sourceName === "OPENCLAW_GATEWAY_URL") {
      return `https://${trimmed.slice("wss://".length)}`.replace(/\/+$/, "");
    }
    throw new Error(
      `${sourceName} must be an http(s) URL for the Gateway OpenResponses compatibility endpoint, not a ws(s) URL`,
    );
  }
  return trimmed.replace(/\/+$/, "");
}

function stringifyGatewayInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function buildGatewayInputItems(input: unknown): OpenClawGatewayInputItem[] {
  if (Array.isArray(input)) {
    return input as OpenClawGatewayInputItem[];
  }
  return [
    {
      type: "message",
      role: "user",
      content: stringifyGatewayInput(input),
    },
  ];
}

export function buildGatewayBody(
  request: BridgeRequest,
  environment: BridgeEnvironment,
): OpenClawGatewayBody {
  const { sessionKey, previousResponseId, pendingToolOutputs } =
    resolveOpenResponsesTurnState(request, request.sessionId);
  const body: OpenClawGatewayBody = {
    instructions: request.instructions,
    input: buildGatewayInputItems(request.input),
    stream: request.stream ?? false,
  };

  if (request.structuredOutputSchema) {
    body.tools = [
      {
        type: "function",
        name: request.structuredOutputSchema.name,
        description: request.structuredOutputSchema.description,
        parameters: request.structuredOutputSchema.schema,
      },
    ];
    // HACK: openclaw的协议有误，这里直接使用"auto"代替
    body.tool_choice = "auto";
  }
  if (typeof request.maxOutputTokens === "number") {
    body.max_output_tokens = request.maxOutputTokens;
  }

  if (pendingToolOutputs.length > 0) {
    const input = Array.isArray(body.input) ? body.input : [];
    body.input = [...pendingToolOutputs, ...input];
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
