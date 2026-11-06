import { createExecutorControl, createExecutorProvider, createRemoteExecutionSink, createRemoteCompletion, deviceCommandBytes, type StewardPorts } from "@chrona/engine";
import { executorFinalSchema, executorDigest } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";

type StoppedAttempt = Prisma.ExecutionAttemptGetPayload<{ include: { assignment: true; run: true } }>;

/** No device final exists when a claimed descriptor was provably never offered. */
async function neverOfferedOutcome(ports: StewardPorts, row: StoppedAttempt) {
  if (!row.assignment) return null;
  if ([row.executorId === "server", (row.stopEvidence as { kind?: string } | null)?.kind !== "never_started",
    !["cancelled", "timed_out"].includes(row.run.status)].some(Boolean)) return null;
  const assignment = row.assignment;
  const commands = await ports.db.executionCommand.findMany({ where: { attemptId: row.id } });
  const cancelBytes = commands.reduce((bytes, command) => bytes + deviceCommandBytes({ ...command, receipt: command.receipt as Parameters<typeof deviceCommandBytes>[0]["receipt"] }), 0);
  const pristine = [assignment.offeredAt, assignment.startedAt, assignment.processIdentity, assignment.final, assignment.finalDigest,
    assignment.finalizedAt, row.sourceReceipt, row.heldDirectory].every(value => value === null)
    && [assignment.sourceHighWatermark, assignment.sourceProducedThrough, assignment.receiptCount].every(value => value === 0)
    && commands.every(command => command.operation === "cancel" && command.offeredAt === null)
    && assignment.receiptBytes === cancelBytes
    && !await ports.db.executorSourceReceipt.count({ where: { attemptId: row.id } });
  if (!pristine || assignment.tombstoneDigest !== await executorDigest({ assignmentId: assignment.assignmentId, launchDigest: assignment.launchDigest, kind: "never_offered" })) return null;
  return { outcome: row.run.status === "timed_out" ? "timed_out" as const : "unavailable" as const, sessionId: null, error: row.run.error };
}

/** The relay observes an existing Run; only persisted verified device stop can settle its live handle. */
export function installDeviceExecution(ports: StewardPorts) {
  const executor = createExecutorControl(ports), relay = createExecutorProvider();
  ports.executorController = executor.controller;
  ports.executorAdmission = executor.admission;
  ports.deliverRemoteControl = executor.deliverRemoteControl;
  ports.executorProvider = relay.provider;
  ports.remoteExecutionSink = createRemoteExecutionSink(ports);
  const completion = createRemoteCompletion(ports);
  ports.remoteCompletion = { commit: completion.commit, async committed(workspaceId, runId) {
    const row = await ports.db.executionAttempt.findUnique({ where: { runId }, include: { assignment: true, run: true } });
    if (row?.workspaceId === workspaceId && row.stopConfirmedAt && row.assignment?.finalizedAt) {
      const final = executorFinalSchema.parse(row.assignment.final);
      relay.complete(runId, final.outcome);
    } else if (row?.workspaceId === workspaceId && row.stopConfirmedAt) {
      const outcome = await neverOfferedOutcome(ports, row);
      if (outcome) relay.complete(runId, outcome);
    }
    await completion.committed(workspaceId, runId);
  } };
}
