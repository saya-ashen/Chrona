import { randomUUID } from "node:crypto";
import { db, type TaskResult } from "@chrona/db";
import { resultReceiptSchema, type ResultReceipt } from "@chrona/contracts/results";
import { workResultRevision, workResultScopeKey } from "@chrona/domain/task/work-results";
import { appendCanonicalEvent } from "../events";
import { resultActorKey, WorkResultError, type ResultPrincipal, type ResultScope } from "./access";

export function scopeOf(input: ResultScope): ResultScope { return { taskId: input.taskId, occurrenceId: input.occurrenceId }; }

export async function findWorkResult(principal: ResultPrincipal, scope: ResultScope) {
  return db.taskResult.findFirst({ where: { workspaceId: principal.workspaceId, taskId: scope.taskId, scopeKey: workResultScopeKey(scope.occurrenceId) } });
}
export function assertResultRevision(result: TaskResult | null, expectedRevision: string | null) {
  if ((result ? workResultRevision(result) : null) !== expectedRevision) {
    throw new WorkResultError("REVISION_CONFLICT", "Result changed; read the head and reconcile before retrying");
  }
}
export async function replayResultCommand(principal: ResultPrincipal, operation: "publish" | "review", requestId: string, payloadHash: string) {
  const row = await db.resultCommand.findUnique({ where: { workspaceId_actorKey_operation_requestId: { workspaceId: principal.workspaceId, actorKey: resultActorKey(principal), operation, requestId } } });
  if (!row) return null;
  if (row.payloadHash !== payloadHash) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Request ID already records different result input");
  return { replayed: true, receipt: resultReceiptSchema.parse(row.receipt) };
}
export function newResultReceipt(result: TaskResult, versionId: string, version: number, operation: "publish" | "review", reviewId?: string): ResultReceipt {
  return { commandId: randomUUID(), operation, resultId: result.id, versionId, version, editRevision: workResultRevision(result), acceptedVersionId: result.acceptedVersionId,
    recordedAt: new Date().toISOString(), executionStarted: false, taskStatusChanged: false, ...(reviewId ? { reviewId } : {}) };
}
export async function saveResultCommand(principal: ResultPrincipal, requestId: string, payloadHash: string, receipt: ResultReceipt) {
  await db.resultCommand.create({ data: { id: receipt.commandId, workspaceId: principal.workspaceId, actorKey: resultActorKey(principal), operation: receipt.operation,
    requestId, payloadHash, resultId: receipt.resultId, versionId: receipt.versionId, receipt } });
}
export async function recordResultEvent(principal: ResultPrincipal, scope: ResultScope, receipt: ResultReceipt) {
  // New audit topics are not trigger topics and never enter task.result.accepted dispatch.
  await appendCanonicalEvent({ eventType: receipt.operation === "publish" ? "result.version_published" : "result.version_reviewed", workspaceId: principal.workspaceId,
    taskId: scope.taskId, occurrenceId: scope.occurrenceId, actorType: principal.actorKind === "human" ? "user" : "agent", actorId: principal.actorId,
    source: "work_results", correlationId: receipt.commandId, dedupeKey: `result:${receipt.commandId}`, summary: receipt.operation === "publish" ? "Result version published" : "Result version reviewed",
    payload: { resultId: receipt.resultId, versionId: receipt.versionId, reviewId: receipt.reviewId ?? null, revision: receipt.editRevision } });
}
