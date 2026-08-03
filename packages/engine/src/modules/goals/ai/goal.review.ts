/* eslint-disable complexity, @typescript-eslint/no-unnecessary-condition -- Goal review validates provider output independently of static transport types. */
import { z } from "zod";
import { aiJsonObjectSchema, aiJsonValueSchema, evidenceReferenceSchema, proposedActionSchema } from "@chrona/contracts/ai-feature-runtime";
import { db, Prisma } from "@chrona/db";
import { commitAiFeatureRunAtomically, defineAiFeature, stableJsonHash } from "../../ai";
const legacyEvidenceRefSchema = z.object({ type: z.enum(["goal", "criterion", "task", "result", "artifact"]), id: z.string().min(1) }).strict();
export const goalReviewFindingSchema = z.object({ findingId: z.string().trim().min(1).max(128), rationale: z.string().trim().min(1).max(4_000), evidence: z.array(evidenceReferenceSchema).min(1).max(16) }).strict();
export const goalReviewOutputV2Schema = z.object({ schemaVersion: z.literal(2), summary: z.string().trim().min(1).max(4_000), findings: z.array(goalReviewFindingSchema).min(1).max(50).superRefine((findings, context) => { if (new Set(findings.map(({ findingId }) => findingId)).size !== findings.length) context.addIssue({ code: "custom", message: "findingId values must be unique" }); }) }).strict();
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type ProposalAction = z.infer<typeof proposedActionSchema>;
const actionSharedInputSchema = z.object({ findingId: z.string().trim().min(1).max(128), evidenceRefs: z.array(legacyEvidenceRefSchema).min(1).max(32) }).strict();
const guidanceActionInputSchema = actionSharedInputSchema.extend({ field: z.enum(["outcome", "currentFocus", "strategy", "constraints"]), value: z.union([z.string().min(1).max(2_000), z.array(z.string().min(1).max(500)).max(32)]) }).strict();
const taskActionInputSchema = actionSharedInputSchema.extend({ title: z.string().min(1).max(200), description: z.string().min(1).max(5_000), expectedOutcome: z.string().min(1).max(2_000) }).strict();
const scheduleActionInputSchema = actionSharedInputSchema.extend({ nextReviewAt: z.string().datetime() }).strict();
function mappedAction(action: ProposalAction) {
  if (action.action.id === "goal.guidance.update" && action.action.version === 1) return { kind: "brief_field" as const, parsed: guidanceActionInputSchema.safeParse(action.input) };
  if (action.action.id === "task.create_for_goal" && action.action.version === 1) return { kind: "task_candidate" as const, parsed: taskActionInputSchema.safeParse(action.input) };
  if (action.action.id === "goal.review.schedule" && action.action.version === 1) return { kind: "next_review_at" as const, parsed: scheduleActionInputSchema.safeParse(action.input) };
  return null;
}
export function validateGoalReviewCompletedTerminal(input: { output: unknown; proposedActions: readonly ProposalAction[]; observations: ReadonlyArray<{ observationId: string }>; snapshot?: GoalReviewSnapshot }): { valid: boolean; issues: Array<{ code: string; message: string }> } {
  const output = goalReviewOutputV2Schema.safeParse(input.output);
  if (!output.success) return { valid: false, issues: [{ code: "output_invalid", message: "Completed output must satisfy GoalReviewOutputV2." }] };
  const observationIds = new Set(input.observations.map(({ observationId }) => observationId));
  const catalog = input.snapshot ? new Set(input.snapshot.evidenceCatalog.map(({ type, id }) => `${type}:${id}`)) : null;
  const actions = new Map<string, ProposalAction[]>();
  const issues: Array<{ code: string; message: string }> = [];
  for (const action of input.proposedActions) {
    const mapped = mappedAction(action);
    if (!mapped || !mapped.parsed.success) { issues.push({ code: "action_not_allowed", message: `Proposed action ${action.proposalId} is not an allowable Goal-review mutation.` }); continue; }
    const grouped = actions.get(mapped.parsed.data.findingId) ?? [];
    grouped.push(action); actions.set(mapped.parsed.data.findingId, grouped);
    if (catalog && !mapped.parsed.data.evidenceRefs.every(({ type, id }) => catalog.has(`${type}:${id}`))) issues.push({ code: "action_evidence_invalid", message: `Proposed action ${action.proposalId} names evidence outside the frozen Goal snapshot.` });
  }
  for (const finding of output.data.findings) {
    const matching = actions.get(finding.findingId) ?? [];
    if (matching.length !== 1) { issues.push({ code: "finding_action_alignment", message: `Finding ${finding.findingId} must have exactly one proposed action.` }); continue; }
    const action = matching[0];
    if (action.proposalId !== finding.findingId || action.rationale !== finding.rationale) issues.push({ code: "finding_action_mismatch", message: `Finding ${finding.findingId} must match its proposed action identity and rationale.` });
    if (stableJsonHash(action.evidence) !== stableJsonHash(finding.evidence) || !finding.evidence.every(({ observationId }) => observationIds.has(observationId))) issues.push({ code: "finding_evidence_invalid", message: `Finding ${finding.findingId} must cite exactly its action's frozen evidence.` });
  }
  if (input.proposedActions.length !== output.data.findings.length) issues.push({ code: "finding_action_alignment", message: "Completed Goal reviews require a one-to-one finding/action relationship." });
  return { valid: issues.length === 0, issues };
}

export type GoalReviewProposalItemMaterialization = { itemId: string; kind: "brief_field" | "next_review_at" | "task_candidate"; payload: Prisma.InputJsonObject; rationale: string; evidenceRefs: Prisma.InputJsonArray; warnings: Prisma.InputJsonArray; dependencySnapshot: Prisma.InputJsonObject; dependencyHash: string };
export function mapGoalReviewActionsToProposalItems(input: { output: GoalReviewOutputV2; proposedActions: readonly ProposalAction[]; snapshot: GoalReviewSnapshot }): GoalReviewProposalItemMaterialization[] {
  const findings = new Map(input.output.findings.map((finding) => [finding.findingId, finding]));
  return [...input.proposedActions].sort((left, right) => left.proposalId < right.proposalId ? -1 : left.proposalId > right.proposalId ? 1 : 0).map((action) => {
    const mapped = mappedAction(action);
    if (!mapped?.parsed.success) throw new Error(`Unallowable Goal Review proposed action: ${action.proposalId}`);
    const finding = findings.get(mapped.parsed.data.findingId);
    if (!finding || action.proposalId !== finding.findingId) throw new Error(`Goal Review action does not map to a finding: ${action.proposalId}`);
    const base = { itemId: finding.findingId, rationale: finding.rationale, evidenceRefs: mapped.parsed.data.evidenceRefs as unknown as Prisma.InputJsonArray, warnings: [] as Prisma.InputJsonArray };
    if (mapped.kind === "brief_field") {
      const dependency = { kind: mapped.kind, field: mapped.parsed.data.field, value: record(input.snapshot.goal.operationalBrief)?.[mapped.parsed.data.field] ?? null };
      return { ...base, kind: mapped.kind, payload: { field: mapped.parsed.data.field, value: mapped.parsed.data.value } as Prisma.InputJsonObject, dependencySnapshot: dependency as Prisma.InputJsonObject, dependencyHash: stableJsonHash(dependency) };
    }
    if (mapped.kind === "next_review_at") {
      const dependency = { kind: mapped.kind, value: input.snapshot.goal.nextReviewAt };
      return { ...base, kind: mapped.kind, payload: { value: mapped.parsed.data.nextReviewAt } as Prisma.InputJsonObject, dependencySnapshot: dependency as Prisma.InputJsonObject, dependencyHash: stableJsonHash(dependency) };
    }
    const dependency = { kind: mapped.kind, goalUpdatedAt: input.snapshot.goal.updatedAt, tasks: input.snapshot.tasks.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) };
    return { ...base, kind: mapped.kind, payload: { title: mapped.parsed.data.title, description: mapped.parsed.data.description, expectedOutcome: mapped.parsed.data.expectedOutcome } as Prisma.InputJsonObject, dependencySnapshot: dependency as Prisma.InputJsonObject, dependencyHash: stableJsonHash(dependency) };
  });
}
export function goalReviewSnapshotHash(snapshot: GoalReviewSnapshot): string {
  return stableJsonHash(snapshot);
}

const snapshotSchema = z.object({
  schemaVersion: z.literal(2),
  capturedAt: z.string().datetime(),
  mode: z.enum(["initial", "progress"]),
  goal: z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(500),
    description: z.string().max(5_000).nullable(),
    operationalBrief: aiJsonObjectSchema.nullable(),
    nextReviewAt: z.string().datetime().nullable(),
    successCriteria: z.array(aiJsonObjectSchema).max(64),
    updatedAt: z.string().datetime(),
  }).strict(),
  tasks: z.array(z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(500),
    description: z.string().max(5_000).nullable(),
    status: z.string().min(1).max(128),
    updatedAt: z.string().datetime(),
    acceptedResult: aiJsonObjectSchema.nullable(),
  }).strict()).max(500),
  evidenceCatalog: z.array(z.object({
    type: z.enum(["goal", "criterion", "task", "result", "artifact"]),
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(500).optional(),
  }).strict()).max(2_000),
}).strict();

const inputSchema = z.object({
  proposalId: z.string().trim().min(1).max(128),
  snapshot: snapshotSchema,
  proposalStateVersion: z.number().int().nonnegative(),
  snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  answerLineage: z.array(z.object({
    questionId: z.string().min(1).max(128),
    answer: aiJsonValueSchema,
    answeredAt: z.string().datetime(),
  }).strict()).max(64).default([]),
}).strict().superRefine((input, context) => {
  if (input.snapshotHash !== goalReviewSnapshotHash(input.snapshot)) {
    context.addIssue({ code: "custom", path: ["snapshotHash"], message: "snapshotHash must match the canonical frozen Goal snapshot." });
  }
});

export type GoalReviewFeatureInput = z.infer<typeof inputSchema>;
export type GoalReviewSnapshot = z.infer<typeof snapshotSchema>;
export type GoalReviewOutputV2 = z.infer<typeof goalReviewOutputV2Schema>;

/**
 * Versioned, read-only Goal-review contract. Every provider-visible fact is
 * frozen into required seed observations before the provider starts.
 */
export const goalReviewFeature = defineAiFeature({
  manifest: {
    schemaVersion: 1,
    feature: { id: "goal.review", version: 3 },
    description: "Produces a grounded, reviewable proposal for a frozen Goal snapshot.",
    input: { id: "goal.review.input", version: 3 },
    observations: [
      { observation: { id: "goal.review.overview", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 64 * 1024 },
      { observation: { id: "goal.review.guidance", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 128 * 1024 },
      { observation: { id: "goal.review.criteria", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 256 * 1024 },
      { observation: { id: "goal.review.tasks", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 512 * 1024 },
      { observation: { id: "goal.review.execution_summaries", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 1024 * 1024 },
      { observation: { id: "goal.review.accepted_artifacts", version: 3 }, delivery: { kind: "seed" }, required: true, maxBytes: 1024 * 1024 },
    ],
    actions: [
      { action: { id: "goal.guidance.update", version: 1 }, mode: "propose", maxCalls: 8 },
      { action: { id: "task.create_for_goal", version: 1 }, mode: "propose", maxCalls: 16 },
      { action: { id: "goal.review.schedule", version: 1 }, mode: "propose", maxCalls: 2 },
    ],
    artifacts: [],
    output: { id: "goal.review.proposal", version: 2 },
    completion: { id: "goal.review.completion", version: 3 },
    supportedTerminalStatuses: ["completed", "needs_input", "cannot_complete"],
  },
  providerBindingFeature: "goal.review",
  inputSchema,
  outputSchema: goalReviewOutputV2Schema,
  subjectSchema: z.object({
    type: z.literal("goal_review_proposal"),
    id: z.string().min(1),
    revision: z.string().min(1).optional(),
  }).strict(),
  resolveSubject: ({ subject }) => subject,
  buildObjective: (input) => ({
    statement: `Review Goal ${input.snapshot.goal.id} from a frozen runtime observation.`,
    expectedOutcome: "A grounded, user-reviewable Goal proposal or an explicit terminal explanation.",
    successCriteria: ["Every proposed change is supported by the frozen snapshot observation."],
    constraints: ["Read-only analysis.", "Do not fabricate evidence.", "Do not mutate Goal state."],
  }),
  buildInstructions: ({ input, observations }) => `You are a governed Goal-review feature. Return exactly one terminal result envelope: completed, needs_input, or cannot_complete. A completed output must be GoalReviewOutputV2. Each finding must have exactly one proposed action with matching proposalId/findingId, rationale, and frozen observation evidence. Action input must include findingId and evidenceRefs selected only from the frozen snapshot evidence catalog. Never mutate data. Frozen snapshot hash: ${input.snapshotHash}. Frozen observation IDs: ${observations.map(({ observationId }) => observationId).join(", ")}.`,
  observations: [
    { binding: { observation: { id: "goal.review.overview", version: 3 } }, build: ({ input }) => observation("goal.review.overview", input, { goal: { id: input.snapshot.goal.id, title: input.snapshot.goal.title, description: input.snapshot.goal.description } }) },
    { binding: { observation: { id: "goal.review.guidance", version: 3 } }, build: ({ input }) => observation("goal.review.guidance", input, { operationalBrief: input.snapshot.goal.operationalBrief, nextReviewAt: input.snapshot.goal.nextReviewAt }) },
    { binding: { observation: { id: "goal.review.criteria", version: 3 } }, build: ({ input }) => observation("goal.review.criteria", input, { successCriteria: input.snapshot.goal.successCriteria }) },
    { binding: { observation: { id: "goal.review.tasks", version: 3 } }, build: ({ input }) => observation("goal.review.tasks", input, { tasks: input.snapshot.tasks.map(({ acceptedResult: _acceptedResult, ...task }) => task) }) },
    { binding: { observation: { id: "goal.review.execution_summaries", version: 3 } }, build: ({ input }) => observation("goal.review.execution_summaries", input, { results: input.snapshot.tasks.flatMap((task) => task.acceptedResult ? [{ taskId: task.id, result: task.acceptedResult }] : []) }) },
    { binding: { observation: { id: "goal.review.accepted_artifacts", version: 3 } }, build: ({ input }) => observation("goal.review.accepted_artifacts", input, { artifacts: input.snapshot.tasks.flatMap((task) => task.acceptedResult ? (record(task.acceptedResult)?.artifacts as unknown[] ?? []).map((artifact) => ({ taskId: task.id, artifact })) : []) }) },
  ],
  actions: [
    { binding: { action: { id: "goal.guidance.update", version: 1 }, mode: "propose", maxCalls: 8 }, inputSchema: guidanceActionInputSchema },
    { binding: { action: { id: "task.create_for_goal", version: 1 }, mode: "propose", maxCalls: 16 }, inputSchema: taskActionInputSchema },
    { binding: { action: { id: "goal.review.schedule", version: 1 }, mode: "propose", maxCalls: 2 }, inputSchema: scheduleActionInputSchema },
  ],
  validateCompletion: ({ input, result, observations }) => {
    const featureInput = inputSchema.safeParse(input);
    const validation = !featureInput.success
      ? { valid: false, issues: [{ code: "snapshot_invalid", message: "Completed Goal reviews require a valid frozen Goal snapshot." }] }
      : validateGoalReviewCompletedTerminal({ output: result.output, proposedActions: result.proposedActions, observations, snapshot: featureInput.data.snapshot });
    return { ...validation, validator: { id: "goal.review.completion", version: 3 } };
  },
  commitResult: async (context) => {
    const terminal = context.terminal.result;
    const featureInput = inputSchema.parse(context.input);
    if (terminal.status === "completed") {
      const validation = validateGoalReviewCompletedTerminal({ output: terminal.output, proposedActions: context.terminal.proposedActions as ProposalAction[], observations: context.observations, snapshot: featureInput.snapshot });
      if (!validation.valid) throw new Error(validation.issues.map(({ message }) => message).join(" "));
    }
    const proposalData = terminal.status === "completed"
      ? { status: "Ready" as const, summary: terminal.output.summary, rawResult: terminal as unknown as Prisma.InputJsonValue, questions: Prisma.JsonNull, cannotCompleteReason: null, missingObservations: Prisma.JsonNull, partialOutput: Prisma.JsonNull, generationError: null }
      : terminal.status === "needs_input"
        ? { status: "NeedsInput" as const, questions: terminal.questions as unknown as Prisma.InputJsonValue, partialOutput: { partialOutput: terminal.partialOutput ?? null, answerLineage: featureInput.answerLineage } as Prisma.InputJsonObject, generationError: null }
        : { status: "CannotComplete" as const, cannotCompleteReason: JSON.stringify(terminal.reason), missingObservations: terminal.missingObservations as unknown as Prisma.InputJsonValue, partialOutput: { partialOutput: terminal.partialOutput ?? null, answerLineage: featureInput.answerLineage } as Prisma.InputJsonObject, generationError: null };
    await db.$transaction(async (tx) => {
      const updated = await tx.goalReviewProposal.updateMany({ where: { id: featureInput.proposalId, workspaceId: context.workspaceId, status: "Generating", stateVersion: featureInput.proposalStateVersion, aiFeatureRunId: context.runId }, data: { ...proposalData, stateVersion: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("Goal Review Proposal changed before atomic commit.");
      if (terminal.status === "completed") await tx.goalReviewProposalItem.createMany({ data: mapGoalReviewActionsToProposalItems({ output: terminal.output, proposedActions: context.terminal.proposedActions as ProposalAction[], snapshot: featureInput.snapshot }).map((item) => ({ ...item, workspaceId: context.workspaceId, goalId: featureInput.snapshot.goal.id, proposalId: featureInput.proposalId })) });
      if (!await commitAiFeatureRunAtomically(tx, { runId: context.runId, expectedStateVersion: context.expectedStateVersion, leaseOwner: context.leaseOwner, terminal: context.terminal, commitReference: { proposalId: featureInput.proposalId } })) throw new Error("Goal Review feature run changed before atomic commit.");
    });
    return { commitReference: { proposalId: featureInput.proposalId } };
  },
});

function observation(type: string, input: GoalReviewFeatureInput, value: Record<string, unknown>) {
  const observationId = `${type.replace(/[^a-z0-9]/gi, "-")}-${input.snapshotHash.slice("sha256:".length)}`;
  const data = aiJsonObjectSchema.parse(value);
  return { observationId, type: { id: type, version: 3 }, key: input.proposalId, revision: input.snapshotHash, observedAt: input.snapshot.capturedAt, canonicalizerId: "chrona.stable-json.v1", hashAlgorithm: "sha256" as const, contentHash: stableJsonHash(data), data };
}

export function goalReviewFeatureInput(input: unknown): GoalReviewFeatureInput {
  return inputSchema.parse(input);
}
