import {
  EXECUTION_EVENT_LIMITS as limits, executionJsonBytes, executionEventSchema, executionSnapshotSchema, executionControlSchema,
  type ExecutionEvent, type ExecutionPrincipal, type ExecutionRef, type ExecutionSnapshot, type ExecutionEventRead, type ExecutionEventPage,
} from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { CallError } from "./module-calls";
import type { StewardPorts } from "./ports";
import { projectExecutionEvent, projectExecutionSnapshot } from "./execution-event-projection";
import { executionCursor, executionLifecycle, executionPosition, executionWait, reduceExecutionEvent, retainedExecutionSnapshot } from "./execution-events";
import { hasLiveProviderInteraction } from "./provider-channel";

type Tx = Prisma.TransactionClient;
type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
function refOf(a: Attempt): ExecutionRef {
  if (!a.run.sessionId) throw new CallError("unavailable", "Execution run has no session");
  return { workId: a.workId, sessionId: a.run.sessionId, runId: a.runId, attemptId: a.id };
}
const json = (value: object) => value as unknown as Prisma.InputJsonValue;
const terminal = (status: string) => status === "completed" || status === "failed" || status === "cancelled";

async function authorize(db: Tx, p: ExecutionPrincipal, ref: ExecutionRef, activeCaller = true): Promise<Attempt> {
  const a = await db.executionAttempt.findUnique({ where: { id: ref.attemptId }, include: { run: true } });
  if (!a) throw new CallError("not_found", "Execution attempt not found");
  if (a.workspaceId !== p.workspaceId || a.ownerId !== p.ownerId) throw new CallError("forbidden", "Execution scope denied");
  await authorizeModule(db, p, a, activeCaller);
  if (a.workId !== ref.workId || a.runId !== ref.runId || a.run.sessionId !== ref.sessionId) throw new CallError("conflict", "Execution reference mismatch");
  return a;
}
async function authorizeModule(db: Tx, p: ExecutionPrincipal, a: Attempt, activeCaller: boolean) {
  if (p.caller.kind === "module") {
    if (a.moduleId !== p.caller.moduleId || a.callerHash !== p.caller.hash || a.callerKey !== `module:${p.caller.moduleId}`) throw new CallError("forbidden", "Execution caller denied");
    if (activeCaller) {
      const active = await db.module.findFirst({ where: { id: p.caller.moduleId, workspaceId: p.workspaceId, activeHash: p.caller.hash, status: "active" }, select: { id: true } });
      if (!active) throw new CallError("forbidden", "Execution caller is no longer active");
    }
  }
}

function initial(a: Attempt, now: Date): ExecutionSnapshot {
  const status = a.run.status === "finished" ? "completed" : a.run.status === "timed_out" || a.run.status === "provider_unavailable" ? "failed" : a.run.status === "queued" || a.run.status === "running" || a.run.status === "failed" || a.run.status === "cancelled" ? a.run.status : "unknown";
  return { ...refOf(a), highWatermark: a.highWatermark, status, cancelRequested: a.cancelRequestedAt !== null, stopConfirmed: a.stopConfirmedAt !== null,
    finalMessage: null, questions: [], missing: a.highWatermark > 0, expiresAt: new Date(now.getTime() + limits.snapshotRetentionMs).toISOString() };
}

function persistedSnapshot(value: unknown, ref: ExecutionRef): ExecutionSnapshot {
  const parsed = executionSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new CallError("unavailable", "Stored execution snapshot is invalid");
  const s = parsed.data;
  if (s.workId !== ref.workId || s.sessionId !== ref.sessionId || s.runId !== ref.runId || s.attemptId !== ref.attemptId) throw new CallError("unavailable", "Stored execution snapshot reference is invalid");
  return s;
}

async function loadSnapshot(tx: Tx, a: Attempt, now: Date): Promise<ExecutionSnapshot> {
  const row = await tx.executionSnapshot.findUnique({ where: { attemptId: a.id } });
  if (!row || a.stopConfirmedAt && row.expiresAt <= now) return { ...initial(a, now), missing: true };
  return persistedSnapshot(row.snapshot, refOf(a));
}

/** Indexed, finite reclamation; each deletion and its charge change share the writer transaction. */
async function reclaim(tx: Tx, now: Date) {
  const expired = await tx.executionDetail.findMany({ where: { expiresAt: { lte: now }, attempt: { stopConfirmedAt: { not: null } } }, orderBy: { expiresAt: "asc" }, take: limits.pageEvents, select: { attemptId: true, seq: true, bytes: true } });
  for (const row of expired) {
    await tx.executionDetail.delete({ where: { attemptId_seq: { attemptId: row.attemptId, seq: row.seq } } });
    await tx.executionAttempt.update({ where: { id: row.attemptId }, data: { detailBytes: { decrement: row.bytes } } });
  }
  const snapshots = await tx.executionSnapshot.findMany({ where: { expiresAt: { lte: now }, attempt: { stopConfirmedAt: { not: null } } }, orderBy: { expiresAt: "asc" }, take: limits.pageEvents, select: { attemptId: true } });
  for (const row of snapshots) {
    await tx.executionSnapshot.delete({ where: { attemptId: row.attemptId } });
    await tx.executionControl.deleteMany({ where: { attemptId: row.attemptId } });
    await tx.executionAttempt.update({ where: { id: row.attemptId }, data: { snapshotChargeBytes: 0, controlChargeBytes: 0 } });
  }
}

async function ensureCapacity(tx: Tx, snapshotDelta = 0, controlDelta = 0, detailDelta = 0) {
  const sum = (await tx.executionAttempt.aggregate({ _sum: { snapshotChargeBytes: true, controlChargeBytes: true, detailBytes: true } }))._sum;
  if ((sum.snapshotChargeBytes ?? 0) + snapshotDelta > limits.snapshotGlobalBytes || (sum.controlChargeBytes ?? 0) + controlDelta > limits.controlGlobalBytes || (sum.detailBytes ?? 0) + detailDelta > limits.detailGlobalBytes) throw new CallError("capacity", "Execution storage capacity exhausted; retained history must expire before retry");
}

async function writeSnapshot(tx: Tx, a: Attempt, snapshot: ExecutionSnapshot, now: Date) {
  const expiresAt = new Date(now.getTime() + limits.snapshotRetentionMs);
  const saved = { ...snapshot, highWatermark: a.highWatermark, expiresAt: expiresAt.toISOString() };
  const bytes = executionJsonBytes(saved);
  if (bytes > limits.snapshotBytes) throw new CallError("too_large", "Execution snapshot exceeds byte limit");
  const finished = terminal(snapshot.status) && a.stopConfirmedAt !== null;
  const controls = finished ? (await tx.executionControl.aggregate({ where: { attemptId: a.id }, _sum: { bytes: true } }))._sum.bytes ?? 0 : limits.controlBytes * limits.controlSlotsPerAttempt;
  const charge = finished ? bytes : limits.snapshotBytes;
  await ensureCapacity(tx, charge - a.snapshotChargeBytes, controls - a.controlChargeBytes);
  await tx.executionSnapshot.upsert({ where: { attemptId: a.id }, create: { attemptId: a.id, snapshot: json(saved), bytes, expiresAt }, update: { snapshot: json(saved), bytes, expiresAt } });
  await tx.executionAttempt.update({ where: { id: a.id }, data: { snapshotChargeBytes: charge, controlChargeBytes: controls } });
  if (finished) await tx.executionDetail.updateMany({ where: { attemptId: a.id }, data: { expiresAt: new Date(a.stopConfirmedAt!.getTime() + limits.detailRetentionMs) } });
}

function assertPageBounds(input: ExecutionEventRead) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > limits.pageEvents || !Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > limits.pollMs) throw new CallError("invalid", "Invalid execution page bounds");
}
function persistedEvent(value: unknown, seq: number, a: Attempt): ExecutionEvent {
  const parsed = executionEventSchema.safeParse(value);
  if (!parsed.success) throw new CallError("unavailable", "Stored execution event is invalid");
  const event = parsed.data;
  if (event.attemptId !== a.id || event.seq !== seq || event.workId !== a.workId || event.runId !== a.runId || event.sessionId !== a.run.sessionId) throw new CallError("unavailable", "Stored execution event reference is invalid");
  return event;
}
function pageReady(result: ExecutionEventPage) { return result.events.length > 0 || result.gap || result.snapshotRequired; }
const polls = new Map<string, number>();

export function createExecutionEventStore(ports: StewardPorts): NonNullable<StewardPorts["executionEvents"]> {
  async function page(p: ExecutionPrincipal, input: ExecutionEventRead): Promise<ExecutionEventPage> {
    const a = await authorize(ports.db, p, input);
    assertPageBounds(input);
    const { after, lifecycle: observed } = executionPosition(input, input.cursor);
    if (after > a.highWatermark) throw new CallError("conflict", "Execution cursor is ahead of persisted history");
    const now = ports.now();
    const stored = await ports.db.executionSnapshot.findUnique({ where: { attemptId: a.id }, select: { snapshot: true } });
    // Independent lifecycle position: never consumes a sequence allocated by F's detail sink.
    const lifecycle = stored ? executionLifecycle(persistedSnapshot(stored.snapshot, input)) : "missing";
    const changed = lifecycle !== observed;
    const rows = await ports.db.executionDetail.findMany({ where: { attemptId: a.id, seq: { gt: after }, ...(a.stopConfirmedAt ? { expiresAt: { gt: now } } : {}) }, orderBy: { seq: "asc" }, take: input.limit });
    const result: ExecutionEventPage = { events: [], cursor: executionCursor(input, after, lifecycle), highWatermark: a.highWatermark, gap: false, snapshotRequired: changed };
    let position = after;
    for (const row of rows) {
      const event = persistedEvent(row.event, row.seq, a);
      const gap = result.gap || event.seq !== position + 1 || event.payload.type === "gap";
      const candidate = { ...result, events: [...result.events, event], cursor: executionCursor(input, event.seq, lifecycle), gap, snapshotRequired: changed || gap };
      if (executionJsonBytes(candidate) > limits.pageBytes) break;
      Object.assign(result, candidate); position = event.seq;
    }
    if (rows.length < input.limit && result.events.length === rows.length && position < a.highWatermark) { result.gap = true; result.snapshotRequired = true; result.cursor = executionCursor(input, a.highWatermark, lifecycle); }
    return result;
  }
  async function pollPage(p: ExecutionPrincipal, input: ExecutionEventRead, result: ExecutionEventPage) {
    const deadline = Date.now() + input.waitMs;
    while (!input.signal?.aborted && Date.now() < deadline) {
      await executionWait(input.signal, deadline - Date.now());
      if (input.signal?.aborted) break;
      result = await page(p, input);
      if (pageReady(result)) break;
    }
    return result;
  }
  return {
    async admit(tx, p, ref) {
      const a = await authorize(tx, p, ref);
      if (a.snapshotChargeBytes || a.controlChargeBytes) return;
      await reclaim(tx, ports.now());
      await writeSnapshot(tx, a, initial(a, ports.now()), ports.now());
    },
    async control(tx, p, ref, fact) {
      // Trusted F lifecycle seam: the admission principal survives module pause/version changes.
      const a = await authorize(tx, p, ref, false);
      const parsed = executionControlSchema.safeParse(fact);
      if (!parsed.success) throw new CallError("invalid", "Invalid execution control fact");
      const bytes = executionJsonBytes(parsed.data);
      const prior = await tx.executionControl.findUnique({ where: { attemptId_slot: { attemptId: a.id, slot: fact.slot } }, select: { bytes: true } });
      // Active reservations cover all four slots; terminal records pay actual bytes.
      const reserved = a.controlChargeBytes === limits.controlBytes * limits.controlSlotsPerAttempt;
      const delta = reserved ? 0 : bytes - (prior?.bytes ?? 0);
      await ensureCapacity(tx, 0, delta);
      await tx.executionControl.upsert({ where: { attemptId_slot: { attemptId: a.id, slot: fact.slot } }, create: { attemptId: a.id, slot: fact.slot, fact: json(parsed.data), bytes }, update: { fact: json(parsed.data), bytes } });
      if (delta) await tx.executionAttempt.update({ where: { id: a.id }, data: { controlChargeBytes: { increment: delta } } });
    },
    async saveSnapshot(tx, p, value) {
      const a = await authorize(tx, p, value, false);
      if (executionJsonBytes(value) > limits.snapshotBytes) throw new CallError("too_large", "Execution snapshot exceeds byte limit");
      const parsed = executionSnapshotSchema.safeParse(value);
      if (!parsed.success) throw new CallError("invalid", "Invalid execution snapshot");
      if (value.highWatermark !== a.highWatermark || value.stopConfirmed !== (a.stopConfirmedAt !== null) || value.cancelRequested !== (a.cancelRequestedAt !== null) || terminal(value.status) && !a.stopConfirmedAt) throw new CallError("conflict", "Execution snapshot does not match persisted stop/sequence facts");
      await writeSnapshot(tx, a, projectExecutionSnapshot(parsed.data), ports.now());
    },
    async append(p, raw) {
      await ports.db.$transaction(async tx => {
        // First statement acquires SQLite's writer lock, before reading quota/sequence facts.
        await tx.executionAttempt.updateMany({ where: { id: raw.attemptId, workspaceId: p.workspaceId, ownerId: p.ownerId }, data: { detailBytes: { increment: 0 } } });
        if (executionJsonBytes(raw) > limits.eventBytes) throw new CallError("too_large", "Execution event exceeds byte limit");
        const parsed = executionEventSchema.safeParse(raw);
        if (!parsed.success) throw new CallError("invalid", "Invalid normalized execution event");
        await appendExecutionEventIn(ports, tx, p, parsed.data, { activeCaller: true });
      }).catch((error: unknown) => {
        if (error instanceof CallError) throw error;
        const failure = new CallError("unavailable", "Execution event persistence failed; write was not acknowledged");
        failure.cause = error;
        throw failure;
      });
    },
    async read(p, input) {
      const result = await page(p, input);
      if (pageReady(result) || !input.waitMs || input.signal?.aborted) return result;
      const key = JSON.stringify([p.workspaceId, p.ownerId]), count = polls.get(key) ?? 0;
      if (count >= limits.ownerPolls) throw new CallError("capacity", "Too many execution polls for owner");
      polls.set(key, count + 1);
      try {
        return await pollPage(p, input, result);
      } finally {
        const remaining = (polls.get(key) ?? 1) - 1;
        if (remaining) polls.set(key, remaining); else polls.delete(key);
      }
    },
    async snapshot(p, ref) {
      const a = await authorize(ports.db, p, ref);
      const snapshot = await loadSnapshot(ports.db, a, ports.now());
      const retained = retainedExecutionSnapshot(snapshot, ports.now());
      return { ...retained, questions: retained.questions.map((question, index) =>
        snapshot.questions[index]!.status === "pending" && hasLiveProviderInteraction(ports, a.workspaceId, a.runId, question.requestId)
          ? snapshot.questions[index]! : question) };
    },
  };
}

/** Caller holds the SQLite writer lock; persisted highWatermark is the only storedSeq allocator. */
export async function appendExecutionEventIn(ports: StewardPorts, tx: Tx, p: ExecutionPrincipal, raw: ExecutionEvent, options: { allocate?: boolean; activeCaller?: boolean } = {}): Promise<number> {
  const a = await authorize(tx, p, raw, options.activeCaller ?? false);
  if (options.allocate) {
    const seq = a.highWatermark + 1;
    raw = { ...raw, seq, ...(raw.payload.type === "gap" ? { payload: { ...raw.payload, from: seq, through: seq } } : {}) };
  }
  if (executionJsonBytes(raw) > limits.eventBytes) throw new CallError("too_large", "Execution event exceeds byte limit");
  const event = projectExecutionEvent(raw), bytes = executionJsonBytes(event);
  if (bytes > limits.eventBytes) throw new CallError("too_large", "Projected execution event exceeds byte limit");
  const prior = await tx.executionDetail.findUnique({ where: { attemptId_seq: { attemptId: a.id, seq: event.seq } } });
  if (prior) { assertRetainedEvent(prior.event, event); return event.seq; }
  if (event.seq <= a.highWatermark) throw new CallError("conflict", "Execution sequence is out of order or no longer retained");
  if (a.stopConfirmedAt) throw new CallError("conflict", "Execution attempt has already stopped");
  await reclaim(tx, ports.now());
  if (a.detailBytes + bytes > limits.attemptBytes) throw new CallError("capacity", "Execution attempt detail capacity exhausted");
  await ensureCapacity(tx, 0, 0, bytes);
  const now = ports.now(), snapshot = await loadSnapshot(tx, a, now);
  await tx.executionDetail.create({ data: { attemptId: a.id, seq: event.seq, event: json(event), bytes, expiresAt: new Date(now.getTime() + limits.detailRetentionMs) } });
  await tx.executionAttempt.update({ where: { id: a.id }, data: { highWatermark: event.seq, detailBytes: { increment: bytes } } });
  await writeSnapshot(tx, { ...a, highWatermark: event.seq }, reduceExecutionEvent(snapshot, event), now);
  return event.seq;
}

function assertRetainedEvent(stored: unknown, event: ExecutionEvent) {
  const saved = executionEventSchema.safeParse(stored);
  if (!saved.success) throw new CallError("unavailable", "Stored execution event is invalid");
  if (JSON.stringify(saved.data) !== JSON.stringify(event)) throw new CallError("conflict", "Execution sequence already has different content");
}
