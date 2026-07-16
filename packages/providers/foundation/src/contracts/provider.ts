import { z } from "zod";

const unknownRecordSchema = z.record(z.string(), z.unknown());

export type ProviderJsonValue =
  | string
  | number
  | boolean
  | null
  | ProviderJsonValue[]
  | { [key: string]: ProviderJsonValue };

const providerJsonValueSchema: z.ZodType<ProviderJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(providerJsonValueSchema),
    z.record(z.string(), providerJsonValueSchema),
  ]),
);

const providerRunMessageSchema = z
  .object({
    role: z.string().min(1).optional(),
    content: providerJsonValueSchema.optional(),
  })
  .strict();

export const providerRunInputSchema = z.union([
  z.string(),
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("messages"),
      messages: z.array(providerRunMessageSchema),
    })
    .strict(),
  z.record(z.string(), providerJsonValueSchema),
]);

export const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cacheReadInputTokens: z.number().int().nonnegative().optional(),
    cacheCreationInputTokens: z.number().int().nonnegative().optional(),
    contextWindow: z.number().int().positive().optional(),
  })
  .strict();

export const providerStructuredOutputSchemaSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    schema: unknownRecordSchema,
  })
  .strict();

export const providerApprovalChoiceSchema = z.enum([
  "approve_once",
  "approve_session",
  "approve_always",
  "deny",
]);

export const providerApprovalRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
  "unknown",
]);

export const providerApprovalSubjectSchema = z
  .object({
    type: z.enum(["command", "tool", "url", "file", "provider_raw"]),
    label: z.string().min(1),
    preview: z.string().optional(),
    language: z.string().min(1).optional(),
  })
  .strict();

export const providerApprovalScopePolicySchema = z
  .object({
    supportsOnce: z.boolean(),
    supportsSession: z.boolean(),
    supportsAlways: z.boolean(),
    supportsResolveAll: z.boolean(),
  })
  .strict();

export const providerApprovalCapabilitySchema = z
  .object({
    supported: z.boolean(),
    choices: z.array(providerApprovalChoiceSchema),
    scopes: z.array(z.enum(["once", "session", "always"])),
    resolveAll: z.boolean(),
  })
  .strict();

export const providerApprovalRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    provider: z.string().min(1),
    runId: z.string().min(1),
    nativeRunId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    kind: z.string().min(1),
    providerKind: z.string().min(1).optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1).optional(),
    riskLevel: providerApprovalRiskLevelSchema,
    subject: providerApprovalSubjectSchema.optional(),
    choices: z.array(providerApprovalChoiceSchema).min(1),
    defaultChoice: providerApprovalChoiceSchema.optional(),
    recommendedChoice: providerApprovalChoiceSchema.optional(),
    scopePolicy: providerApprovalScopePolicySchema.optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const resolveProviderApprovalInputSchema = z
  .object({
    runId: z.string().min(1),
    nativeRunId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    choice: providerApprovalChoiceSchema,
    resolveAll: z.boolean().optional(),
    reason: z.string().optional(),
    signal: z.custom<AbortSignal>().optional(),
  })
  .strict();

export const providerApprovalResolutionSchema = z
  .object({
    provider: z.string().min(1),
    runId: z.string().min(1),
    nativeRunId: z.string().min(1).optional(),
    choice: providerApprovalChoiceSchema,
    resolved: z.number().int().nonnegative(),
    status: z.enum(["resolved", "not_pending", "not_active"]),
    raw: z.unknown().optional(),
  })
  .strict();
export const providerRecoveryCapabilitySchema = z
  .object({
    sessionResume: z.boolean(),
    historyReplay: z.boolean(),
    activeRunLookup: z.boolean(),
    streamReconnect: z.boolean(),
    mode: z.enum(["authoritative_run_lookup", "session_history", "local_stream_only"]),
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
    reason: z.string().optional(),
    approval: providerApprovalCapabilitySchema.optional(),
    recovery: providerRecoveryCapabilitySchema.optional(),
    details: z.unknown().optional(),
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
    status: z.union([z.number().int(), z.string().min(1)]).optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
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
    providerSessionId: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    sessionKey: z.string().min(1).optional(),
    createdAt: z.string().datetime().optional(),
    raw: z.unknown().optional(),
  })
  .strict();

/**
 * Skill-mode control plane handoff (Spec 018). When the engine mints a run
 * token, it threads it to the provider via this optional field so the
 * `claude_code` provider can inject `CHRONA_BASE_URL` + `CHRONA_RUN_TOKEN`
 * into the agent subprocess env and mount the `chrona-node` skill. For all
 * other providers / control planes this is omitted and the field is
 * irrelevant. The schema is intentionally minimal: the token binding
 * (`taskId`, `nodeAttemptId`, etc.) is server-side, not parsed here.
 */
export const startRunControlInputSchema = z
  .object({
    baseUrl: z.string().min(1),
    runToken: z.string().min(1),
    skillsDir: z.string().min(1).optional(),
    skillName: z.string().min(1).optional(),
  })
  .strict();

export const startRunInputSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionKey: z.string().min(1).optional(),
    instructions: z.string().min(1),
    input: providerRunInputSchema,
    structuredOutputSchema: providerStructuredOutputSchemaSchema.optional(),
    terminalToolName: z.string().min(1).optional(),
    previousResponseId: z.string().min(1).optional(),
    /**
     * Provider-native session id captured from a PRIOR run for this Chrona
     * session (e.g. Claude Code SDK `message.session_id`). Lets a fresh
     * process resume the same provider conversation: the in-process runner
     * cache is empty after restart, so the engine threads the persisted id
     * here and the runner uses it as the SDK `resume` target.
     */
    resumeSessionRef: z.string().min(1).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    signal: z.custom<AbortSignal>().optional(),
    /** Optional skill-mode control plane handoff. See `startRunControlInputSchema`. */
    control: startRunControlInputSchema.optional(),
  })
  .strict();

/**
 * Additive extension of {@link startRunInputSchema} that allows the
 * engine to thread skill-mode control plane (baseUrl / runToken /
 * skillsDir / skillName) into a `claude_code` provider run. Use this
 * for validation when `StartRunInput.control` may be present; the base
 * `startRunInputSchema` is preserved for callers that do not pass it.
 */
export const startRunInputWithControlSchema = startRunInputSchema.extend({
  control: startRunControlInputSchema.optional(),
});

export type StartRunInputWithControl = z.infer<typeof startRunInputWithControlSchema>;
export const existingRunStreamInputSchema = z
  .object({
    runId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    sessionKey: z.string().min(1).optional(),
    signal: z.custom<AbortSignal>().optional(),
    include: z
      .object({
        rawEvents: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const providerRunStatusSchema = z.enum([
  "queued",
  "pending",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "stopping",
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
    providerRunId: z.string().min(1).optional(),
    status: providerRunStatusSchema.optional(),
    responseId: z.string().min(1).optional(),
    startedAt: z.string().datetime().optional(),
    stream: z
      .object({
        supported: z.boolean(),
        reconnectable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    raw: z.unknown().optional(),
  })
  .strict();

const providerRunEventMetadataShape = {
  provider: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  nativeRunId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  sequence: z.number().int().nonnegative().optional(),
  timestamp: z.string().optional(),
  rawEventType: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
};

export const streamRunInputSchema = z.union([
  startRunInputSchema.extend({
    runId: z.string().min(1).optional(),
    stream: z.literal(true).optional(),
  }),
  existingRunStreamInputSchema,
]);

export const providerRunEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("run_started"),
      run: providerRunRefSchema,
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("text_delta"),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("tool_call"),
      tool: z.string().min(1),
      callId: z.string().min(1),
      input: unknownRecordSchema,
      status: z.enum(["pending", "completed", "error"]),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("tool_started"),
      toolName: z.string().min(1),
      preview: z.unknown().optional(),
      input: z.unknown().optional(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("tool_completed"),
      toolName: z.string().min(1).optional(),
      error: z
        .object({
          message: z.string().min(1),
          code: z.string().optional(),
          raw: z.unknown().optional(),
        })
        .strict()
        .optional(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("tool_result"),
      tool: z.string().min(1).optional(),
      callId: z.string().min(1).optional(),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("reasoning_delta"),
      text: z.string(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("approval_required"),
      approval: providerApprovalRequestSchema,
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("run_completed"),
      run: providerRunRefSchema,
      outputText: z.string().optional(),
      output: z
        .object({
          text: z.string().optional(),
        })
        .strict()
        .optional(),
      structuredPayload: z.unknown().optional(),
      usage: providerUsageSchema.nullish(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("run_failed"),
      run: providerRunRefSchema.optional(),
      error: z.string().min(1),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("run_cancelled"),
      run: providerRunRefSchema.optional(),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...providerRunEventMetadataShape,
      type: z.literal("raw_event"),
      raw: z.unknown(),
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
    providerRunId: z.string().min(1).optional(),
    status: providerRunStatusSchema,
    rawStatus: z.string().optional(),
    outputText: z.string().optional(),
    output: z
      .object({
        text: z.string().optional(),
      })
      .strict()
      .optional(),
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
export type ProviderApprovalChoice = z.infer<typeof providerApprovalChoiceSchema>;
export type ProviderApprovalRiskLevel = z.infer<
  typeof providerApprovalRiskLevelSchema
>;
export type ProviderApprovalSubject = z.infer<typeof providerApprovalSubjectSchema>;
export type ProviderApprovalScopePolicy = z.infer<
  typeof providerApprovalScopePolicySchema
>;
export type ProviderApprovalCapability = z.infer<
  typeof providerApprovalCapabilitySchema
>;
export type ProviderRecoveryCapability = z.infer<
  typeof providerRecoveryCapabilitySchema
>;

export type ProviderApprovalRequest = z.infer<typeof providerApprovalRequestSchema>;
export type ResolveProviderApprovalInput = z.infer<
  typeof resolveProviderApprovalInputSchema
>;
export type ProviderApprovalResolution = z.infer<
  typeof providerApprovalResolutionSchema
>;

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;
export type HealthCheckInput = z.infer<typeof healthCheckInputSchema>;
export type ProviderHealth = z.infer<typeof providerHealthSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type ProviderSessionRef = z.infer<typeof providerSessionRefSchema>;
export type ProviderRunInput = z.infer<typeof providerRunInputSchema>;
export type StartRunControlInput = z.infer<typeof startRunControlInputSchema>;

export type StartRunInput = z.infer<typeof startRunInputSchema>;
export type ExistingRunStreamInput = z.infer<typeof existingRunStreamInputSchema>;
export type ProviderRunStatus = z.infer<typeof providerRunStatusSchema>;
export type ProviderRunRef = z.infer<typeof providerRunRefSchema>;
export type StreamRunInput = z.infer<typeof streamRunInputSchema>;
export type ProviderRunEvent = z.infer<typeof providerRunEventSchema>;
export type GetRunInput = z.infer<typeof getRunInputSchema>;
export type ProviderRunSnapshot = z.infer<typeof providerRunSnapshotSchema>;
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;

export type ProviderConversationCapabilities = {
  resume: boolean;
  fork: boolean;
  compact: boolean;
  handoff: "native" | "application" | "unsupported";
  contextUsage: "detailed" | "aggregate" | "none";
};

export type ProviderConversationTurnInput = {
  sessionRef: string;
  prompt: string;
  mode?: "resume" | "fork";
  toolPolicy?: "result_follow_up" | "full";
  signal?: AbortSignal;
};

export type ProviderConversationTurnResult = {
  sessionRef: string;
  outputText: string;
  usage?: ProviderUsage | null;
  compacted?: boolean;
};

export type ProviderConversationState = {
  available: boolean;
  sessionRef: string;
  compacted: boolean;
  contextTokens?: number;
  contextWindow?: number;
};

export type ProviderConfig = {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
};

export interface AgentProviderClient {
  readonly provider: string;

  getCapabilities(): ProviderCapabilities | Promise<ProviderCapabilities>;

  checkHealth(input?: HealthCheckInput): Promise<ProviderHealth>;

  createSession(input?: CreateSessionInput): Promise<ProviderSessionRef>;

  startRun(input: StartRunInput): Promise<ProviderRunRef>;

  streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent>;

  getRun(input: GetRunInput): Promise<ProviderRunSnapshot>;

  cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot>;

  getConversationCapabilities?(): ProviderConversationCapabilities;

  inspectConversation?(
    sessionRef: string,
  ): Promise<ProviderConversationState>;

  runConversationTurn?(
    input: ProviderConversationTurnInput,
  ): Promise<ProviderConversationTurnResult>;

  resolveApproval?(
    input: ResolveProviderApprovalInput,
  ): Promise<ProviderApprovalResolution>;
}
