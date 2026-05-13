import { z } from "zod";

const unknownRecordSchema = z.record(z.string(), z.unknown());

export const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const providerStructuredOutputSchemaSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    schema: unknownRecordSchema,
  })
  .strict();

export const providerToolOutputSchema = z
  .object({
    callId: z.string().min(1),
    output: z.unknown(),
  })
  .strict();

export const providerCapabilitiesSchema = z
  .object({
    supportsSessions: z.boolean(),
    supportsStreaming: z.boolean(),
    supportsRunLookup: z.boolean(),
    supportsCancellation: z.boolean(),
    supportsToolCalls: z.boolean(),
    supportsPreviousResponse: z.boolean(),
  })
  .strict();

export const healthCheckInputSchema = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
    signal: z.custom<AbortSignal>().optional(),
  })
  .strict();

export const providerHealthSchema = z
  .object({
    provider: z.string().min(1),
    ok: z.boolean(),
    checkedAt: z.string().datetime(),
    latencyMs: z.number().int().nonnegative().optional(),
    status: z.number().int().optional(),
    message: z.string().optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const createSessionInputSchema = z
  .object({
    sessionKey: z.string().min(1).optional(),
    metadata: unknownRecordSchema.optional(),
    signal: z.custom<AbortSignal>().optional(),
  })
  .strict();

export const providerSessionRefSchema = z
  .object({
    provider: z.string().min(1),
    sessionId: z.string().min(1),
    nativeSessionId: z.string().min(1).optional(),
    sessionKey: z.string().min(1).optional(),
    createdAt: z.string().datetime().optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const startRunInputSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionKey: z.string().min(1).optional(),
    instructions: z.string().min(1),
    input: z.unknown(),
    structuredOutputSchema: providerStructuredOutputSchemaSchema.optional(),
    previousRunId: z.string().min(1).optional(),
    previousResponseId: z.string().min(1).optional(),
    toolOutputs: z.array(providerToolOutputSchema).optional(),
    model: z.string().min(1).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    signal: z.custom<AbortSignal>().optional(),
    metadata: unknownRecordSchema.optional(),
  })
  .strict();

export const providerRunStatusSchema = z.enum([
  "pending",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "failed",
  "completed",
  "cancelled",
]);

export const providerRunRefSchema = z
  .object({
    provider: z.string().min(1),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    nativeRunId: z.string().min(1).optional(),
    status: providerRunStatusSchema.optional(),
    responseId: z.string().min(1).optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const streamRunInputSchema = startRunInputSchema.extend({
  stream: z.literal(true).optional(),
});

export const providerRunEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("run_started"),
      run: providerRunRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("text_delta"),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      tool: z.string().min(1),
      callId: z.string().min(1),
      input: unknownRecordSchema,
      status: z.enum(["pending", "completed", "error"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      tool: z.string().min(1).optional(),
      callId: z.string().min(1).optional(),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("run_completed"),
      run: providerRunRefSchema,
      outputText: z.string().optional(),
      structuredPayload: z.unknown().optional(),
      usage: providerUsageSchema.nullish(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("run_failed"),
      run: providerRunRefSchema.optional(),
      error: z.string().min(1),
      raw: z.unknown().optional(),
    })
    .strict(),
]);

export const getRunInputSchema = z
  .object({
    runId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    sessionKey: z.string().min(1).optional(),
    signal: z.custom<AbortSignal>().optional(),
  })
  .strict();

export const providerRunSnapshotSchema = z
  .object({
    provider: z.string().min(1),
    runId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    nativeRunId: z.string().min(1).optional(),
    status: providerRunStatusSchema,
    rawStatus: z.string().optional(),
    outputText: z.string().optional(),
    structuredPayload: z.unknown().optional(),
    usage: providerUsageSchema.nullish(),
    error: z.string().nullable().optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const cancelRunInputSchema = z
  .object({
    runId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    reason: z.string().optional(),
    signal: z.custom<AbortSignal>().optional(),
  })
  .strict();

export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type ProviderStructuredOutputSchema = z.infer<
  typeof providerStructuredOutputSchemaSchema
>;
export type ProviderToolOutput = z.infer<typeof providerToolOutputSchema>;
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;
export type HealthCheckInput = z.infer<typeof healthCheckInputSchema>;
export type ProviderHealth = z.infer<typeof providerHealthSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type ProviderSessionRef = z.infer<typeof providerSessionRefSchema>;
export type StartRunInput = z.infer<typeof startRunInputSchema>;
export type ProviderRunStatus = z.infer<typeof providerRunStatusSchema>;
export type ProviderRunRef = z.infer<typeof providerRunRefSchema>;
export type StreamRunInput = z.infer<typeof streamRunInputSchema>;
export type ProviderRunEvent = z.infer<typeof providerRunEventSchema>;
export type GetRunInput = z.infer<typeof getRunInputSchema>;
export type ProviderRunSnapshot = z.infer<typeof providerRunSnapshotSchema>;
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;

export type ProviderConfig = {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
};

export interface AgentProviderClient {
  readonly provider: string;

  getCapabilities(): ProviderCapabilities;

  checkHealth(input?: HealthCheckInput): Promise<ProviderHealth>;

  createSession(input?: CreateSessionInput): Promise<ProviderSessionRef>;

  startRun(input: StartRunInput): Promise<ProviderRunRef>;

  streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent>;

  getRun(input: GetRunInput): Promise<ProviderRunSnapshot>;

  cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot>;
}
