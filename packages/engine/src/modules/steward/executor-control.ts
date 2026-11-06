import { randomUUID } from "node:crypto";
import { Prisma } from "@chrona/db";
import { EXECUTOR_LIMITS, executorAssignmentSchema, executorCanonicalJson, executorDigest, type ExecutionPrincipal, type ExecutorAssignment, type ExecutorController, type ExecutorPrincipal, type ExecutorRequests, type ExecutorResponses, type ExecutorTarget } from "@chrona/contracts/steward";
import { createExecutorAuth, assertExecutorRequest, assertExecutorTarget } from "./executor-auth";
import { assertCanonicalExecutionFinalDisplay } from "./execution-events";
import { ExecutorQuestions } from "./executor-provider";
import { CallError } from "./module-calls";
import type { ExecutorAdmission, StewardPorts, VerifiedDeviceStop } from "./ports";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const target = (row: { attemptId: string; assignmentId: string; generation: number; attempt: { workId: string; runId: string; run: { sessionId: string | null } } }): ExecutorTarget => ({ workId: row.attempt.workId, sessionId: row.attempt.run.sessionId!, runId: row.attempt.runId, attemptId: row.attemptId, assignmentId: row.assignmentId, generation: row.generation });
const owner = (who: ExecutorPrincipal, row: { moduleId: string | null; callerHash: string | null }): ExecutionPrincipal => ({ workspaceId: who.workspaceId, ownerId: who.ownerId, caller: row.moduleId ? { kind: "module", moduleId: row.moduleId, hash: row.callerHash! } : { kind: "owner" } });
const include = { attempt: { include: { run: true } } } as const;
function fail(message: string): never { throw new CallError("conflict", message); }

const snapshotSelect = { assignmentId: true, attemptId: true, generation: true, finalizedAt: true, attempt: { select: { workId: true, runId: true, run: { select: { sessionId: true } } } } } as const;
type SnapshotRow = Prisma.ExecutorAssignmentGetPayload<{ select: typeof snapshotSelect }>;
type Traversal = { fence: string; cursor: string | null; rows: SnapshotRow[]; seen: Set<string>; deviceComplete: boolean; offset: number; lastRequest?: string; lastResponse?: ExecutorResponses["reconcile"] };

/** Only transports already claimed/prepared Runs. All authority effects share the writer transaction. */
export function createExecutorControl(ports: StewardPorts) { return new ExecutorControl(ports); }
class ExecutorControl {
  constructor(readonly ports: StewardPorts) { this.questions = new ExecutorQuestions(ports); this.auth = createExecutorAuth(ports); }
  readonly questions: ExecutorQuestions;
  readonly auth: ReturnType<typeof createExecutorAuth>;
  readonly traversals = new Map<string, Traversal>();
  readonly controls = new Map<string, { target: ExecutorTarget; commandKey: string; text: string }[]>();
  async writer<T>(who: ExecutorPrincipal, op: Exclude<keyof ExecutorRequests, "pair">, input: ExecutorRequests[typeof op], effect: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExecutionExecutor" SET "id" = "id" WHERE 0`;
      await assertExecutorRequest(tx, who, op, input);
      if (op !== "final" && op !== "reconcile") {
        const executor = await tx.executionExecutor.findUniqueOrThrow({ where: { id: who.executorId } });
        if (!executor.authorizedUntil || executor.authorizedUntil <= this.ports.now()) throw new CallError("forbidden", "Device reconciliation required after disconnect");
      }
      return effect(tx);
    });
  }
  readonly admission: ExecutorAdmission = {
    online: async (tx, input) => {
      const row = await tx.executionExecutor.findUnique({ where: { id: input.executorId } });
      if (!row || row.revokedAt || !row.incarnation || !row.reconciledAt || !row.authorizedUntil || row.authorizedUntil <= input.now) return null;
      return { executorId: row.id, generation: row.generation, incarnation: row.incarnation, authorizedUntil: row.authorizedUntil };
    },
    reserve: async (tx, input) => {
      await this.retire(tx);
      const row = await tx.executionAttempt.findUniqueOrThrow({ where: { id: input.ref.attemptId }, include: { run: true } });
      const online = await this.admission.online(tx, { executorId: input.fence.executorId, now: this.ports.now() });
      if (!online || online.generation !== input.fence.generation || online.incarnation !== input.fence.incarnation || row.executorId !== input.fence.executorId || row.executorGeneration !== input.fence.generation || row.runId !== input.ref.runId || row.workId !== input.ref.workId || row.run.sessionId !== input.ref.sessionId || row.directoryIdentity !== input.mapping.directoryIdentity || row.mappingRevision !== input.mapping.mappingRevision) throw new CallError("forbidden", "Assignment reservation rejected");
      if (await tx.executorAssignment.count({ where: { executorId: input.fence.executorId } }) >= EXECUTOR_LIMITS.assignmentRecords) throw new CallError("capacity", "Assignment metadata capacity reached");
      const assignmentId = randomUUID();
      await tx.executorAssignment.create({ data: { attemptId: row.id, assignmentId, executorId: input.fence.executorId, generation: input.fence.generation, incarnation: input.fence.incarnation } });
      return { ...input.ref, assignmentId, generation: input.fence.generation };
    },
    prepare: async (tx, assignment, digest) => {
      if (await executorDigest(assignment) !== digest) fail("Launch digest mismatch");
      const row = await tx.executorAssignment.findUniqueOrThrow({ where: { attemptId: assignment.attemptId } });
      if (row.assignmentId !== assignment.assignmentId || row.executorId !== assignment.executorId || row.generation !== assignment.generation || row.incarnation !== assignment.incarnation) fail("Launch identity mismatch");
      if (row.launchDigest && row.launchDigest !== digest) fail("Prepared launch is immutable");
      executorAssignmentSchema.parse(assignment);
      await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { launch: json(assignment), launchDigest: digest, preparedAt: row.preparedAt ?? this.ports.now() } });
    },
  };
  readonly controller: ExecutorController = {
    pair: (credential, input) => this.auth.pair(credential, input), authenticate: (credential, fence, mode) => this.auth.authenticate(credential, fence, mode),
    poll: (who, input) => {
      return this.writer(who, "poll", input, async tx => {
        const now = this.ports.now();
        const rows = await tx.executorAssignment.findMany({ where: { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, preparedAt: { not: null }, finalizedAt: null, attempt: { stopConfirmedAt: null } }, include, take: EXECUTOR_LIMITS.assignmentRecords, orderBy: { assignmentId: "asc" } });
        const launches: ExecutorResponses["poll"]["launches"] = [], outgoing: ExecutorResponses["poll"]["controls"] = [];
        for (const row of rows) {
          const ref = target(row), deadline = row.attempt.run.deadlineAt?.getTime() ?? 0;
          if (row.attempt.cancelRequestedAt || row.attempt.capabilityRevokedAt || deadline <= now.getTime()) { outgoing.push({ op: "cancel", target: ref }); continue; }
          if (row.offeredAt || row.startedAt || !row.launch) continue;
          if (launches.length >= EXECUTOR_LIMITS.codingEnvironment) break;
          await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { offeredAt: now } });
          launches.push({ assignment: executorAssignmentSchema.parse(row.launch), launchDigest: row.launchDigest!, remainingMs: Math.min(1_200_000, deadline - now.getTime()), offlineGraceMs: EXECUTOR_LIMITS.graceMs });
        }
        await this.offerControls(tx, who, outgoing, now);
        await tx.executionExecutor.update({ where: { id: who.executorId }, data: { lastSeenAt: now, authorizedUntil: new Date(now.getTime() + EXECUTOR_LIMITS.graceMs) } });
        return { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, authorizedForMs: EXECUTOR_LIMITS.graceMs, launches, controls: outgoing.slice(0, EXECUTOR_LIMITS.controls), questions: this.questions.replies(who), ...(this.ports.executionWorkspaceCleanupTransport ? { cleanupOperations: await this.ports.executionWorkspaceCleanupTransport.poll(tx, who) } : {}) };
      }).then(result => { this.controls.delete(who.executorId); this.questions.consumed(who, result.questions); return result; });
    },
    report: (who, input) => {
      // eslint-disable-next-line complexity -- Cleanup results have a disjoint narrow path before retired stream rejection.
      return this.writer(who, "report", input, async tx => {
        const row = await assertExecutorTarget(tx, who, input.target, input.started?.launchDigest);
        if (input.cleanupResults?.length) {
          if (input.records.length || input.started || input.consumed?.length || !this.ports.executionWorkspaceCleanupTransport) fail("Cleanup report cannot carry stream effects");
          await this.ports.executionWorkspaceCleanupTransport.report(tx, who, input);
          return { acceptedThroughSourceSeq: row.sourceHighWatermark, storedHighWatermark: row.attempt.highWatermark };
        }
        if (row.tombstoneDigest) throw new CallError("cursor_expired", "Assignment stream retired");
        if (input.started) await this.started(tx, row, input.started);
        for (const consumed of input.consumed ?? []) await tx.executionCommand.updateMany({ where: { attemptId: row.attemptId, commandKey: consumed.commandKey, offeredAt: { not: null }, effect: "unknown" }, data: { effect: consumed.effect } });
        if (!this.ports.remoteExecutionSink) throw new CallError("unavailable", "Remote event ingress unavailable");
        return this.ports.remoteExecutionSink.ingest(tx, { principal: owner(who, row.attempt), ref: input.target, records: input.records });
      });
    },
    question: (who, input, signal) => this.questions.question(who, input, signal),
    final: async (who, input) => {
      const result = await this.writer(who, "final", input, async tx => {
        const row = await assertExecutorTarget(tx, who, input.final, input.final.launchDigest, true);
        assertCanonicalExecutionFinalDisplay(input.final);
        if (await executorDigest(input.final) !== input.digest) fail("Final digest mismatch");
        if (row.finalDigest && row.finalDigest !== input.digest) fail("Final is immutable");
        if (!row.finalDigest) await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { final: json(input.final), finalDigest: input.digest } });
        if (row.finalizedAt) return { digest: input.digest, accepted: true as const, stopConfirmed: true };
        const ref = { workId: input.final.workId, sessionId: input.final.sessionId, runId: input.final.runId, attemptId: input.final.attemptId, assignmentId: input.final.assignmentId, generation: input.final.generation };
        const stop = await verifiedStop(tx, who, ref, row, { proof: input.final.stop, digest: input.digest, final: input.final });
        if (!this.ports.remoteCompletion) throw new CallError("unavailable", "Remote completion unavailable");
        await this.ports.remoteCompletion.commit(tx, { principal: owner(who, row.attempt), target: ref, final: input.final, digest: input.digest, stop });
        if (stop) await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { finalizedAt: this.ports.now() } });
        return { digest: input.digest, accepted: true as const, stopConfirmed: stop !== null };
      });
      if (result.stopConfirmed) { this.questions.interrupt(input.final.runId); await this.ports.remoteCompletion!.committed(who.workspaceId, input.final.runId); }
      return result;
    },
    reconcile: (who, input) => this.reconcile(who, input),
  };
  async retire(tx: Prisma.TransactionClient) {
    const before = new Date(this.ports.now().getTime() - 30 * 86400000);
    const rows = await tx.executorAssignment.findMany({ where: { finalizedAt: { lte: before }, tombstoneDigest: null, attempt: { stopConfirmedAt: { not: null } } }, select: { attemptId: true, assignmentId: true, finalDigest: true }, take: EXECUTOR_LIMITS.assignmentRecords });
    for (const row of rows) {
      await tx.executorSourceReceipt.deleteMany({ where: { attemptId: row.attemptId } });
      await tx.audit.deleteMany({ where: { id: { in: ["progress", "usage", "resources"].map(kind => `executor-summary:${row.attemptId}:${kind}`) } } });
      await tx.executionCommand.deleteMany({ where: { attemptId: row.attemptId, NOT: { operation: { startsWith: "workspace-cleanup-" } } } });
      await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { receiptCount: 0, receiptBytes: 0, tombstoneDigest: await executorDigest({ assignmentId: row.assignmentId, finalDigest: row.finalDigest, retired: true }) } });
    }
  }
  async started(tx: Prisma.TransactionClient, row: Awaited<ReturnType<typeof assertExecutorTarget>>, started: NonNullable<ExecutorRequests["report"]["started"]>) {
    if (!row.offeredAt || !row.launch) fail("Launch was not offered");
    if (started.identity.unit !== `chrona-executor-${await executorDigest({ executorId: row.executorId, assignmentId: row.assignmentId })}.service`) fail("Process unit binding mismatch");
    if (row.processIdentity && executorCanonicalJson(row.processIdentity) !== executorCanonicalJson(started.identity)) fail("Process identity is immutable");
    const launch = row.launch as unknown as ExecutorAssignment;
    await assertSourceReceipt(launch, started.sourceReceipt);
    if (row.startedAt && executorCanonicalJson(row.attempt.sourceReceipt) !== executorCanonicalJson(started.sourceReceipt)) fail("Source receipt is immutable");
    await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { processIdentity: json(started.identity), startedAt: row.startedAt ?? this.ports.now() } });
    await tx.executionAttempt.update({ where: { id: row.attemptId }, data: { sourceReceipt: started.sourceReceipt ? json(started.sourceReceipt) : Prisma.JsonNull } });
  }
  async offerControls(tx: Prisma.TransactionClient, who: ExecutorPrincipal, outgoing: ExecutorResponses["poll"]["controls"], now: Date) {
        const pending = this.controls.get(who.executorId) ?? [];
        for (const control of pending.slice(0, EXECUTOR_LIMITS.controls - outgoing.length)) {
          const row = await assertExecutorTarget(tx, who, control.target);
          if (row.attempt.cancelRequestedAt || row.attempt.stopConfirmedAt) continue;
          const command = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: row.attemptId, commandKey: control.commandKey } } });
          if (!command || command.offeredAt) continue;
          await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: row.attemptId, commandKey: control.commandKey } }, data: { offeredAt: now, effect: "unknown" } });
          outgoing.push({ op: "inject", ...control });
        }
  }
  async reconcile(who: ExecutorPrincipal, input: ExecutorRequests["reconcile"]): Promise<ExecutorResponses["reconcile"]> {
    // Unknown device entries get explicit decisions; no remote identity becomes authority.
    let candidate: Traversal | undefined;
    return this.writer(who, "reconcile", { ...input, entries: [] }, async tx => {
      const state = await this.traversal(tx, who, input);
      candidate = state;
      if (state.lastRequest === input.requestId && state.lastResponse) return state.lastResponse;
      const decisions: ExecutorResponses["reconcile"]["decisions"] = [];
      for (const entry of input.entries) await this.reconcileEntry(tx, who, input, state, { entry, decisions });
      return this.finishTraversal(tx, who, input, state, decisions);
    }).then(async result => {
      if (candidate) this.traversals.set(who.executorId, candidate);
      for (const decision of result.decisions) if (decision.action === "ack_final") await this.ports.remoteCompletion?.committed(who.workspaceId, decision.target.runId);
      return result;
    });
  }
  async finishTraversal(tx: Prisma.TransactionClient, who: ExecutorPrincipal, input: ExecutorRequests["reconcile"], state: Traversal, decisions: ExecutorResponses["reconcile"]["decisions"]) {
      state.deviceComplete ||= input.complete;
      if (state.deviceComplete) {
        while (state.offset < state.rows.length && decisions.length < EXECUTOR_LIMITS.reconcileEntries) {
          const row = state.rows[state.offset++]!;
          if (!state.seen.has(row.assignmentId)) decisions.push({ target: target(row), action: row.finalizedAt ? "ack_final" : "stop" });
        }
      }
      const reconciled = state.deviceComplete && state.offset === state.rows.length && who.mode !== "drain";
      if (reconciled) await tx.executionExecutor.update({ where: { id: who.executorId }, data: { reconciledAt: this.ports.now(), authorizedUntil: new Date(this.ports.now().getTime() + EXECUTOR_LIMITS.graceMs) } });
      const after = state.deviceComplete && state.offset === state.rows.length ? null : randomUUID();
      const result = { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions, after, reconciled };
      state.cursor = after; state.lastRequest = input.requestId; state.lastResponse = result;
      return result;
  }
  async traversal(tx: Prisma.TransactionClient, who: ExecutorPrincipal, input: ExecutorRequests["reconcile"]): Promise<Traversal> {
      const fence = executorCanonicalJson({ executorId: who.executorId, generation: who.generation, incarnation: who.incarnation });
      const previous = this.traversals.get(who.executorId);
      let state = previous ? { ...previous, seen: new Set(previous.seen) } : undefined;
      if (state?.lastRequest === input.requestId) return state;
      if (input.after === null) {
        if (who.mode !== "drain") await tx.executionExecutor.update({ where: { id: who.executorId }, data: { reconciledAt: null, authorizedUntil: null } });
        const rows = await tx.executorAssignment.findMany({ where: { executorId: who.executorId, generation: who.generation }, select: snapshotSelect, orderBy: { assignmentId: "asc" }, take: EXECUTOR_LIMITS.assignmentRecords + 1 });
        if (rows.length > EXECUTOR_LIMITS.assignmentRecords) throw new CallError("capacity", "Assignment reconciliation capacity reached");
        state = { fence, cursor: null, rows, seen: new Set(), deviceComplete: false, offset: 0 };
      }
      if (!state || state.fence !== fence || state.cursor !== input.after) fail("Reconciliation cursor expired");
      if (state.deviceComplete && input.entries.length) fail("Reconciliation device snapshot already complete");
      return state;
  }
  async reconcileEntry(tx: Prisma.TransactionClient, who: ExecutorPrincipal, input: ExecutorRequests["reconcile"], state: Traversal, context: { entry: ExecutorRequests["reconcile"]["entries"][number]; decisions: ExecutorResponses["reconcile"]["decisions"] }) {
    const { entry, decisions } = context;
        if (state.seen.has(entry.target.assignmentId)) fail("Duplicate reconciliation entry");
        if (state.seen.size >= EXECUTOR_LIMITS.assignmentRecords) throw new CallError("capacity", "Device journal capacity reached");
        const known = state.rows.find(row => row.assignmentId === entry.target.assignmentId);
        state.seen.add(entry.target.assignmentId);
        if (!known) { decisions.push({ target: entry.target, action: "unknown" }); return; }
        await assertExecutorRequest(tx, { ...who, mode: who.mode === "active" ? "recovery" : who.mode }, "reconcile", { ...input, entries: [entry] });
        const row = await tx.executorAssignment.findUniqueOrThrow({ where: { attemptId: known.attemptId }, include });
        let finalized = row.finalizedAt !== null;
        if (entry.stop && row.final && !row.finalizedAt) {
          const final = row.final as unknown as ExecutorRequests["final"]["final"];
          const stop = await verifiedStop(tx, who, target(row), row, { proof: entry.stop, digest: row.finalDigest!, final });
          if (stop && this.ports.remoteCompletion) {
            await this.ports.remoteCompletion.commit(tx, { principal: owner(who, row.attempt), target: target(row), final, digest: row.finalDigest!, stop });
            await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { finalizedAt: this.ports.now() } });
            finalized = true;
          }
        }
        decisions.push({ target: target(row), action: finalized || row.attempt.stopConfirmedAt ? "ack_final" : "stop" });
  }
  readonly deliverRemoteControl = async (input: { target: ExecutorTarget; commandKey: string; text: string }) => {
    const row = await this.ports.db.executorAssignment.findUnique({ where: { attemptId: input.target.attemptId } });
    if (!row || row.assignmentId !== input.target.assignmentId || row.finalizedAt) fail("Assignment not live");
    const pending = this.controls.get(row.executorId) ?? [];
    if (pending.length >= EXECUTOR_LIMITS.controls) throw new CallError("capacity", "Live control capacity reached");
    if (!pending.some(value => value.commandKey === input.commandKey)) pending.push(input);
    this.controls.set(row.executorId, pending);
  };
}

type StopRow = Awaited<ReturnType<typeof assertExecutorTarget>>;
// eslint-disable-next-line complexity -- First recovered identity is admitted only with every frozen final-only provenance constraint.
async function verifiedStop(tx: Prisma.TransactionClient, who: ExecutorPrincipal, ref: ExecutorTarget, row: StopRow, context: { proof: ExecutorRequests["final"]["final"]["stop"]; digest: string; final: ExecutorRequests["final"]["final"] }): Promise<VerifiedDeviceStop | null> {
  const { proof, digest, final } = context;
  if (proof.kind === "unknown") return null;
  if (proof.kind === "never_started") {
    if (!await verifyNeverStarted(row, ref, proof.tombstoneDigest, final)) return null;
    await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { tombstoneDigest: proof.tombstoneDigest } });
  } else {
    if (!row.processIdentity) {
      if (who.mode === "drain" || !row.offeredAt || !row.launch || !row.launchDigest || final.outcome.outcome !== "unavailable" || !final.missing || final.changes || final.throughSourceSeq < row.sourceHighWatermark || proof.identity.unit !== `chrona-executor-${await executorDigest({ executorId: row.executorId, assignmentId: row.assignmentId })}.service`) return null;
      await assertSourceReceipt(row.launch as unknown as ExecutorAssignment, final.sourceReceipt);
      if (row.attempt.sourceReceipt && executorCanonicalJson(row.attempt.sourceReceipt) !== executorCanonicalJson(final.sourceReceipt)) return null;
      await tx.executorAssignment.update({ where: { attemptId: row.attemptId }, data: { processIdentity: json(proof.identity) } });
      await tx.executionAttempt.update({ where: { id: row.attemptId }, data: { sourceReceipt: final.sourceReceipt ? json(final.sourceReceipt) : Prisma.JsonNull } });
    } else if (executorCanonicalJson(row.processIdentity) !== executorCanonicalJson(proof.identity)) return null;
  }
  // Device credential trusts its local journal/manager adapter; this is not malicious-device OS attestation.
  return { executorId: who.executorId, generation: who.generation, target: ref, digest, proof };
}
async function verifyNeverStarted(row: StopRow, ref: ExecutorTarget, tombstone: string, final: ExecutorRequests["final"]["final"]) {
  if ([row.processIdentity, row.startedAt, row.sourceHighWatermark, row.sourceProducedThrough, row.attempt.sourceReceipt].some(Boolean)) return false;
  if (final.throughSourceSeq !== 0 || final.sourceReceipt !== null || final.outcome.outcome === "finished") return false;
  if (!row.launchDigest) return false;
  const prelaunch = await executorDigest({ kind: "executor_prelaunch_never_started", target: ref, launchDigest: row.launchDigest });
  if (tombstone === prelaunch) return row.tombstoneDigest === null || row.tombstoneDigest === prelaunch;
  const neverOffered = await executorDigest({ assignmentId: row.assignmentId, launchDigest: row.launchDigest, kind: "never_offered" });
  return !row.offeredAt && row.tombstoneDigest === neverOffered && tombstone === neverOffered;
}

async function assertSourceReceipt(launch: ExecutorAssignment, receipt: import("@chrona/contracts/steward").ExecutionSourceReceipt | null) {
  const files = launch.source?.files ?? [];
  if (!files.length) { if (receipt) fail("Empty manifest has no source receipt"); return; }
  if (!receipt) fail("Manifest source receipt required");
  const placement = { executorId: launch.executorId, projectRef: launch.mapping.projectRef, mappingRevision: launch.mapping.mappingRevision };
  const manifestDigest = await executorDigest({ files: [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
  if (receipt.fileCount !== files.length || receipt.manifestDigest !== manifestDigest || executorCanonicalJson(receipt.placement) !== executorCanonicalJson(placement) || executorCanonicalJson(receipt.baseline) !== executorCanonicalJson(launch.mapping.baseline)) fail("Source receipt binding mismatch");
}
