import type { PreparedAiFeatureSpec } from "@chrona/contracts/ai";
import type {
  ProviderRunInput,
  ProviderRunSnapshot,
  StartRunInput,
} from "@chrona/providers-foundation";

export type ExecutionProviderRequest = {
  sessionId: string;
  sessionKey: string;
  instructions: string;
  input: unknown;
  structuredOutputSchema?: PreparedAiFeatureSpec["structuredOutputSchema"];
  terminalToolName?: string;
  toolPolicy?: "full" | "read_only";
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  resumeSessionRef?: string;
  runtimeConfiguration?: {
    model?: string;
    contextStrategy?: "provider_default" | "auto_compact" | "bounded_tool_results" | "artifact_backed";
  };
};

export function buildExecutionGatewayRequest(input: {
  instructions: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
  sessionKey: string;
  sessionId: string;
  executionRuntime: string;
  resumeSessionRef?: string;
}): ExecutionProviderRequest {
  const maxTokens = input.runtimeInput.maxTokens ?? input.runtimeInput.maxOutputTokens;
  return {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    instructions: input.featureSpec.instructions,
    input: buildExecutionAiInput(input),
    structuredOutputSchema: input.featureSpec.structuredOutputSchema,
    terminalToolName: input.featureSpec.terminalToolName,
    toolPolicy: readOnlyFeature(input.featureSpec.feature) ? "read_only" : "full",
    maxOutputTokens: typeof maxTokens === "number" ? maxTokens : undefined,
    ...(input.resumeSessionRef ? { resumeSessionRef: input.resumeSessionRef } : {}),
  };
}

function readOnlyFeature(feature: PreparedAiFeatureSpec["feature"]): boolean {
  return feature === "goal.review" || feature === "goal.asset_ownership" || feature === "task.result_finalization";
}

function buildExecutionAiInput(input: {
  executionRuntime: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
}): string | Record<string, unknown> {
  if (passthroughRuntimeInput(input.featureSpec.feature)) return input.runtimeInput;
  return { executionRuntime: input.executionRuntime, runtimeInput: input.runtimeInput };
}

function passthroughRuntimeInput(feature: PreparedAiFeatureSpec["feature"]): boolean {
  return feature === "execute_task_node" || feature === "evaluate_condition_node" || feature === "review_checkpoint_node" || feature === "goal.review" || feature === "task.result_finalization";
}

export function toStartRunInput(request: ExecutionProviderRequest): StartRunInput {
  return {
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input as ProviderRunInput,
    maxOutputTokens: request.maxOutputTokens,
    terminalToolName: request.terminalToolName,
    structuredOutputSchema: request.structuredOutputSchema,
    toolPolicy: request.toolPolicy,
    runtimeConfiguration: request.runtimeConfiguration,
    ...(request.resumeSessionRef ? { resumeSessionRef: request.resumeSessionRef } : {}),
    timeoutMs: request.timeoutSeconds ? request.timeoutSeconds * 1000 : undefined,
    stream: true,
  };
}

export function extractAssistantContent(response: ProviderRunSnapshot): string | null {
  const output = response.outputText?.trim();
  if (output) return output;
  return extractStructuredAssistantContent(response.structuredPayload);
}

function extractStructuredAssistantContent(structured: unknown): string | null {
  const parsed = parsedPayload(structured);
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return extractRecordContent(parsed as Record<string, unknown>);
}

function parsedPayload(structured: unknown): unknown {
  if (!structured || typeof structured !== "object" || !("ok" in structured) || !structured.ok) return null;
  return (structured as { parsed?: unknown }).parsed;
}

function extractRecordContent(record: Record<string, unknown>): string {
  const output = stringValue(record.output) ?? stringValue(record.summary);
  return output ?? JSON.stringify(record);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
