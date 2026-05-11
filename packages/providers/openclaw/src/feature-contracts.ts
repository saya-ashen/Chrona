import type { StructuredAgentResult, ToolCallInfo } from "./types";

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

export function buildStructuredResult(params: {
  sessionId: string;
  runId?: string;
  toolCalls: ToolCallInfo[];
  output: string;
  error: string | null;
  requestedToolName?: string;
}): StructuredAgentResult | null {
  if (!params.requestedToolName) {
    return null;
  }

  const matching = [...params.toolCalls]
    .reverse()
    .find((toolCall) => toolCall.tool === params.requestedToolName);

  if (matching) {
    return {
      ok: true,
      parsed: matching.input,
      source: "business_tool",
      toolName: matching.tool,
      rawOutput: params.output,
      error: params.error,
      validationIssues: [],
      sessionId: params.sessionId,
      runId: params.runId,
    };
  }

  return {
    ok: false,
    parsed: null,
    toolName: params.requestedToolName,
    rawOutput: params.output,
    error:
      params.error ??
      `Required tool '${params.requestedToolName}' was not returned by OpenClaw`,
    validationIssues: [],
    sessionId: params.sessionId,
    runId: params.runId,
  };
}
