import type {
  BridgeFeature,
  BridgeFeatureResult,
  StructuredAgentResult,
  ToolCallInfo,
} from "../shared/types";
import { FEATURE_FUNCTION_TOOL } from "../shared/constants";
import { parseJsonObject } from "../shared/json";

export function extractOutputText(response: Record<string, unknown>): string {
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

export function buildFeatureResultFromResponse(
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

export function buildStructuredResult(params: {
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
