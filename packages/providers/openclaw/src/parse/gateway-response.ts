import type {
  BridgeResponse,
  NDJSONEvent,
  ToolCallInfo,
  ToolCallOutputInfo,
} from "../shared/types";
import { safeParseJsonArguments } from "../shared/json";

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

export function mapUsage(response: Record<string, unknown>): BridgeResponse["usage"] {
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

export function mapGatewaySseEvent(
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
