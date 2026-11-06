import type { Prisma } from "@chrona/db";
import { executionJsonBytes, type ExecutionEvent, type ExecutionPrincipal, type ExecutorSourceRecord, type ExecutorTarget } from "@chrona/contracts/steward";
import type { RemoteExecutionSink, StewardPorts } from "./ports";
import { sourceAttemptCapacity, sourceReceiptCapacity } from "./execution-source-budget";
import { CallError } from "./module-calls";
import { executionDigest, executionRef, executionScope, executionSnapshot, executionEventStore } from "./execution-state";
import { appendExecutionEventIn } from "./execution-event-store";
import { executionDisplayText } from "./execution-event-projection";

/** Identity is re-read in the effect transaction; R separately checks current credential/incarnation. */
async function assignment(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutorTarget) {
  const row = await tx.executorAssignment.findUnique({ where: { attemptId: ref.attemptId }, include: { attempt: { include: { run: true } } } });
  const a = row?.attempt;
  if (!row || !a || !await tx.executionAttempt.count({ where: { id: a.id, ...executionScope(principal) } })) throw new CallError("forbidden", "Source execution scope denied");
  if (row.assignmentId !== ref.assignmentId || row.generation !== ref.generation || a.workId !== ref.workId || a.runId !== ref.runId || a.run.sessionId !== ref.sessionId) throw new CallError("conflict", "Source assignment reference mismatch");
  if (row.tombstoneDigest) throw new CallError("cursor_expired", "Source assignment has retired");
  return row;
}
async function sourceReplay(tx: Prisma.TransactionClient, attemptId: string, record: ExecutorSourceRecord) {
  if (record.digest !== executionDigest({ sourceSeq: record.sourceSeq, at: record.at, item: record.item })) throw new CallError("conflict", "Source record digest mismatch");
  const prior = await tx.executorSourceReceipt.findUnique({ where: { attemptId_sourceSeq: { attemptId, sourceSeq: record.sourceSeq } } });
  if (prior && prior.digest !== record.digest) throw new CallError("conflict", "Source position contains different content");
  return !!prior;
}
function assertLiveSource(row: Awaited<ReturnType<typeof assignment>>) {
  if (row.attempt.capabilityRevokedAt || row.attempt.stopConfirmedAt || row.finalDigest || row.attempt.run.status !== "running") throw new CallError("conflict", "Source execution is no longer active");
}
function payload(record: ExecutorSourceRecord): ExecutionEvent["payload"] | null {
  const item = record.item;
  if (item.kind === "detail") return item.payload;
  if (item.kind === "usage") return { type: "usage", input: item.value.input, output: item.value.output };
  if (item.kind === "gap") return { type: "gap", from: record.sourceSeq, through: item.throughSourceSeq, reason: item.reason };
  return null;
}
function sourceSummary(ref: ExecutorTarget, record: ExecutorSourceRecord) {
  const item = record.item;
  if (item.kind === "detail" || item.kind === "gap") return null;
  let value: Prisma.InputJsonValue = item.value;
  if (item.kind === "progress") value = { ...item.value, tool: item.value.tool === null ? null : executionDisplayText(item.value.tool, 100) };
  if (item.kind === "resources") value = { ...item.value, version: executionDisplayText(item.value.version, 40), skills: item.value.skills.map(skill => executionDisplayText(skill, 100)) };
  return { id: `executor-summary:${ref.attemptId}:${item.kind}`, details: { type: item.kind, value, at: record.at } };
}
async function summaryCharge(tx: Prisma.TransactionClient, summary: ReturnType<typeof sourceSummary>) {
  if (!summary) return 0;
  const prior = await tx.audit.findUnique({ where: { id: summary.id } });
  return executionJsonBytes(summary.details) - (prior ? executionJsonBytes(prior.details) : 0);
}
export function createRemoteExecutionSink(ports: StewardPorts): RemoteExecutionSink {
  return {
    async ingest(tx, { principal, ref, records }) {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      let row = await assignment(tx, principal, ref);
      for (const record of records) {
        if (await sourceReplay(tx, ref.attemptId, record)) continue;
        assertLiveSource(row);
        if (record.sourceSeq !== row.sourceHighWatermark + 1) throw new CallError("conflict", "Source position requires a contiguous record or explicit gap");
        const throughSourceSeq = record.item.kind === "gap" ? record.item.throughSourceSeq : record.sourceSeq;
        const detail = payload(record), summary = sourceSummary(ref, record);
        const nextSeq = detail ? row.attempt.highWatermark + 1 : null;
        const bytes = executionJsonBytes({ sourceSeq: record.sourceSeq, digest: record.digest, throughSourceSeq, storedSeq: nextSeq });
        const delta = await summaryCharge(tx, summary), charged = bytes + delta;
        const gap = record.item.kind === "gap";
        sourceAttemptCapacity(row, charged, gap);
        await sourceReceiptCapacity(tx, row.executorId, charged, { gap });
        const storedSeq = detail ? await appendExecutionEventIn(ports, tx, principal, { ...executionRef(row.attempt), seq: 0, at: record.at, payload: detail }, { allocate: true }) : null;
        if (summary) await tx.audit.upsert({ where: { id: summary.id }, create: { ...summary, workspaceId: principal.workspaceId, subjectId: ref.runId, actorKey: "chrona", kind: "provider_event" }, update: { details: summary.details } });
        await tx.executorSourceReceipt.create({ data: { attemptId: ref.attemptId, sourceSeq: record.sourceSeq, digest: record.digest, throughSourceSeq, storedSeq, bytes } });
        row = await tx.executorAssignment.update({ where: { attemptId: ref.attemptId }, data: { sourceHighWatermark: throughSourceSeq, sourceProducedThrough: { set: Math.max(row.sourceProducedThrough, throughSourceSeq) }, receiptCount: { increment: 1 }, receiptBytes: { increment: charged } }, include: { attempt: { include: { run: true } } } });
      }
      const attempt = await tx.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId }, include: { run: true } });
      await executionEventStore(ports).saveSnapshot(tx, principal, await executionSnapshot(tx, attempt, ports.now()));
      return { acceptedThroughSourceSeq: row.sourceHighWatermark, storedHighWatermark: attempt.highWatermark };
    },
    async interaction(tx, principal, request, ref) {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      if (request.runId !== ref.runId || request.sessionId !== ref.sessionId) throw new CallError("conflict", "Interaction reference mismatch");
      const a = await tx.executionAttempt.findFirst({ where: { id: ref.attemptId, ...executionScope(principal) }, include: { run: true } });
      if (!a || a.workId !== ref.workId || a.runId !== ref.runId || a.run.sessionId !== ref.sessionId) throw new CallError("forbidden", "Interaction execution scope denied");
      if (a.stopConfirmedAt || a.capabilityRevokedAt) throw new CallError("conflict", "Interaction execution stopped");
      await appendExecutionEventIn(ports, tx, principal, { ...ref, seq: 0, at: ports.now().toISOString(), payload: { type: "question", question: { requestId: request.id, title: request.question.title, method: request.question.method, options: request.question.options, expiresAt: request.expiresAt, status: request.status } } }, { allocate: true });
    },
  };
}
