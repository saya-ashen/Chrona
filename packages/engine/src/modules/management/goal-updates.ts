import { db, type Prisma } from "@chrona/db";
import { managementGoalNoteSchema, type ManagementGoalUpdate } from "@chrona/contracts/api";
import { appendCanonicalEvent } from "../events";
import { operationalBriefFrom } from "../goals/goals-shared";
import type { ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { record, requireScopes, text } from "./reads";

export const goalEditRevision = (version: number) => `goal-config-v1:${version}`;
export const editableGoalStatuses = ["Draft", "Active", "Paused"];
const eventType = "goal.management_updated";
type Change = { field: string; before: string; after: string };
const printable = (value: unknown) => JSON.stringify(value ?? null);
function change(changes: Change[], field: string, before: unknown, after: unknown) {
  const a = printable(before), b = printable(after);
  if (a !== b) changes.push({ field, before: a, after: b });
}
function criterionSnapshot(value: unknown) {
  const item = record(value);
  return { id: item.id, description: item.description, proposalStatus: item.proposalStatus, satisfied: item.satisfied, confirmedAt: item.confirmedAt, evidenceArtifactIds: item.evidenceArtifactIds };
}
function revisedCriteria(value: Prisma.JsonValue, operations: NonNullable<NonNullable<ManagementGoalUpdate["patch"]>["criteria"]>, changes: Change[]) {
  if (!Array.isArray(value) || value.some((item) => typeof record(item).id !== "string")) throw new ManagementError("PRECONDITION_FAILED", "Existing criteria need repair in Chrona before editing");
  const result = [...value];
  if (new Set(result.map((item) => record(item).id)).size !== result.length) throw new ManagementError("PRECONDITION_FAILED", "Existing criterion IDs are not unique");
  for (const operation of operations) {
    const index = result.findIndex((item) => record(item).id === operation.id);
    if ((operation.operation === "add") !== (index === -1)) throw new ManagementError("VALIDATION_ERROR", operation.operation === "add" ? "Criterion ID already exists" : "Criterion ID not found");
    applyCriterionOperation(result, index, operation, changes);
  }
  if (!result.length) throw new ManagementError("VALIDATION_ERROR", "A Goal must retain at least one criterion");
  if (result.length > 20) throw new ManagementError("VALIDATION_ERROR", "Criterion edits support at most 20 criteria; existing criteria are never silently truncated");
  return result;
}

function applyCriterionOperation(result: Prisma.JsonValue[], index: number, operation: NonNullable<NonNullable<ManagementGoalUpdate["patch"]>["criteria"]>[number], changes: Change[]) {
  const before = index < 0 ? null : result[index];
  if (operation.operation === "remove") result.splice(index, 1);
  else {
    if (operation.operation === "revise" && record(before).description === operation.description) return;
    // Changing meaning never carries forward human confirmation or evidence.
    const next = { ...record(before), id: operation.id, kind: "user_confirmed", description: operation.description, proposalStatus: "proposed", satisfied: false, confirmedAt: null, evidenceArtifactIds: [] };
    if (index < 0) result.push(next); else result[index] = next;
  }
  const after = result.find((item) => record(item).id === operation.id) ?? null;
  change(changes, `criteria.${operation.id}`, before === null ? null : criterionSnapshot(before), after === null ? null : criterionSnapshot(after));
}
function revisedBrief(goal: { title: string; operationalBrief: Prisma.JsonValue }, patch: NonNullable<ManagementGoalUpdate["patch"]>["brief"], changes: Change[]) {
  const current = operationalBriefFrom(goal.operationalBrief);
  if (goal.operationalBrief !== null && !current) throw new ManagementError("PRECONDITION_FAILED", "Existing brief needs repair in Chrona before editing");
  const next = { ...record(goal.operationalBrief), ...(current ?? { outcome: goal.title, currentFocus: goal.title, strategy: "", constraints: [] }), ...patch };
  for (const field of ["outcome", "currentFocus", "strategy", "constraints"] as const) change(changes, `brief.${field}`, current?.[field] ?? null, next[field]);
  return next;
}

/** Caller holds the database transaction, including preview reads and authorization. */
export async function prepareGoalUpdate(client: ManagementIdentity, input: ManagementGoalUpdate) {
  requireScopes(client, ["goals:read", "goals:write"]);
  const goal = await db.goal.findFirst({ where: { id: input.goalId, workspaceId: client.workspaceId } });
  if (!goal) throw new ManagementError("NOT_FOUND", "Goal not found");
  if (input.expectedRevision !== goalEditRevision(goal.configRevision)) throw new ManagementError("REVISION_CONFLICT", "Goal changed. Read it again and reconcile the intended edit; do not blindly retry.");
  if (!editableGoalStatuses.includes(goal.status)) throw new ManagementError("PRECONDITION_FAILED", "Archived Goals cannot be edited through management MCP");
  const changes: Change[] = [];
  const patch = input.patch ?? {};
  const data: Prisma.GoalUpdateManyMutationInput = {};
  if (patch.title !== undefined) { data.title = patch.title; change(changes, "title", goal.title, patch.title); }
  if (patch.description !== undefined) { data.description = patch.description; change(changes, "description", goal.description, patch.description); }
  if (patch.brief) data.operationalBrief = revisedBrief(goal, patch.brief, changes);
  if (patch.criteria) data.successCriteria = revisedCriteria(goal.successCriteria, patch.criteria, changes);
  return { goal, data, changes, changed: changes.length > 0 || input.note !== undefined };
}

export function goalUpdatePreview(prepared: Awaited<ReturnType<typeof prepareGoalUpdate>>, input: ManagementGoalUpdate) {
  return {
    goalId: input.goalId, editRevision: input.expectedRevision, changed: prepared.changed,
    changes: boundedChanges(prepared.changes), note: input.note ?? null,
    criteriaRequireReview: prepared.changes.some((item) => item.field.startsWith("criteria.")),
    existingTaskContextsChanged: false, executionStarted: false, permissionsGranted: false,
  };
}

export async function applyGoalUpdate(client: ManagementIdentity, input: ManagementGoalUpdate, commandId: string) {
  const prepared = await prepareGoalUpdate(client, input);
  if (!prepared.changed) return goalUpdatePreview(prepared, input);
  const { goal, changes } = prepared;
  const updated = await db.goal.updateMany({
    where: { id: goal.id, workspaceId: client.workspaceId, configRevision: goal.configRevision },
    // The DB trigger sets the same old+1 for content changes; note-only updates
    // increment here. All canonical writers, including UI A→B→A, invalidate CAS.
    data: { ...prepared.data, configRevision: { increment: 1 }, ...(changes.some((item) => item.field === "title") ? { titleSource: "user", titleRenameNoticeSeenAt: new Date() } : {}) },
  });
  if (updated.count !== 1) throw new ManagementError("REVISION_CONFLICT", "Goal changed before this edit could be saved");
  if (changes.some((item) => item.field.startsWith("brief."))) {
    await db.goalBriefRevision.create({ data: { workspaceId: client.workspaceId, goalId: goal.id, brief: prepared.data.operationalBrief as Prisma.InputJsonObject, actorType: "agent", actorId: client.id } });
  }
  await appendCanonicalEvent({
    eventType, workspaceId: client.workspaceId, actorType: "agent", actorId: client.id, source: "management_mcp",
    correlationId: commandId, dedupeKey: `management:${commandId}:goal-updated`,
    summary: input.note ? `Goal ${input.note.kind} recorded` : "Goal details updated",
    payload: { goal_id: goal.id, reason: input.reason, changes, note: input.note ?? null, before_revision: input.expectedRevision, after_revision: goalEditRevision(goal.configRevision + 1) },
  });
  return goalUpdatePreview(prepared, input);
}

function diffText(value: unknown) {
  let result = text(value, 500);
  if (result === null) return null;
  // Bound encoded size too: control characters and Unicode can expand on wire.
  while (Buffer.byteLength(JSON.stringify(result)) > 500) result = result.slice(0, -1);
  return result;
}
function boundedChanges(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((item) => {
    const row = record(item), before = diffText(row.before), after = diffText(row.after);
    return { field: text(row.field, 200), before, after, beforeTruncated: before !== row.before, afterTruncated: after !== row.after };
  });
}
function historyDetail(value: unknown, pageSize: number) {
  const payload = record(value), parsedNote = managementGoalNoteSchema.safeParse(payload.note);
  const budget = Math.floor(96_000 / pageSize), textLimit = Math.min(2_000, Math.floor(budget / 24));
  const reason = text(payload.reason, textLimit), note = parsedNote.success ? { ...parsedNote.data, text: text(parsedNote.data.text, textLimit) } : null;
  const totalChanges = Array.isArray(payload.changes) ? payload.changes.length : 0;
  const detail = { reason, reasonTruncated: reason !== payload.reason, note, noteTruncated: parsedNote.success && note?.text !== parsedNote.data.text, changes: boundedChanges(payload.changes), totalChanges, changesTruncated: false, beforeRevision: text(payload.before_revision, 64), afterRevision: text(payload.after_revision, 64) };
  while (detail.changes.length && Buffer.byteLength(JSON.stringify(detail)) > budget - 512) detail.changes.pop();
  detail.changesTruncated = detail.changes.length !== totalChanges;
  return detail;
}

export async function readGoalUpdateHistory(client: ManagementIdentity, goalId: string, page = 1, pageSize = 10) {
  const where = { workspaceId: client.workspaceId, eventType, payload: { path: "$.goal_id", equals: goalId } };
  const [rows, total] = await Promise.all([
    db.event.findMany({ where, orderBy: [{ ingestSequence: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize, select: { id: true, actorId: true, createdAt: true, payload: true } }),
    db.event.count({ where }),
  ]);
  return {
    total, page, pageSize, hasMore: page < 1_000 && page * pageSize < total,
    paginationLimitReached: page === 1_000 && page * pageSize < total,
    items: rows.map((event) => {
      return { id: event.id, actorType: "agent", actorId: event.actorId, createdAt: event.createdAt, ...historyDetail(event.payload, pageSize) };
    }),
    scope: "management_goal_updates", notesAreVerifiedEvidence: false,
  };
}
