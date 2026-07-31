import { createHash } from "node:crypto";
import { z } from "zod";
import { db, Prisma } from "@chrona/db";
import {
  goalReviewResultSchema,
  type ApplyGoalReviewProposalRequest,
  type GenerateGoalReviewRequest,
  type GoalOperationalBrief,
  type GoalReviewResult,
  type RejectGoalReviewProposalRequest,
} from "@chrona/contracts/api";
import {
  dispatchPreparedFeaturePayload,
  getAiClientForFeature,
} from "../ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { buildAutomaticGoalTaskContext } from "./goal-task-context";

const REVIEW_SCHEMA_VERSION = 1;
const BRIEF_FIELDS = ["outcome", "currentFocus", "strategy", "constraints"] as const;
type BriefField = (typeof BRIEF_FIELDS)[number];

type ReviewSnapshot = {
  goal: {
    id: string;
    title: string;
    description: string | null;
    operationalBrief: GoalOperationalBrief | null;
    nextReviewAt: string | null;
    successCriteria: unknown;
    updatedAt: string;
  };
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    updatedAt: string;
  }>;
  capturedAt: string;
};

type ProposalItemRecord = {
  itemId: string;
  kind: "brief_field" | "next_review_at" | "task_candidate" | "evidence_gap";
  payload: Prisma.InputJsonObject;
  rationale: string;
  evidenceRefs: Prisma.InputJsonArray;
  warnings: Prisma.InputJsonArray;
  dependencySnapshot: Prisma.InputJsonObject;
  dependencyHash: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function operationalBrief(value: unknown): GoalOperationalBrief | null {
  const candidate = record(value);
  if (
    !candidate
    || typeof candidate.outcome !== "string"
    || typeof candidate.currentFocus !== "string"
    || typeof candidate.strategy !== "string"
    || !Array.isArray(candidate.constraints)
  ) return null;
  return {
    outcome: candidate.outcome,
    currentFocus: candidate.currentFocus,
    strategy: candidate.strategy,
    constraints: candidate.constraints.filter((item): item is string => typeof item === "string"),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function hashValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function asJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function asJsonArray(value: unknown[]): Prisma.InputJsonArray {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonArray;
}

async function snapshotGoal(goalId: string): Promise<ReviewSnapshot> {
  const goal = await db.goal.findUnique({
    where: { id: goalId },
    include: {
      tasks: { orderBy: [{ updatedAt: "desc" }, { id: "asc" }] },
    },
  });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  if (goal.status !== "Active") {
    throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can generate reviews");
  }
  return {
    goal: {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      operationalBrief: operationalBrief(goal.operationalBrief),
      nextReviewAt: goal.nextReviewAt?.toISOString() ?? null,
      successCriteria: goal.successCriteria,
      updatedAt: goal.updatedAt.toISOString(),
    },
    tasks: goal.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      updatedAt: task.updatedAt.toISOString(),
    })),
    capturedAt: new Date().toISOString(),
  };
}

function briefDependency(snapshot: ReviewSnapshot, field: BriefField) {
  return {
    kind: "brief_field" as const,
    field,
    value: snapshot.goal.operationalBrief?.[field] ?? null,
  };
}

function itemRecord(snapshot: ReviewSnapshot, item: GoalReviewResult["items"][number]): ProposalItemRecord {
  const evidenceRefs = asJsonArray(item.evidenceRefs);
  const warnings = asJsonArray(item.warnings);
  switch (item.kind) {
    case "brief_field": {
      const dependency = briefDependency(snapshot, item.field);
      return {
        itemId: item.itemId,
        kind: item.kind,
        payload: asJsonObject({ field: item.field, value: item.value }),
        rationale: item.rationale,
        evidenceRefs,
        warnings,
        dependencySnapshot: asJsonObject(dependency),
        dependencyHash: hashValue(dependency),
      };
    }
    case "next_review_at": {
      const dependency = { kind: item.kind, value: snapshot.goal.nextReviewAt };
      return {
        itemId: item.itemId,
        kind: item.kind,
        payload: asJsonObject({ value: item.value }),
        rationale: item.rationale,
        evidenceRefs,
        warnings,
        dependencySnapshot: asJsonObject(dependency),
        dependencyHash: hashValue(dependency),
      };
    }
    case "task_candidate": {
      const dependency = { kind: item.kind, inputSnapshotHash: hashValue(snapshot) };
      return {
        itemId: item.itemId,
        kind: item.kind,
        payload: asJsonObject({ title: item.title, description: item.description, expectedOutcome: item.expectedOutcome }),
        rationale: item.rationale,
        evidenceRefs,
        warnings,
        dependencySnapshot: asJsonObject(dependency),
        dependencyHash: hashValue(dependency),
      };
    }
    case "evidence_gap": {
      const criterion = Array.isArray(snapshot.goal.successCriteria)
        ? snapshot.goal.successCriteria.find((candidate) => record(candidate)?.id === item.criterionId) ?? null
        : null;
      const dependency = { kind: item.kind, criterionId: item.criterionId, criterion };
      return {
        itemId: item.itemId,
        kind: item.kind,
        payload: asJsonObject({
          criterionId: item.criterionId,
          title: item.title,
          description: item.description,
          suggestedTask: item.suggestedTask ?? null,
        }),
        rationale: item.rationale,
        evidenceRefs,
        warnings,
        dependencySnapshot: asJsonObject(dependency),
        dependencyHash: hashValue(dependency),
      };
    }
  }
}

function goalReviewInstructions() {
  return `You are performing a governed review of one Chrona Goal from a frozen read-only snapshot.
Return only a GoalReviewResult matching schema version 1.
You may propose changes only to operational brief fields, nextReviewAt, bounded candidate Tasks, and evidence gaps.
Never propose changes to Goal title, description, or success criteria. Never mutate data, call tools, browse files, or access the network.
Every item needs a stable unique itemId, concise rationale, evidence references to ids in the snapshot, and explicit warnings.
Use qualitative reasoning. Do not fabricate confidence percentages. If the snapshot cannot support at least one grounded item, fail instead of inventing a proposal.`;
}

function reviewJsonSchema() {
  return z.toJSONSchema(goalReviewResultSchema, {
    target: "draft-07",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}


async function markGenerationFailed(proposalId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.goalReviewProposal.updateMany({
    where: { id: proposalId, status: "Generating" },
    data: { status: "Failed", generationError: message },
  });
  return message;
}

const generationPromises = new Map<string, Promise<unknown>>();

export function waitForGoalReviewGeneration(proposalId: string) {
  return generationPromises.get(proposalId) ?? Promise.resolve();
}

export async function generateGoalReview(input: { goalId: string; command: GenerateGoalReviewRequest }) {
  const existing = await db.goalReviewProposal.findUnique({
    where: { goalId_requestIdempotencyKey: { goalId: input.goalId, requestIdempotencyKey: input.command.idempotencyKey } },
  });
  if (existing) return { proposalId: existing.id, status: existing.status };

  const snapshot = await snapshotGoal(input.goalId);
  const goal = await db.goal.findUniqueOrThrow({ where: { id: input.goalId }, select: { workspaceId: true, title: true } });
  const proposal = await db.goalReviewProposal.create({
    data: {
      workspaceId: goal.workspaceId,
      goalId: input.goalId,
      status: "Generating",
      inputSnapshot: asJsonObject(snapshot),
      inputSnapshotHash: hashValue(snapshot),
      schemaVersion: REVIEW_SCHEMA_VERSION,
      requestIdempotencyKey: input.command.idempotencyKey,
    },
  });
  await db.event.create({
    data: {
      eventType: "goal.review_generation_started",
      workspaceId: goal.workspaceId,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: { goal_id: input.goalId, proposal_id: proposal.id },
      summary: `Started AI review for Goal: ${goal.title}`,
      dedupeKey: `goal.review_generation_started:${proposal.id}`,
      ingestSequence: 0,
    },
  });

  const generationPromise = runGoalReviewGeneration({ proposalId: proposal.id });
  generationPromises.set(proposal.id, generationPromise);
  void generationPromise.finally(() => generationPromises.delete(proposal.id)).catch(() => undefined);
  return { proposalId: proposal.id, status: proposal.status };
}

export async function runGoalReviewGeneration(input: { proposalId: string }) {
  const proposal = await db.goalReviewProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal || proposal.status !== "Generating") return proposal;
  try {
    const client = await getAiClientForFeature("goal.review");
    if (!client) throw new Error("No AI client is configured for Goal Review");
    const featureSpec = {
      feature: "goal.review" as const,
      instructions: goalReviewInstructions(),
      inputText: JSON.stringify({ snapshot: proposal.inputSnapshot, snapshotHash: proposal.inputSnapshotHash }, null, 2),
      structuredOutputSchema: {
        name: "goal_review_result",
        description: "A governed, itemized Goal review proposal grounded in the frozen snapshot.",
        schema: reviewJsonSchema(),
      },
    };
    const invocation = await dispatchPreparedFeaturePayload<GoalReviewResult>(
      client,
      featureSpec,
      `goal-review:${proposal.id}`,
      { toolPolicy: "read_only" },
    );
    const parsed = goalReviewResultSchema.safeParse(invocation.parsed);
    if (!parsed.success) {
      throw new Error(`Goal Review returned an invalid structured result: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    const snapshot = proposal.inputSnapshot as unknown as ReviewSnapshot;
    const records = parsed.data.items.map((item) => itemRecord(snapshot, item));
    const config = record(client.record.config);
    await db.$transaction(async (tx) => {
      const current = await tx.goalReviewProposal.findUnique({ where: { id: proposal.id }, select: { status: true } });
      if (current?.status !== "Generating") return;
      await tx.goalReviewProposalItem.createMany({
        data: records.map((item) => ({
          workspaceId: proposal.workspaceId,
          goalId: proposal.goalId,
          proposalId: proposal.id,
          ...item,
        })),
      });
      await tx.goalReviewProposal.update({
        where: { id: proposal.id },
        data: {
          status: "Ready",
          providerName: client.record.type,
          modelName: typeof config?.model === "string" ? config.model : null,
          summary: parsed.data.summary,
          rawResult: asJsonObject(parsed.data),
          generationError: null,
        },
      });
      await tx.event.create({
        data: {
          eventType: "goal.review_proposal_ready",
          workspaceId: proposal.workspaceId,
          actorType: "agent",
          actorId: client.record.type,
          source: "ai_feature",
          payload: {
            goal_id: proposal.goalId,
            proposal_id: proposal.id,
            item_count: records.length,
            provider_client_id: client.record.id,
            provider_run_id: invocation.debug?.runId ?? null,
          },
          summary: parsed.data.summary,
          dedupeKey: `goal.review_proposal_ready:${proposal.id}`,
          ingestSequence: 0,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return db.goalReviewProposal.findUnique({ where: { id: proposal.id }, include: { items: true } });
  } catch (error) {
    const message = await markGenerationFailed(proposal.id, error);
    await db.event.create({
      data: {
        eventType: "goal.review_proposal_failed",
        workspaceId: proposal.workspaceId,
        actorType: "system",
        actorId: "goal-review",
        source: "ai_feature",
        payload: { goal_id: proposal.goalId, proposal_id: proposal.id, error: message },
        summary: message,
        dedupeKey: `goal.review_proposal_failed:${proposal.id}`,
        ingestSequence: 0,
      },
    }).catch(() => undefined);
    throw error;
  }
}

function currentDependency(goal: {
  operationalBrief: unknown;
  nextReviewAt: Date | null;
  successCriteria: unknown;
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
      return item.dependencySnapshot;
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
    if (proposal.applicationIdempotencyKey === input.command.idempotencyKey) return proposal;
    if (proposal.applicationIdempotencyKey) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Goal Review Proposal was already applied with a different request");
    }
    if (proposal.status !== "Ready" && proposal.status !== "PartiallyApplied") {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only ready Goal Review Proposals can be applied");
    }
    const goal = await tx.goal.findUniqueOrThrow({ where: { id: input.goalId } });
    if (goal.status !== "Active") throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only active Goals can apply reviews");
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
      const current = currentDependency(goal, item);
      if (!current || hashValue(current) !== item.dependencyHash) {
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
        additionalContext: asJsonObject({
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
        dedupeKey: `goal.review_proposal_applied:${proposal.id}:${input.command.idempotencyKey}`,
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
      data: { status: "Rejected", rejectedAt: now, applicationIdempotencyKey: input.command.idempotencyKey },
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
