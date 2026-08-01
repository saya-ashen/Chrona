import { z } from "zod";

/** Shared, explicitly bounded primitives for serializable AI feature contracts. */
export const AI_FEATURE_RUNTIME_LIMITS = {
  contractId: 128,
  runtimeId: 128,
  version: 1_000_000,
  shortText: 512,
  text: 4_000,
  jsonString: 16_000,
  jsonKey: 128,
  jsonDepth: 16,
  jsonElements: 1_000,
  bindings: 64,
  artifacts: 64,
  actions: 64,
  evidence: 128,
  questions: 16,
  issues: 128,
} as const;

const stableContractIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const runtimeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const stableCodePattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const jsonPointerPattern = /^(?:|(?:\/(?:[^~/]|~[01])*)+)$/;
const sha256HashPattern = /^sha256:[a-f0-9]{64}$/;

export const aiContractIdSchema = z
  .string()
  .min(1)
  .max(AI_FEATURE_RUNTIME_LIMITS.contractId)
  .regex(stableContractIdPattern, "must be a stable lowercase contract identifier");

export const aiRuntimeIdSchema = z
  .string()
  .min(1)
  .max(AI_FEATURE_RUNTIME_LIMITS.runtimeId)
  .regex(runtimeIdPattern, "must be a bounded runtime identifier");

export const aiContractVersionSchema = z
  .number()
  .int()
  .min(1)
  .max(AI_FEATURE_RUNTIME_LIMITS.version);

export const aiStableCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(stableCodePattern, "must be a stable lowercase snake_case code");

export const aiContentHashSchema = z
  .string()
  .regex(sha256HashPattern, "must be a sha256:<64 lowercase hex characters> hash");

export const aiJsonPointerSchema = z
  .string()
  .max(2_048)
  .regex(jsonPointerPattern, "must be an RFC 6901 JSON Pointer");

export const aiTimestampSchema = z.string().datetime({ offset: true });

export const aiContractRefSchema = z
  .object({
    id: aiContractIdSchema,
    version: aiContractVersionSchema,
  })
  .strict();

export const aiObjectiveSchema = z
  .object({
    statement: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
    expectedOutcome: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
    successCriteria: z
      .array(z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text))
      .max(32),
    constraints: z
      .array(z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text))
      .max(32),
  })
  .strict();

type AiJsonValue =
  | null
  | boolean
  | number
  | string
  | AiJsonValue[]
  | { [key: string]: AiJsonValue };

function hasBoundedJsonValue(value: unknown, depth = 0, state = { elements: 0 }): boolean {
  if (depth > AI_FEATURE_RUNTIME_LIMITS.jsonDepth || ++state.elements > AI_FEATURE_RUNTIME_LIMITS.jsonElements) {
    return false;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return value.length <= AI_FEATURE_RUNTIME_LIMITS.jsonString;
  if (Array.isArray(value)) return value.every((item) => hasBoundedJsonValue(item, depth + 1, state));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(
    ([key, item]) =>
      key.length > 0 &&
      key.length <= AI_FEATURE_RUNTIME_LIMITS.jsonKey &&
      hasBoundedJsonValue(item, depth + 1, state),
  );
}

const aiJsonValueSchema: z.ZodType<AiJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(AI_FEATURE_RUNTIME_LIMITS.jsonString),
    z.array(aiJsonValueSchema).max(AI_FEATURE_RUNTIME_LIMITS.jsonElements),
    z.record(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey), aiJsonValueSchema),
  ]),
);

/** A JSON object root, deliberately bounded for persisted/provider-visible payloads. */
export const aiJsonObjectSchema = z
  .record(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey), aiJsonValueSchema)
  .superRefine((value, ctx) => {
    if (!hasBoundedJsonValue(value)) {
      ctx.addIssue({
        code: "custom",
        message: "JSON payload exceeds the runtime depth, element, string, or key limits",
      });
    }
  });

const aiSupportedJsonSchemaSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      type: z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]).optional(),
      title: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.shortText).optional(),
      description: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text).optional(),
      properties: z
        .record(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey), aiSupportedJsonSchemaSchema)
        .optional(),
      required: z.array(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey)).max(128).optional(),
      additionalProperties: z.boolean().optional(),
      items: aiSupportedJsonSchemaSchema.optional(),
      enum: z.array(aiJsonValueSchema).min(1).max(128).optional(),
    })
    .strict(),
);

/** JSON Schema answer documents use the supported closed subset and require an object root. */
export const aiJsonObjectRootSchema = z
  .object({
    type: z.literal("object"),
    title: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.shortText).optional(),
    description: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text).optional(),
    properties: z
      .record(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey), aiSupportedJsonSchemaSchema)
      .optional(),
    required: z.array(z.string().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonKey)).max(128).optional(),
    additionalProperties: z.boolean().optional(),
  })
  .strict();

/** Use this when a feature's output schema must be a strict JSON object. */
export function createAiJsonObjectSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object(shape).strict();
}

export const observationDeliverySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seed") }).strict(),
  z
    .object({
      kind: z.literal("on_demand"),
      viaAction: aiContractRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("action_result"),
      fromAction: aiContractRefSchema,
    })
    .strict(),
]);

export const observationBindingSchema = z
  .object({
    observation: aiContractRefSchema,
    delivery: observationDeliverySchema,
    required: z.boolean(),
    maxItems: z.number().int().min(1).max(AI_FEATURE_RUNTIME_LIMITS.jsonElements).optional(),
    maxBytes: z.number().int().min(1).max(16 * 1024 * 1024).optional(),
  })
  .strict();

export const actionModeSchema = z.enum(["invoke", "propose"]);
export const actionExecutionSemanticsSchema = z.enum([
  "shared_transaction",
  "domain_idempotent",
  "read_only",
  "idempotent_external",
]);

export const actionBindingSchema = z.discriminatedUnion("mode", [
  z
    .object({
      action: aiContractRefSchema,
      mode: z.literal("invoke"),
      maxCalls: z.number().int().min(1).max(AI_FEATURE_RUNTIME_LIMITS.actions).optional(),
      executionSemantics: actionExecutionSemanticsSchema,
    })
    .strict(),
  z
    .object({
      action: aiContractRefSchema,
      mode: z.literal("propose"),
      maxCalls: z.number().int().min(1).max(AI_FEATURE_RUNTIME_LIMITS.actions).optional(),
    })
    .strict(),
]);

export const artifactBindingSchema = z
  .object({
    artifactType: aiContractRefSchema,
    provenancePolicy: aiContractRefSchema,
    maxItems: z.number().int().min(1).max(AI_FEATURE_RUNTIME_LIMITS.artifacts).optional(),
    requireContentHash: z.boolean(),
  })
  .strict();

export const aiRunTerminalStatusSchema = z.enum([
  "completed",
  "needs_input",
  "cannot_complete",
]);

export const aiFeatureManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    feature: aiContractRefSchema,
    description: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
    input: aiContractRefSchema,
    observations: z.array(observationBindingSchema).max(AI_FEATURE_RUNTIME_LIMITS.bindings),
    actions: z.array(actionBindingSchema).max(AI_FEATURE_RUNTIME_LIMITS.bindings),
    artifacts: z.array(artifactBindingSchema).max(AI_FEATURE_RUNTIME_LIMITS.bindings),
    output: aiContractRefSchema,
    completion: aiContractRefSchema,
    supportedTerminalStatuses: z
      .array(aiRunTerminalStatusSchema)
      .min(1)
      .max(3)
      .superRefine((statuses, ctx) => {
        if (new Set(statuses).size !== statuses.length) {
          ctx.addIssue({ code: "custom", message: "terminal statuses must be unique" });
        }
      }),
  })
  .strict();

export function createAiObservationEnvelopeSchema<DataSchema extends z.ZodType>(dataSchema: DataSchema) {
  return z
    .object({
      observationId: aiRuntimeIdSchema,
      type: aiContractRefSchema,
      key: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.runtimeId),
      revision: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.runtimeId),
      observedAt: aiTimestampSchema,
      canonicalizerId: aiContractIdSchema,
      hashAlgorithm: z.literal("sha256"),
      contentHash: aiContentHashSchema,
      data: dataSchema,
    })
    .strict();
}

export const aiObservationEnvelopeSchema = createAiObservationEnvelopeSchema(aiJsonObjectSchema);

export const evidenceReferenceSchema = z
  .object({
    observationId: aiRuntimeIdSchema,
    path: aiJsonPointerSchema.optional(),
    quoteHash: aiContentHashSchema.optional(),
  })
  .strict();

export const proposedActionSchema = z
  .object({
    proposalId: aiRuntimeIdSchema,
    action: aiContractRefSchema,
    input: aiJsonObjectSchema,
    rationale: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
    evidence: z.array(evidenceReferenceSchema).max(AI_FEATURE_RUNTIME_LIMITS.evidence),
  })
  .strict();

export const producedArtifactReferenceSchema = z
  .object({
    artifactRef: aiRuntimeIdSchema,
    artifactType: aiContractRefSchema,
    title: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.shortText),
    mediaType: z.string().trim().min(1).max(255).optional(),
    contentHash: aiContentHashSchema.optional(),
  })
  .strict();

/** JSON Schema is carried as data, but UI answers must always start with an object. */
export const userQuestionSchema = z
  .object({
    questionId: aiRuntimeIdSchema,
    prompt: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
    answerSchema: aiJsonObjectRootSchema,
    reason: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
  })
  .strict();

export const aiCannotCompleteReasonSchema = z
  .object({
    code: aiStableCodeSchema,
    message: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
  })
  .strict();

export function createAiRunResultSchema<
  OutputSchema extends z.ZodType,
  PartialOutputSchema extends z.ZodType = OutputSchema,
>(outputSchema: OutputSchema, partialOutputSchema: PartialOutputSchema) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("completed"),
        output: outputSchema,
        artifacts: z.array(producedArtifactReferenceSchema).max(AI_FEATURE_RUNTIME_LIMITS.artifacts),
        proposedActions: z.array(proposedActionSchema).max(AI_FEATURE_RUNTIME_LIMITS.actions),
        evidence: z.array(evidenceReferenceSchema).max(AI_FEATURE_RUNTIME_LIMITS.evidence),
      })
      .strict(),
    z
      .object({
        status: z.literal("needs_input"),
        questions: z
          .array(userQuestionSchema)
          .min(1)
          .max(AI_FEATURE_RUNTIME_LIMITS.questions)
          .superRefine((questions, ctx) => {
            const ids = questions.map((question) => question.questionId);
            if (new Set(ids).size !== ids.length) {
              ctx.addIssue({ code: "custom", message: "questionId values must be unique" });
            }
          }),
        partialOutput: partialOutputSchema.optional(),
      })
      .strict(),
    z
      .object({
        status: z.literal("cannot_complete"),
        reason: aiCannotCompleteReasonSchema,
        missingObservations: z.array(aiContractRefSchema).max(AI_FEATURE_RUNTIME_LIMITS.bindings),
        partialOutput: partialOutputSchema.optional(),
      })
      .strict(),
  ]);
}

export const aiRunResultSchema = createAiRunResultSchema(aiJsonObjectSchema, aiJsonObjectSchema);

export const completionValidationIssueSchema = z
  .object({
    code: aiStableCodeSchema,
    path: aiJsonPointerSchema.optional(),
    message: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
  })
  .strict();

export const completionValidationSchema = z
  .object({
    valid: z.boolean(),
    validator: aiContractRefSchema,
    issues: z.array(completionValidationIssueSchema).max(AI_FEATURE_RUNTIME_LIMITS.issues),
  })
  .strict();

export const aiFeatureSubjectSchema = z
  .object({
    type: aiContractIdSchema,
    id: aiRuntimeIdSchema,
    revision: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.runtimeId).optional(),
  })
  .strict();

export const aiFeatureOperationSchema = z
  .object({
    kind: aiContractIdSchema,
    operationId: aiRuntimeIdSchema,
  })
  .strict();

export const aiFeatureRuntimeErrorCodeSchema = z.enum([
  "idempotency_conflict",
  "input_invalid",
  "subject_invalid",
  "manifest_invalid",
  "observation_invalid",
  "observation_limit_exceeded",
  "action_not_allowed",
  "action_input_invalid",
  "action_capability_unsupported",
  "action_outcome_unknown",
  "result_invalid",
  "output_invalid",
  "evidence_invalid",
  "provider_capability_mismatch",
  "stale_plan_baseline",
  "artifact_invalid",
  "completion_invalid",
  "provider_start_outcome_unknown",
  "provider_run_unrecoverable",
  "provider_protocol_error",
  "provider_timeout",
  "provider_invalid_json",
  "commit_failed",
  "cancelled",
  "internal_error",
]);

export const aiFeatureRuntimeErrorSchema = z
  .object({
    code: aiFeatureRuntimeErrorCodeSchema,
    message: z.string().trim().min(1).max(AI_FEATURE_RUNTIME_LIMITS.text),
  })
  .strict();

export const aiFeatureRunStatusSchema = z.enum([
  "queued",
  "preparing_observations",
  "starting_provider",
  "running",
  "validating",
  "committing_result",
  "completed",
  "needs_input",
  "cannot_complete",
  "failed",
  "cancelled",
]);

export const aiFeatureRunActionStatusSchema = z.enum([
  "pending",
  "executing",
  "completed",
  "failed",
  "proposed",
]);

export const aiFeatureRunRequestSchema = z
  .object({
    subject: aiFeatureSubjectSchema,
    operation: aiFeatureOperationSchema,
    input: aiJsonObjectSchema,
    retryOfRunId: aiRuntimeIdSchema.optional(),
  })
  .strict();

export const aiFeatureRunActionDtoSchema = z
  .object({
    id: aiRuntimeIdSchema,
    runId: aiRuntimeIdSchema,
    callId: aiRuntimeIdSchema,
    action: aiContractRefSchema,
    mode: actionModeSchema,
    status: aiFeatureRunActionStatusSchema,
    attempt: z.number().int().min(0).max(AI_FEATURE_RUNTIME_LIMITS.version),
    outputObservationId: aiRuntimeIdSchema.optional(),
    error: aiFeatureRuntimeErrorSchema.optional(),
    createdAt: aiTimestampSchema,
    finishedAt: aiTimestampSchema.optional(),
  })
  .strict();

export const aiFeatureRunStatusDtoSchema = z
  .object({
    id: aiRuntimeIdSchema,
    status: aiFeatureRunStatusSchema,
    stateVersion: z.number().int().min(0).max(AI_FEATURE_RUNTIME_LIMITS.version),
    attempt: z.number().int().min(0).max(AI_FEATURE_RUNTIME_LIMITS.version),
    error: aiFeatureRuntimeErrorSchema.optional(),
    updatedAt: aiTimestampSchema,
  })
  .strict();

export const aiFeatureRunDtoSchema = z
  .object({
    id: aiRuntimeIdSchema,
    workspaceId: aiRuntimeIdSchema,
    feature: aiContractRefSchema,
    manifest: aiFeatureManifestSchema,
    subject: aiFeatureSubjectSchema,
    operation: aiFeatureOperationSchema,
    retryOfRunId: aiRuntimeIdSchema.optional(),
    status: aiFeatureRunStatusSchema,
    stateVersion: z.number().int().min(0).max(AI_FEATURE_RUNTIME_LIMITS.version),
    attempt: z.number().int().min(0).max(AI_FEATURE_RUNTIME_LIMITS.version),
    objective: aiObjectiveSchema,
    result: aiRunResultSchema.optional(),
    completion: completionValidationSchema.optional(),
    error: aiFeatureRuntimeErrorSchema.optional(),
    startedAt: aiTimestampSchema.optional(),
    finishedAt: aiTimestampSchema.optional(),
    createdAt: aiTimestampSchema,
    updatedAt: aiTimestampSchema,
  })
  .strict();

export const aiFeatureRunReadDtoSchema = z
  .object({
    run: aiFeatureRunDtoSchema,
    observations: z.array(aiObservationEnvelopeSchema).max(AI_FEATURE_RUNTIME_LIMITS.bindings),
    actions: z.array(aiFeatureRunActionDtoSchema).max(AI_FEATURE_RUNTIME_LIMITS.actions),
  })
  .strict();

export type AiContractId = z.infer<typeof aiContractIdSchema>;
export type AiRuntimeId = z.infer<typeof aiRuntimeIdSchema>;
export type AiContractVersion = z.infer<typeof aiContractVersionSchema>;
export type AiStableCode = z.infer<typeof aiStableCodeSchema>;
export type AiContractRef = z.infer<typeof aiContractRefSchema>;
export type AiObjective = z.infer<typeof aiObjectiveSchema>;
export type AiJsonObject = z.infer<typeof aiJsonObjectSchema>;
export type ObservationDelivery = z.infer<typeof observationDeliverySchema>;
export type ObservationBinding = z.infer<typeof observationBindingSchema>;
export type ActionMode = z.infer<typeof actionModeSchema>;
export type ActionExecutionSemantics = z.infer<typeof actionExecutionSemanticsSchema>;
export type ActionBinding = z.infer<typeof actionBindingSchema>;
export type ArtifactBinding = z.infer<typeof artifactBindingSchema>;
export type AiRunTerminalStatus = z.infer<typeof aiRunTerminalStatusSchema>;
export type AiFeatureManifest = z.infer<typeof aiFeatureManifestSchema>;
export type AiObservationEnvelope = z.infer<typeof aiObservationEnvelopeSchema>;
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type ProposedAction = z.infer<typeof proposedActionSchema>;
export type ProducedArtifactReference = z.infer<typeof producedArtifactReferenceSchema>;
export type UserQuestion = z.infer<typeof userQuestionSchema>;
export type AiCannotCompleteReason = z.infer<typeof aiCannotCompleteReasonSchema>;
export type AiRunResult = z.infer<typeof aiRunResultSchema>;
export type CompletionValidationIssue = z.infer<typeof completionValidationIssueSchema>;
export type CompletionValidation = z.infer<typeof completionValidationSchema>;
export type AiFeatureSubject = z.infer<typeof aiFeatureSubjectSchema>;
export type AiFeatureOperation = z.infer<typeof aiFeatureOperationSchema>;
export type AiFeatureRuntimeErrorCode = z.infer<typeof aiFeatureRuntimeErrorCodeSchema>;
export type AiFeatureRuntimeError = z.infer<typeof aiFeatureRuntimeErrorSchema>;
export type AiFeatureRunStatus = z.infer<typeof aiFeatureRunStatusSchema>;
export type AiFeatureRunActionStatus = z.infer<typeof aiFeatureRunActionStatusSchema>;
export type AiFeatureRunRequest = z.infer<typeof aiFeatureRunRequestSchema>;
export type AiFeatureRunActionDto = z.infer<typeof aiFeatureRunActionDtoSchema>;
export type AiFeatureRunStatusDto = z.infer<typeof aiFeatureRunStatusDtoSchema>;
export type AiFeatureRunDto = z.infer<typeof aiFeatureRunDtoSchema>;
export type AiFeatureRunReadDto = z.infer<typeof aiFeatureRunReadDtoSchema>;

export type AiObservationEnvelopeFor<Data> = Omit<AiObservationEnvelope, "data"> & { data: Data };

export type AiRunResultFor<Output, PartialOutput = Output> =
  | {
      status: "completed";
      output: Output;
      artifacts: ProducedArtifactReference[];
      proposedActions: ProposedAction[];
      evidence: EvidenceReference[];
    }
  | {
      status: "needs_input";
      questions: UserQuestion[];
      partialOutput?: PartialOutput;
    }
  | {
      status: "cannot_complete";
      reason: AiCannotCompleteReason;
      missingObservations: AiContractRef[];
      partialOutput?: PartialOutput;
    };