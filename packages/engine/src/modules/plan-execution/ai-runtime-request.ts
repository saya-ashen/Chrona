import { z } from "zod";
import {
  providerRunInputSchema,
  providerStructuredOutputSchemaSchema,
  type ProviderRunInput,
  type ProviderRunSnapshot,
  type StartRunInput,
} from "@chrona/providers-foundation";

export type ExecutionProviderRequest = {
  provider: string;
  clientOperationId: string;
  sessionId: string;
  sessionKey: string;
  instructions: string;
  input: ProviderRunInput;
  structuredOutputSchema?: StartRunInput["structuredOutputSchema"];
  terminalToolName?: string;
  toolPolicy: "full" | "read_only";
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  resumeSessionRef?: string;
  runtimeConfiguration?: {
    model?: string;
    contextStrategy?: "provider_default" | "auto_compact" | "bounded_tool_results" | "artifact_backed";
  };
};

const executionProviderRequestSchema = z.object({
  provider: z.string().trim().min(1).max(128),
  clientOperationId: z.string().trim().min(1).max(512),
  sessionId: z.string().trim().min(1).max(512),
  sessionKey: z.string().trim().min(1).max(512),
  instructions: z.string().trim().min(1).max(100_000),
  input: providerRunInputSchema,
  terminalToolName: z.string().trim().min(1).max(128).optional(),
  toolPolicy: z.enum(["full", "read_only"]),
  maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
  timeoutSeconds: z.number().positive().max(3_600).optional(),
  resumeSessionRef: z.string().trim().min(1).max(512).optional(),
  runtimeConfiguration: z.object({
    model: z.string().trim().min(1).max(512).optional(),
    contextStrategy: z.enum(["provider_default", "auto_compact", "bounded_tool_results", "artifact_backed"]).optional(),
  }).strict().optional(),
  structuredOutputSchema: providerStructuredOutputSchemaSchema.optional(),
}).strict();

export function createExecutionProviderRequest(input: ExecutionProviderRequest): ExecutionProviderRequest {
  return executionProviderRequestSchema.parse(input);
}

export function toStartRunInput(request: ExecutionProviderRequest): StartRunInput {
  return {
    clientOperationId: request.clientOperationId,
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input,
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
  const structured = parsedPayload(response.structuredPayload);
  if (typeof structured === "string") return structured.trim() || null;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const record = structured as Record<string, unknown>;
  const value = record.output ?? record.summary;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : JSON.stringify(record);
}

function parsedPayload(structured: unknown): unknown {
  const envelope = z.object({ ok: z.literal(true), parsed: z.unknown() }).passthrough().safeParse(structured);
  return envelope.success ? envelope.data.parsed : null;
}
