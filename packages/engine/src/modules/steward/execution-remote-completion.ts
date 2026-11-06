import type { Prisma } from "@chrona/db";
import { executorFinalSchema, type ExecutorFinal, type ExecutorTarget, type ExecutionSnapshot } from "@chrona/contracts/steward";
import type { RemoteCompletion, StewardPorts } from "./ports";
import { assertCanonicalExecutionFinalDisplay } from "./execution-events";
import { CallError } from "./module-calls";
import { executionBaseline, executionDigest, executionRef, executionScope, executionSnapshot, executionEventStore } from "./execution-state";
import { projectExecutionSnapshot } from "./execution-event-projection";
import { createRuns, liveRuns } from "./runs";

export function createRemoteCompletion(ports: StewardPorts): RemoteCompletion {
  return {
    async commit(tx, { principal, target, final, digest, stop }) {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      assertCanonicalExecutionFinalDisplay(final);
      const row = await tx.executorAssignment.findUnique({ where: { attemptId: target.attemptId }, include: { attempt: { include: { run: true } } } });
      if (!row || !await tx.executionAttempt.count({ where: { id: target.attemptId, ...executionScope(principal) } })) throw new CallError("forbidden", "Final execution scope denied");
      assertFinalProvenance(row, target, final, digest);
      if (row.finalDigest && row.finalDigest !== digest) throw new CallError("conflict", "Final receipt contains different content");
      if (row.finalizedAt) return;
      if (stop && (stop.digest !== digest || executionDigest(stop.target) !== executionDigest(target))) throw new CallError("conflict", "Verified stop belongs to another final");
      const a = row.attempt;
      // Immutable final survives lost ACK and unknown stop. Stronger stop facts never replace it.
      await tx.executorAssignment.update({ where: { attemptId: a.id }, data: { finalDigest: digest, final: final as unknown as Prisma.InputJsonValue, sourceProducedThrough: Math.max(row.sourceProducedThrough, final.throughSourceSeq) } });
      const now = ports.now();
      await createRuns(ports, a.workspaceId).finishRunIn(tx, a.runId, final.outcome, now, stop ?? undefined);
      const current = await tx.executionAttempt.findUniqueOrThrow({ where: { id: a.id }, include: { run: true } });
      const snapshot = await executionSnapshot(tx, current, now);
      await executionEventStore(ports).saveSnapshot(tx, principal, finalSnapshot(snapshot, final, row.sourceHighWatermark));
      if (stop) await tx.executorAssignment.update({ where: { attemptId: a.id }, data: { finalizedAt: now } });
    },
    async committed(workspaceId, runId) {
      // R calls only after transaction commit; unknown finals cannot publish acceptable results.
      const a = await ports.db.executionAttempt.findUnique({ where: { runId }, select: { workspaceId: true, stopConfirmedAt: true } });
      if (!a || a.workspaceId !== workspaceId || !a.stopConfirmedAt) return;
      liveRuns.delete(runId);
      await ports.onRunFinished?.(workspaceId, runId);
    },
  };
}

/** Persisted remote final is the sole device result source; no local path or sidecar read. */
export async function remoteExecutionChanges(tx: Prisma.TransactionClient, attemptId: string): Promise<ExecutorFinal["changes"]> {
  const row = await tx.executorAssignment.findUnique({ where: { attemptId } });
  if (!row?.finalizedAt || !row.final) return undefined;
  const final = executorFinalSchema.safeParse(row.final);
  if (!final.success || executionDigest(final.data) !== row.finalDigest) throw new CallError("unavailable", "Stored device final is invalid");
  return final.data.changes;
}

type FinalRow = Prisma.ExecutorAssignmentGetPayload<{ include: { attempt: { include: { run: true } } } }>;
function assertFinalProvenance(row: FinalRow, target: ExecutorTarget, final: ExecutorFinal, digest: string) {
  const { assignmentId, generation, ...ref } = target;
  if (row.assignmentId !== assignmentId || row.generation !== generation || executionDigest(executionRef(row.attempt)) !== executionDigest(ref)) throw new CallError("conflict", "Final assignment reference mismatch");
  const { assignmentId: finalAssignment, generation: finalGeneration, workId, sessionId, runId, attemptId } = final;
  if (finalAssignment !== assignmentId || finalGeneration !== generation || executionDigest({ workId, sessionId, runId, attemptId }) !== executionDigest(ref) || executionDigest(final) !== digest) throw new CallError("conflict", "Final identity or digest mismatch");
  assertFinalSource(row, final);
}
function assertFinalSource(row: FinalRow, final: ExecutorFinal) {
  if (final.launchDigest !== row.launchDigest || executionDigest(final.baseline) !== executionDigest(executionBaseline(row.attempt.baseline)) || executionDigest(final.sourceReceipt) !== executionDigest(row.attempt.sourceReceipt) || final.throughSourceSeq < row.sourceHighWatermark) throw new CallError("conflict", "Final provenance mismatch");
}

function finalSnapshot(snapshot: ExecutionSnapshot, final: ExecutorFinal, sourceHighWatermark: number) {
  return projectExecutionSnapshot({ ...snapshot, finalMessage: final.finalMessage, missing: snapshot.missing || final.missing || final.throughSourceSeq > sourceHighWatermark });
}
