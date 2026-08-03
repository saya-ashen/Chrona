import { z } from "zod";
import { AiFeatureRunStatus, db, Prisma } from "@chrona/db";
import { type ApplyGoalReviewProposalRequest, type GenerateGoalReviewRequest, type GoalOperationalBrief, type GoalReviewProgressEvent, type GoalReviewProposalStatus, type RejectGoalReviewProposalRequest, type RetryGoalReviewProposalRequest } from "@chrona/contracts/api";
import { aiJsonObjectSchema, aiJsonValueSchema, userQuestionSchema } from "@chrona/contracts/ai-feature-runtime";
import { AiFeatureDefinitionRegistry, resumeAiFeatureRun, stableJsonHash, startAiFeatureWithRuntime } from "../ai";
import { goalReviewFeature, goalReviewFeatureInput, goalReviewSnapshotHash, type GoalReviewFeatureInput, type GoalReviewSnapshot } from "./ai/goal.review";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { buildAutomaticGoalTaskContext } from "./goal-task-context";
import { acceptedResultSummary, boundedText } from "./goals-shared";

const REVIEW_SCHEMA_VERSION = 2;
const BRIEF_FIELDS = ["outcome", "currentFocus", "strategy", "constraints"] as const;
type BriefField = (typeof BRIEF_FIELDS)[number];
type ReviewEvent = GoalReviewProgressEvent;
const jsonObject = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function operationalBrief(value: unknown): GoalOperationalBrief | null { const parsed = z.object({ outcome: z.string().optional(), currentFocus: z.string().optional(), strategy: z.string().optional(), constraints: z.array(z.string()).optional() }).strict().safeParse(value); return parsed.success ? { outcome: parsed.data.outcome ?? "", currentFocus: parsed.data.currentFocus ?? "", strategy: parsed.data.strategy ?? "", constraints: parsed.data.constraints ?? [] } : null; }
function lineage(value: unknown): GoalReviewFeatureInput["answerLineage"] { const parsed = z.array(z.object({ questionId: z.string(), answer: aiJsonValueSchema, answeredAt: z.string().datetime() })).safeParse(record(value)?.answerLineage ?? []); return parsed.success ? parsed.data : []; }
function eventFor<T extends { id: string; status: GoalReviewProposalStatus; stateVersion: number; generationError: string | null; questions: unknown; cannotCompleteReason: unknown }>(proposal: T): ReviewEvent {
  const status: GoalReviewProposalStatus = Array.isArray(proposal.questions) ? "NeedsInput" : proposal.cannotCompleteReason ? "CannotComplete" : proposal.status;
  return { proposalId: proposal.id, status, version: proposal.stateVersion, ...(proposal.generationError ? { message: "Goal review generation failed.", errorCode: "goal_review_failed" } : {}) };
}
function matchesAnswerSchema(value: unknown, schema: unknown): boolean {
  const rule = record(schema);
  if (!rule) return false;
  if (Array.isArray(rule.enum)) {
    const matchesEnum = rule.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value));
    if (!matchesEnum) return false;
    if (rule.type === undefined) return true;
  }
  if (rule.type === "string") return typeof value === "string";
  if (rule.type === "number") return typeof value === "number";
  if (rule.type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "null") return value === null;
  if (rule.type === "array") return Array.isArray(value) && (rule.items === undefined || value.every((item) => matchesAnswerSchema(item, rule.items)));
  if (rule.type !== "object" || !record(value)) return false;
  const object = value as Record<string, unknown>;
  const properties = record(rule.properties) ?? {};
  if (Array.isArray(rule.required) && !rule.required.every((key) => typeof key === "string" && key in object)) return false;
  if (rule.additionalProperties === false && Object.keys(object).some((key) => !(key in properties))) return false;
  return Object.entries(properties).every(([key, property]) => !(key in object) || matchesAnswerSchema(object[key], property));
}

async function snapshotGoal(goalId: string, mode: "initial" | "progress"): Promise<GoalReviewSnapshot> {
  const goal = await db.goal.findUnique({ where: { id: goalId }, include: { tasks: { orderBy: [{ updatedAt: "desc" }, { id: "asc" }], include: { projection: true, events: { where: { eventType: "task.result_accepted" }, orderBy: [{ ingestSequence: "desc" }, { createdAt: "desc" }], take: 1 }, taskPlanRuns: { orderBy: { updatedAt: "desc" }, select: { planId: true, workBlockId: true, planRun: true } }, runs: { where: { status: "Completed" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { artifacts: true } } } } } });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can generate reviews");
  const tasks = goal.tasks.map((task) => { const acceptedId = record(task.events[0]?.payload)?.accepted_run_id; const accepted = typeof acceptedId === "string" ? task.runs.find((run) => run.id === acceptedId) : undefined; return { id: task.id, title: task.title, description: task.description, status: task.status, updatedAt: task.updatedAt.toISOString(), acceptedResult: accepted ? { runId: accepted.id, summary: boundedText(acceptedResultSummary(task, accepted), 1_200), artifacts: accepted.artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title, type: artifact.type, contentPreview: artifact.contentPreview ? boundedText(artifact.contentPreview, 400) : null })) } : null }; });
  const criteria = Array.isArray(goal.successCriteria) ? goal.successCriteria.flatMap((value) => { const parsed = aiJsonObjectSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }) : [];
  return { schemaVersion: 2, mode, capturedAt: new Date().toISOString(), goal: { id: goal.id, title: goal.title, description: goal.description, operationalBrief: operationalBrief(goal.operationalBrief), nextReviewAt: goal.nextReviewAt?.toISOString() ?? null, successCriteria: criteria, updatedAt: goal.updatedAt.toISOString() }, tasks, evidenceCatalog: [{ type: "goal", id: goal.id, label: goal.title }, ...criteria.flatMap((criterion) => typeof criterion.id === "string" ? [{ type: "criterion" as const, id: criterion.id }] : []), ...tasks.flatMap((task) => [{ type: "task" as const, id: task.id, label: task.title }, ...(task.acceptedResult ? [{ type: "result" as const, id: task.acceptedResult.runId }] : []), ...(task.acceptedResult?.artifacts ?? []).map((artifact) => ({ type: "artifact" as const, id: artifact.id, label: artifact.title }))])] };
}



const goalReviewDefinitions = new AiFeatureDefinitionRegistry([goalReviewFeature]);
async function queueReviewRun(proposal: { id: string; workspaceId: string; inputSnapshot: unknown; inputSnapshotHash: string; partialOutput: unknown; stateVersion: number }, operation: string): Promise<string> {
  const featureInput = goalReviewFeatureInput({ proposalId: proposal.id, proposalStateVersion: proposal.stateVersion + 1, snapshot: proposal.inputSnapshot as GoalReviewSnapshot, snapshotHash: proposal.inputSnapshotHash, answerLineage: lineage(proposal.partialOutput) });
  return (await startAiFeatureWithRuntime({ workspaceId: proposal.workspaceId, definition: goalReviewFeature, subject: { type: "goal_review_proposal", id: proposal.id, revision: proposal.inputSnapshotHash }, operation: { kind: "goal.review", operationId: operation }, input: featureInput })).runId;
}
async function linkQueuedReviewRun(
  proposal: { id: string; workspaceId: string; inputSnapshot: unknown; inputSnapshotHash: string; partialOutput: unknown; stateVersion: number; aiFeatureRunId: string | null },
  operation: string,
  statuses: GoalReviewProposalStatus[],
): Promise<string> {
  const runId = await queueReviewRun(proposal, operation);
  const linked = await db.goalReviewProposal.updateMany({
    where: {
      id: proposal.id,
      workspaceId: proposal.workspaceId,
      status: { in: statuses },
      stateVersion: proposal.stateVersion,
      aiFeatureRunId: proposal.aiFeatureRunId,
    },
    data: {
      status: "Generating",
      aiFeatureRunId: runId,
      questions: Prisma.JsonNull,
      cannotCompleteReason: null,
      missingObservations: Prisma.JsonNull,
      generationError: null,
      stateVersion: { increment: 1 },
    },
  });
  if (linked.count === 1) return runId;

  const current = await db.goalReviewProposal.findUnique({ where: { id: proposal.id }, select: { aiFeatureRunId: true } });
  if (current?.aiFeatureRunId === runId) return runId;

  await db.$transaction(async (tx) => {
    const references = await tx.goalReviewProposal.count({ where: { aiFeatureRunId: runId } });
    if (references !== 0) return;
    await tx.aiFeatureRun.updateMany({
      where: { id: runId, status: AiFeatureRunStatus.Queued, leaseOwner: null },
      data: {
        status: AiFeatureRunStatus.Cancelled,
        errorCode: "cancelled",
        errorMessage: "Queued Goal Review run lost the proposal link CAS.",
        finishedAt: new Date(),
        stateVersion: { increment: 1 },
      },
    });
  });
  throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal changed before its queued run could be linked");
}
async function failGeneratingReview(proposalId: string, runId: string) {
  await db.goalReviewProposal.updateMany({
    where: { id: proposalId, status: "Generating", aiFeatureRunId: runId },
    data: {
      status: "Failed",
      generationError: "Goal review generation failed.",
      stateVersion: { increment: 1 },
    },
  });
}
async function resumeReviewRun(runId: string) {
  return resumeAiFeatureRun({ runId, definitions: goalReviewDefinitions });
}
async function executeReview(proposalId: string) {
  const proposal = await db.goalReviewProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.status !== "Generating" || !proposal.aiFeatureRunId) {
    return proposal ? eventFor(proposal) : null;
  }
  const run = await resumeReviewRun(proposal.aiFeatureRunId);
  if (!run || run.status === "failed" || run.status === "cancelled") {
    await failGeneratingReview(proposal.id, proposal.aiFeatureRunId);
  }
  return eventFor(await db.goalReviewProposal.findUniqueOrThrow({ where: { id: proposal.id } }));
}
export async function generateGoalReview(input: { goalId: string; command: GenerateGoalReviewRequest }) {
  const identity = {
    goalId_requestIdempotencyKey: {
      goalId: input.goalId,
      requestIdempotencyKey: input.command.idempotencyKey,
    },
  };
  const existing = await db.goalReviewProposal.findUnique({ where: identity });
  if (existing) return eventFor(existing);

  const snapshot = await snapshotGoal(input.goalId, input.command.mode);
  const goal = await db.goal.findUniqueOrThrow({ where: { id: input.goalId }, select: { workspaceId: true } });
  let proposal;
  try {
    proposal = await db.goalReviewProposal.create({
      data: {
        workspaceId: goal.workspaceId,
        goalId: input.goalId,
        status: "Generating",
        inputSnapshot: jsonObject(snapshot),
        inputSnapshotHash: goalReviewSnapshotHash(snapshot),
        schemaVersion: REVIEW_SCHEMA_VERSION,
        requestIdempotencyKey: input.command.idempotencyKey,
      },
    });
  } catch (cause) {
    if (!isUniqueConstraintError(cause)) throw cause;
    const concurrent = await db.goalReviewProposal.findUnique({ where: identity });
    if (!concurrent) throw cause;
    return eventFor(concurrent);
  }

  const runId = await linkQueuedReviewRun(proposal, input.command.operationId, ["Generating"]);
  void executeReview(proposal.id).catch(() => failGeneratingReview(proposal.id, runId));
  return eventFor({ ...proposal, aiFeatureRunId: runId, stateVersion: proposal.stateVersion + 1 });
}
export async function waitForGoalReviewGeneration(proposalId: string): Promise<void> { for (;;) { const proposal = await db.goalReviewProposal.findUnique({ where: { id: proposalId }, select: { status: true, questions: true, cannotCompleteReason: true } }); if (!proposal || proposal.status !== "Generating" || Array.isArray(proposal.questions) || proposal.cannotCompleteReason) return; await new Promise((resolve) => setTimeout(resolve, 100)); } }
export async function runGoalReviewGeneration(input: { proposalId: string }) { const proposal = await db.goalReviewProposal.findUniqueOrThrow({ where: { id: input.proposalId } }); return proposal.aiFeatureRunId ? executeReview(proposal.id) : eventFor(proposal); }
export async function getReviewProgress(input: { goalId: string; proposalId: string }): Promise<ReviewEvent | null> { const proposal = await db.goalReviewProposal.findFirst({ where: { id: input.proposalId, goalId: input.goalId } }); return proposal ? eventFor(proposal) : null; }
export async function subscribeReviewProgress(input: { goalId: string; proposalId: string; onEvent: (event: ReviewEvent) => void }): Promise<{ unsubscribe(): void } | null> { const initial = await getReviewProgress(input); if (!initial) return null; input.onEvent(initial); let version = initial.version; const timer = setInterval(() => void getReviewProgress(input).then((event) => { if (event && event.version !== version) { version = event.version; input.onEvent(event); } }).catch(() => undefined), 1_000); return { unsubscribe: () => clearInterval(timer) }; }
export async function answerReviewProposal(input: {
  goalId: string;
  proposalId: string;
  command: {
    operationId: string;
    expectedVersion: number;
    answers: Array<{ questionId: string; answer: unknown }>;
  };
}) {
  const proposal = await db.$transaction(async (tx) => {
    const current = await tx.goalReviewProposal.findFirst({
      where: { id: input.proposalId, goalId: input.goalId },
    });
    if (!current) {
      throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal Review Proposal not found");
    }
    if (current.status !== "NeedsInput" || current.stateVersion !== input.command.expectedVersion) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal changed");
    }

    const parsedQuestions = z.array(userQuestionSchema).safeParse(current.questions);
    if (!parsedQuestions.success) {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Goal Review questions are invalid");
    }
    const questionById = new Map(parsedQuestions.data.map((question) => [question.questionId, question]));
    const answerIds = new Set<string>();
    const answeredAt = new Date().toISOString();
    const acceptedAnswers = input.command.answers.map((candidate) => {
      if (answerIds.has(candidate.questionId)) {
        throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Goal Review answer question IDs must be unique");
      }
      answerIds.add(candidate.questionId);
      const question = questionById.get(candidate.questionId);
      const answer = aiJsonValueSchema.safeParse(candidate.answer);
      if (!question || !answer.success || !matchesAnswerSchema(answer.data, question.answerSchema)) {
        throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Goal Review answer does not match its question schema");
      }
      return { questionId: candidate.questionId, answer: answer.data, answeredAt };
    });

    const previousPartialOutput = record(current.partialOutput);
    const updated = await tx.goalReviewProposal.updateMany({
      where: {
        id: current.id,
        status: "NeedsInput",
        stateVersion: input.command.expectedVersion,
      },
      data: {
        partialOutput: {
          partialOutput: previousPartialOutput?.partialOutput ?? null,
          answerLineage: [...lineage(current.partialOutput), ...acceptedAnswers],
        } as Prisma.InputJsonObject,
        stateVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal changed");
    }
    return tx.goalReviewProposal.findUniqueOrThrow({ where: { id: current.id } });
  });

  const runId = await linkQueuedReviewRun(proposal, input.command.operationId, ["NeedsInput"]);
  void executeReview(proposal.id).catch(() => failGeneratingReview(proposal.id, runId));
  return eventFor(await db.goalReviewProposal.findUniqueOrThrow({ where: { id: proposal.id } }));
}
export async function retryReviewProposal(input: { goalId: string; proposalId: string; command: RetryGoalReviewProposalRequest }) { const proposal = await db.goalReviewProposal.findFirst({ where: { id: input.proposalId, goalId: input.goalId } }); if (!proposal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal Review Proposal not found"); if (proposal.stateVersion !== input.command.expectedVersion || !["CannotComplete", "Failed"].includes(proposal.status)) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal changed"); const runId = await linkQueuedReviewRun(proposal, input.command.operationId, ["CannotComplete", "Failed"]); void executeReview(proposal.id).catch(() => failGeneratingReview(proposal.id, runId)); return eventFor({ ...proposal, status: "Generating", aiFeatureRunId: runId, stateVersion: proposal.stateVersion + 1 }); }
export const answerReview = answerReviewProposal;
export const retryReview = retryReviewProposal;
function currentDependency(goal: {
  operationalBrief: unknown;
  nextReviewAt: Date | null;
  successCriteria: unknown;
  updatedAt: Date;
  tasks: Array<{ id: string; status: string; updatedAt: Date }>;
}, item: { kind: string; payload: unknown; dependencySnapshot: unknown }) {
  const payload = record(item.payload);
  switch (item.kind) {
    case "brief_field": {
      const field = payload?.field;
      if (typeof field !== "string" || !BRIEF_FIELDS.includes(field as BriefField)) return null;
      const brief = operationalBrief(goal.operationalBrief);
      return { kind: "brief_field", field, value: brief?.[field as BriefField] ?? null };
    }
    case "next_review_at":
      return { kind: "next_review_at", value: goal.nextReviewAt?.toISOString() ?? null };
    case "task_candidate":
      return { kind: "task_candidate", goalUpdatedAt: goal.updatedAt.toISOString(), tasks: goal.tasks.map((task) => ({ id: task.id, status: task.status, updatedAt: task.updatedAt.toISOString() })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) };
    case "evidence_gap": {
      const criterionId = payload?.criterionId;
      const criterion = Array.isArray(goal.successCriteria)
        ? goal.successCriteria.find((candidate) => record(candidate)?.id === criterionId) ?? null
        : null;
      return { kind: "evidence_gap", criterionId, criterion };
    }
    default:
      return null;
  }
}

function createBriefWithItem(current: GoalOperationalBrief | null, payload: Record<string, unknown>): GoalOperationalBrief {
  const field = payload.field;
  if (typeof field !== "string" || !BRIEF_FIELDS.includes(field as BriefField)) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Invalid Goal Review brief field");
  }
  const base: GoalOperationalBrief = current ?? { outcome: "", currentFocus: "", strategy: "", constraints: [] };
  if (field === "constraints") {
    if (!Array.isArray(payload.value) || payload.value.some((item) => typeof item !== "string")) {
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Invalid Goal Review constraints value");
    }
    return { ...base, constraints: payload.value as string[] };
  }
  if (typeof payload.value !== "string") {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Invalid Goal Review brief value");
  }
  return { ...base, [field]: payload.value };
}

function taskPayloadFor(item: { kind: string; payload: unknown }) {
  const payload = record(item.payload);
  if (!payload) return null;
  if (item.kind === "task_candidate") {
    return {
      title: typeof payload.title === "string" ? payload.title : "",
      description: typeof payload.description === "string" ? payload.description : "",
      expectedOutcome: typeof payload.expectedOutcome === "string" ? payload.expectedOutcome : "",
    };
  }
  if (item.kind === "evidence_gap") {
    const suggested = record(payload.suggestedTask);
    if (!suggested) return null;
    return {
      title: typeof suggested.title === "string" ? suggested.title : "",
      description: typeof suggested.description === "string" ? suggested.description : "",
      expectedOutcome: typeof suggested.expectedOutcome === "string" ? suggested.expectedOutcome : "",
    };
  }
  return null;
}

export async function applyGoalReviewProposal(input: {
  goalId: string;
  proposalId: string;
  command: ApplyGoalReviewProposalRequest;
}) {
  return db.$transaction(async (tx) => {
    const proposal = await tx.goalReviewProposal.findFirst({
      where: { id: input.proposalId, goalId: input.goalId },
      include: { items: true },
    });
    if (!proposal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal Review Proposal not found");
    const applicationDedupeKey = `goal.review_proposal_applied:${proposal.id}:${input.command.idempotencyKey}`;
    const existingApplication = await tx.event.findUnique({ where: { dedupeKey: applicationDedupeKey }, select: { id: true } });
    if (existingApplication) return proposal;
    if (proposal.applicationIdempotencyKey && proposal.status !== "PartiallyApplied") {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal was already applied with a different request");
    }
    if (proposal.status !== "Ready" && proposal.status !== "PartiallyApplied") {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only ready Goal Review Proposals can be applied");
    }
    const goal = await tx.goal.findUniqueOrThrow({ where: { id: input.goalId }, include: { tasks: { select: { id: true, status: true, updatedAt: true } } } });
    if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can apply reviews");
    if (proposal.stateVersion !== input.command.expectedVersion) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal changed; refresh before applying");
    }
    if (goal.updatedAt.toISOString() !== input.command.expectedGoalUpdatedAt) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal changed; refresh the review before applying");
    }
    const expectedDependencyHashes = input.command.dependencyHashes;
    const decisionByItem = new Map(input.command.decisions.map((decision) => [decision.itemId, decision.action]));
    const unknown = [...decisionByItem.keys()].filter((itemId) => !proposal.items.some((item) => item.itemId === itemId));
    if (unknown.length > 0) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Unknown Goal Review item: ${unknown.join(", ")}`);
    const now = new Date();
    let nextBrief = operationalBrief(goal.operationalBrief);
    let nextReviewAt = goal.nextReviewAt;
    let briefChanged = false;
    const itemUpdates: Array<{
      id: string;
      decision: "Accepted" | "Rejected" | "Converted" | "Ignored" | "Stale";
      reason?: string;
      objectType?: string;
      objectId?: string;
    }> = [];

    for (const item of proposal.items) {
      const action = decisionByItem.get(item.itemId);
      if (!action) continue;
      if (item.decision !== "Pending") continue;
      if (expectedDependencyHashes[item.itemId] !== item.dependencyHash) {
        throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, `Dependency hash changed for Goal Review item ${item.itemId}`);
      }
      const current = currentDependency(goal, item);
      if (!current || stableJsonHash(current) !== item.dependencyHash) {
        itemUpdates.push({ id: item.id, decision: "Stale", reason: "The dependent Goal state changed after this Proposal was generated." });
        continue;
      }
      if (action === "reject" || action === "ignore") {
        itemUpdates.push({ id: item.id, decision: action === "reject" ? "Rejected" : "Ignored" });
        continue;
      }
      const payload = record(item.payload);
      if (!payload) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Invalid payload for Goal Review item ${item.itemId}`);
      if (item.kind === "brief_field") {
        if (action !== "accept") throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Brief items can only be accepted or rejected");
        nextBrief = createBriefWithItem(nextBrief, payload);
        briefChanged = true;
        itemUpdates.push({ id: item.id, decision: "Accepted", objectType: "Goal", objectId: goal.id });
        continue;
      }
      if (item.kind === "next_review_at") {
        if (action !== "accept" || typeof payload.value !== "string") {
          throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Next review items can only be accepted with a valid date");
        }
        nextReviewAt = new Date(payload.value);
        itemUpdates.push({ id: item.id, decision: "Accepted", objectType: "Goal", objectId: goal.id });
        continue;
      }
      const taskPayload = taskPayloadFor(item);
      if (!taskPayload || !taskPayload.title || !taskPayload.expectedOutcome) {
        throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Goal Review item ${item.itemId} cannot create a bounded Task`);
      }
      if (item.kind === "task_candidate" && action !== "accept") {
        throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Task candidates can only be accepted or rejected");
      }
      if (item.kind === "evidence_gap" && action !== "convert_to_task") {
        throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Evidence gaps can only be converted to Tasks or ignored");
      }
      const goalContext = await buildAutomaticGoalTaskContext({
        goalId: goal.id,
        workspaceId: goal.workspaceId,
        additionalContext: jsonObject({
          expectedOutcome: taskPayload.expectedOutcome,
          sourceGoalReviewProposalId: proposal.id,
          sourceGoalReviewItemId: item.itemId,
        }),
      }, tx);
      const task = await tx.task.create({
        data: {
          workspaceId: goal.workspaceId,
          goalId: goal.id,
          title: taskPayload.title,
          description: taskPayload.description,
          priority: "High",
          kind: "single",
          status: "Ready",
          executionRuntime: proposal.sourceTaskId
            ? (await tx.task.findUniqueOrThrow({ where: { id: proposal.sourceTaskId }, select: { executionRuntime: true } })).executionRuntime
            : "omp",
          executionConfig: {},
          autoPlanGeneration: false,
          autoExecute: false,
          goalContext,
        },
      });
      await tx.taskSession.create({
        data: {
          taskId: task.id,
          runtimeName: task.executionRuntime,
          sessionKey: `chrona:task:${task.id}:default`,
          label: `${task.title} · Default session`,
          createdByFramework: true,
        },
      }).then((session) => tx.task.update({ where: { id: task.id }, data: { defaultSessionId: session.id } }));
      await tx.taskOccurrence.create({
        data: {
          workspaceId: goal.workspaceId,
          taskId: task.id,
          occurrenceKey: `manual:${task.id}`,
          source: { kind: "manual", actor: { type: "user", id: "server-action" } },
          status: "Ready",
          eligibleAt: now,
        },
      });
      await tx.event.create({
        data: {
          eventType: "task.created",
          workspaceId: goal.workspaceId,
          taskId: task.id,
          actorType: "user",
          actorId: "server-action",
          source: "ui",
          payload: { title: task.title, source_goal_review_proposal_id: proposal.id, source_goal_review_item_id: item.itemId },
          summary: `Created task from Goal Review: ${task.title}`,
          dedupeKey: `goal.review.task:${proposal.id}:${item.itemId}`,
          ingestSequence: 0,
        },
      });
      itemUpdates.push({
        id: item.id,
        decision: item.kind === "evidence_gap" ? "Converted" : "Accepted",
        objectType: "Task",
        objectId: task.id,
      });
    }

    if (briefChanged && nextBrief) {
      await tx.goalBriefRevision.create({
        data: { workspaceId: goal.workspaceId, goalId: goal.id, brief: nextBrief, actorType: "user", actorId: "server-action" },
      });
    }
    await tx.goal.update({
      where: { id: goal.id },
      data: {
        ...(briefChanged && nextBrief ? { operationalBrief: nextBrief } : {}),
        ...(nextReviewAt?.getTime() !== goal.nextReviewAt?.getTime() ? { nextReviewAt } : {}),
      },
    });
    for (const update of itemUpdates) {
      await tx.goalReviewProposalItem.update({
        where: { id: update.id },
        data: {
          decision: update.decision,
          decisionReason: update.reason ?? null,
          appliedObjectType: update.objectType ?? null,
          appliedObjectId: update.objectId ?? null,
          decidedAt: now,
        },
      });
    }
    const remainingPending = proposal.items.filter((item) => item.decision === "Pending" && !decisionByItem.has(item.itemId)).length;
    const hasStale = itemUpdates.some((update) => update.decision === "Stale");
    const status = remainingPending > 0 || hasStale ? "PartiallyApplied" : "Applied";
    const updated = await tx.goalReviewProposal.update({
      where: { id: proposal.id },
      data: {
        status,
        applicationIdempotencyKey: input.command.idempotencyKey,
        appliedAt: now,
        stateVersion: { increment: 1 },
      },
      include: { items: true },
    });
    await tx.event.create({
      data: {
        eventType: "goal.review_proposal_applied",
        workspaceId: goal.workspaceId,
        taskId: proposal.sourceTaskId,
        actorType: "user",
        actorId: "server-action",
        source: "ui",
        payload: {
          goal_id: goal.id,
          proposal_id: proposal.id,
          decision_count: itemUpdates.length,
          stale_count: itemUpdates.filter((item) => item.decision === "Stale").length,
        },
        summary: `Applied Goal Review Proposal with ${itemUpdates.length} decisions`,
        dedupeKey: applicationDedupeKey,
        ingestSequence: 0,
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function rejectGoalReviewProposal(input: {
  goalId: string;
  proposalId: string;
  command: RejectGoalReviewProposalRequest;
}) {
  return db.$transaction(async (tx) => {
    const proposal = await tx.goalReviewProposal.findFirst({ where: { id: input.proposalId, goalId: input.goalId } });
    if (!proposal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal Review Proposal not found");
    if (proposal.status === "Rejected") return proposal;
    if (proposal.status !== "Ready" && proposal.status !== "PartiallyApplied") {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only reviewable Goal Review Proposals can be rejected");
    }
    const now = new Date();
    await tx.goalReviewProposalItem.updateMany({
      where: { proposalId: proposal.id, decision: "Pending" },
      data: { decision: "Rejected", decidedAt: now },
    });
    const updated = await tx.goalReviewProposal.update({
      where: { id: proposal.id },
      data: { status: "Rejected", rejectedAt: now, applicationIdempotencyKey: input.command.idempotencyKey, stateVersion: { increment: 1 } },
    });
    await tx.event.create({
      data: {
        eventType: "goal.review_proposal_rejected",
        workspaceId: proposal.workspaceId,
        taskId: proposal.sourceTaskId,
        actorType: "user",
        actorId: "server-action",
        source: "ui",
        payload: { goal_id: proposal.goalId, proposal_id: proposal.id },
        summary: "Rejected Goal Review Proposal",
        dedupeKey: `goal.review_proposal_rejected:${proposal.id}`,
        ingestSequence: 0,
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
