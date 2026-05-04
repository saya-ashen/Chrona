import type {
  BridgeFeature,
  BridgeFeatureResult,
  StructuredAgentResult,
  ToolCallInfo,
} from "../shared/types";
import { FEATURE_FUNCTION_TOOL } from "../shared/constants";
import { validateAIPlanOutput } from "@chrona/contracts/ai";

function validateFeaturePayload(
  feature: BridgeFeature,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: `Feature '${feature}' returned an invalid payload` };
  }

  if (feature === "generate_plan") {
    const validation = validateAIPlanOutput(payload);
    if (!validation.valid.title || !validation.valid.goal || validation.valid.nodes.length === 0) {
      return {
        ok: false,
        error: validation.warnings[0] ?? "Feature 'generate_plan' payload does not match AIPlanOutput",
      };
    }
  }

  if (feature === "conflicts") {
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.conflicts)) {
      return { ok: false, error: "Feature 'conflicts' payload.conflicts must be an array" };
    }
    if (!Array.isArray(record.resolutions)) {
      return { ok: false, error: "Feature 'conflicts' payload.resolutions must be an array" };
    }
    if (typeof record.summary !== "string") {
      return { ok: false, error: "Feature 'conflicts' payload.summary must be a string" };
    }
  }

  if (feature === "timeslots") {
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.slots)) {
      return { ok: false, error: "Feature 'timeslots' payload.slots must be an array" };
    }
    if (record.reasoning !== undefined && typeof record.reasoning !== "string") {
      return { ok: false, error: "Feature 'timeslots' payload.reasoning must be a string when provided" };
    }
  }

  return { ok: true };
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
): { featureResult: BridgeFeatureResult | null; error: string | null } {
  const requiredTool = FEATURE_FUNCTION_TOOL[feature];
  if (requiredTool) {
    const matching = [...toolCalls].reverse().find((call) => call.tool === requiredTool);
    if (matching) {
      const payloadValidation = validateFeaturePayload(feature, matching.input);
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
