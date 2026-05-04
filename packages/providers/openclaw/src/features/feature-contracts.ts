import type {
  BridgeFeature,
  BridgeFeatureResult,
  StructuredAgentResult,
  ToolCallInfo,
} from "../shared/types";
import type { PreparedAiFeatureSpec } from "@chrona/contracts";
import { validatePreparedFeaturePayload } from "@chrona/contracts";

function validateFeaturePayload(
  payload: unknown,
  featureSpec: PreparedAiFeatureSpec,
): { ok: true } | { ok: false; error: string } {
  return validatePreparedFeaturePayload(featureSpec, payload);
}

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
  featureSpec?: PreparedAiFeatureSpec,
): { featureResult: BridgeFeatureResult | null; error: string | null } {
  const requiredTool = featureSpec?.requiredTool.name;
  if (requiredTool) {
    const matching = [...toolCalls].reverse().find((call) => call.tool === requiredTool);
    if (matching) {
      const payloadValidation = validateFeaturePayload(matching.input, featureSpec);
      if (!payloadValidation.ok) {
        return {
          featureResult: null,
          error: payloadValidation.error,
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

    return {
      featureResult: null,
      error: `Feature '${feature}' requires business tool call '${requiredTool}' but none was found in the response`,
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

  if (!featureSpec) {
    return {
      featureResult: null,
      error: `Feature '${feature}' requires a prepared feature specification but none was provided`,
    };
  }

  return {
    featureResult: null,
    error: `Feature '${feature}' requires a business tool result but none was found in the response`,
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
