import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { EXECUTION_EVENT_LIMITS as limits, executionEventPageSchema, executionJsonBytes, type ExecutionEvent, type ExecutionPrincipal, type ExecutionRef, type ExecutionSnapshot } from "@chrona/contracts/steward";
import { createExecutionEventStore } from "./execution-event-store";
import { executionCursor } from "./execution-events";
import type { StewardPorts } from "./ports";
import { createProviderChannel } from "./provider-channel";
import { liveRuns } from "./runs";

let root: string, db: PrismaClient, ports: StewardPorts, store: ReturnType<typeof createExecutionEventStore>, time: Date;
let principal: ExecutionPrincipal, owner: ExecutionPrincipal;
const clients: PrismaClient[] = [];
function connect() { const client = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${join(root, "test.db")}` }) }); clients.push(client); return client; }
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "chrona-event-store-")); time = new Date("2026-11-05T00:00:00.000Z");
  ensureSqliteDatabase({ databaseUrl: `file:${join(root, "test.db")}`, migrationsDir: resolve("prisma/migrations") });
  db = connect(); await db.workspace.create({ data: { id: "ws", name: "test" } });
  await db.module.create({ data: { id: "mod", workspaceId: "ws", name: "coding", activeHash: "hash" } });
  principal = { workspaceId: "ws", ownerId: "owner", caller: { kind: "module", moduleId: "mod", hash: "hash" } };
  owner = { workspaceId: "ws", ownerId: "owner", caller: { kind: "owner" } };
  ports = { db, now: () => time, dataDir: root, publicUrl: null }; store = createExecutionEventStore(ports);
});
afterEach(async () => { for (const client of clients.splice(0)) await client.$disconnect(); rmSync(root, { recursive: true, force: true }); });
async function attempt(id = "a", admit = true): Promise<ExecutionRef> {
  const ref = { workId: `w-${id}`, sessionId: `s-${id}`, runId: `r-${id}`, attemptId: id };
  await db.$transaction(async tx => {
    await tx.session.create({ data: { id: ref.sessionId, workspaceId: "ws", key: id, source: "execution" } });
    await tx.run.create({ data: { id: ref.runId, workspaceId: "ws", sessionId: ref.sessionId, lane: "foreground", trigger: "execution", provider: "fake", tokenHash: id, prompt: "test", cwd: `/tmp/${id}` } });
    await tx.executionAttempt.create({ data: { id, workspaceId: "ws", ownerId: "owner", callerKey: "module:mod", moduleId: "mod", callerHash: "hash", workId: ref.workId, commandKey: id, requestDigest: id, runId: ref.runId, projectRef: "test", projectDigest: "digest", resolvedCwd: `/tmp/${id}`, logDir: `/tmp/log-${id}`, baseline: "baseline", budget: {}, heldDirectory: `/tmp/${id}` } });
    if (admit) await store.admit(tx, principal, ref);
  }); return ref;
}
function event(ref: ExecutionRef, seq = 1, text = "safe"): ExecutionEvent { return { ...ref, seq, at: time.toISOString(), payload: { type: "message", messageId: `m${seq}`, role: "assistant", text, complete: true } }; }
const read = (ref: ExecutionRef, cursor?: string, limit = 100) => store.read(owner, { ...ref, cursor, limit, waitMs: 0 });
async function finish(ref: ExecutionRef, extra: Partial<ExecutionSnapshot> = {}) {
  const snapshot = await store.snapshot(owner, ref);
  await db.$transaction(async tx => {
    await tx.run.update({ where: { id: ref.runId }, data: { status: "finished" } });
    await tx.executionAttempt.update({ where: { id: ref.attemptId }, data: { stopConfirmedAt: time, stopEvidence: { kind: "exit", code: 0 }, heldDirectory: null } });
    await store.control(tx, owner, ref, { slot: "terminal", at: time.toISOString(), status: "confirmed" });
    await store.saveSnapshot(tx, owner, { ...snapshot, ...extra, status: "completed", stopConfirmed: true });
  });
}

test("admission and fixed controls participate in caller rollback", async () => {
  const ref = await attempt("a", false);
  await expect(db.$transaction(async tx => { await store.admit(tx, principal, ref); await store.control(tx, principal, ref, { slot: "admission", at: time.toISOString(), status: "confirmed" }); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect(await db.executionSnapshot.count()).toBe(0); expect(await db.executionControl.count()).toBe(0);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: "a" } })).controlChargeBytes).toBe(0);
});
test("restart with fresh client resumes cursor and final snapshot without live question authority", async () => {
  const ref = await attempt(); await store.append(principal, event(ref));
  const first = await read(ref); await store.append(principal, { ...event(ref, 2), payload: { type: "question", question: { requestId: "q", title: "Continue?", method: "confirm", options: [], expiresAt: new Date(time.getTime() + 60_000).toISOString(), status: "pending" } } });
  await store.append(principal, event(ref, 3, "Final result")); await finish(ref);
  const restarted = createExecutionEventStore({ ...ports, db: connect() });
  const page = await restarted.read(owner, { ...ref, cursor: first.cursor, limit: 100, waitMs: 0 });
  expect(page.events.map(e => e.seq)).toEqual([2, 3]);
  expect(await restarted.snapshot(owner, ref)).toMatchObject({ status: "completed", stopConfirmed: true, finalMessage: { text: "Final result" }, questions: [{ status: "interrupted" }] });
  const row = await db.executionAttempt.findUniqueOrThrow({ where: { id: "a" } });
  expect(row.snapshotChargeBytes).toBeLessThan(limits.snapshotBytes); expect(row.controlChargeBytes).toBeLessThan(limits.controlBytes);
});
test("snapshot keeps only the real live question pending and a fresh database client cannot revive it", async () => {
  const ref = await attempt();
  const deadline = new Date(time.getTime() + 60_000);
  await db.run.update({ where: { id: ref.runId }, data: { status: "running", deadlineAt: deadline, leaseUntil: deadline } });
  let observed!: () => void;
  const ready = new Promise<void>(resolve => { observed = resolve; });
  let sequence = 0;
  const channel = createProviderChannel(ports, { id: ref.runId, workspaceId: "ws", sessionId: ref.sessionId, deadlineAt: deadline }, async request => {
    await store.append(principal, { ...ref, seq: ++sequence, at: time.toISOString(), payload: { type: "question", question: {
      requestId: request.id, title: request.question.title, method: request.question.method, options: request.question.options, expiresAt: request.expiresAt, status: request.status,
    } } });
    observed();
  });
  liveRuns.set(ref.runId, { done: new Promise(() => {}), abort: async () => {}, inject: async () => {} });
  const controller = new AbortController();
  const answer = channel.events.question({ method: "confirm", title: "Actual question", message: "Continue?", options: [], timeoutMs: 60_000 }, controller.signal);
  try {
    await ready;
    expect((await store.snapshot(owner, ref)).questions[0]?.status).toBe("pending");
    const fresh = createExecutionEventStore({ ...ports, db: connect() });
    expect((await fresh.snapshot(owner, ref)).questions[0]?.status).toBe("interrupted");
    liveRuns.delete(ref.runId);
    expect((await store.snapshot(owner, ref)).questions[0]?.status).toBe("interrupted");
  } finally { controller.abort(); await answer; await channel.close(); liveRuns.delete(ref.runId); }
});
test("duplicate is no-op, conflicting duplicate rejects, missing and out-of-order sequences explicit", async () => {
  const ref = await attempt(), e = event(ref); await store.append(principal, e); await store.append(principal, e);
  expect(await db.executionDetail.count()).toBe(1);
  await expect(store.append(principal, event(ref, 1, "different"))).rejects.toMatchObject({ code: "conflict" });
  await store.append(principal, event(ref, 3));
  expect(await read(ref)).toMatchObject({ gap: true, snapshotRequired: true, highWatermark: 3 });
  await expect(store.append(principal, event(ref, 2))).rejects.toMatchObject({ code: "conflict" });
});
test("authorization independently checks workspace owner actual module/hash and exact reference before reading", async () => {
  const ref = await attempt(); await store.append(principal, event(ref));
  for (const p of [{ ...owner, workspaceId: "other" }, { ...owner, ownerId: "other" }, { ...principal, caller: { kind: "module" as const, moduleId: "replacement", hash: "hash" } }, { ...principal, caller: { kind: "module" as const, moduleId: "mod", hash: "old" } }]) {
    await expect(store.read(p, { ...ref, limit: 1, waitMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.append(p, event(ref, 2))).rejects.toMatchObject({ code: "forbidden" });
  }
  await expect(read({ ...ref, sessionId: "wrong" })).rejects.toMatchObject({ code: "conflict" });
  await db.module.update({ where: { id: "mod" }, data: { activeHash: "new" } });
  await expect(store.snapshot(principal, ref)).rejects.toMatchObject({ code: "forbidden" });
  expect((await store.snapshot(owner, ref)).finalMessage!.text).toBe("safe");
});
test("trusted F terminal transaction can finish original attempt after module pause/hash switch", async () => {
  const ref = await attempt(), snapshot = await store.snapshot(principal, ref);
  await db.module.update({ where: { id: "mod" }, data: { activeHash: "replacement", status: "paused" } });
  await expect(store.read(principal, { ...ref, limit: 1, waitMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
  await db.$transaction(async tx => {
    await tx.run.update({ where: { id: ref.runId }, data: { status: "finished" } });
    await tx.executionAttempt.update({ where: { id: ref.attemptId }, data: { stopConfirmedAt: time, heldDirectory: null } });
    await store.control(tx, principal, ref, { slot: "terminal", at: time.toISOString(), status: "confirmed" });
    await store.saveSnapshot(tx, principal, { ...snapshot, status: "completed", stopConfirmed: true });
  });
  expect(await store.snapshot(owner, ref)).toMatchObject({ status: "completed", stopConfirmed: true });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).snapshotChargeBytes).toBeLessThan(limits.snapshotBytes);
});
test("cursor malformed, cross-reference and future positions fail; indexed pages remain count and byte bounded", async () => {
  const ref = await attempt();
  for (let n = 1; n <= 14; n++) await store.append(principal, event(ref, n, "x".repeat(24_000)));
  const page = await read(ref); expect(page.events.length).toBeLessThan(14); expect(page.events.length).toBeGreaterThan(0);
  expect(executionJsonBytes(page)).toBeLessThanOrEqual(limits.pageBytes); expect(executionEventPageSchema.safeParse(page).success).toBe(true);
  expect((await read(ref, page.cursor, 1)).events[0]!.seq).toBe(page.events.at(-1)!.seq + 1);
  await expect(read(ref, "!!!")).rejects.toMatchObject({ code: "invalid" });
  await expect(read(ref, executionCursor({ ...ref, attemptId: "other" }, 0))).rejects.toMatchObject({ code: "conflict" });
  await expect(read(ref, executionCursor(ref, 1000))).rejects.toMatchObject({ code: "conflict" });
});
test("detail expires after stop; highWatermark and final snapshot survive atomic reclamation", async () => {
  const ref = await attempt(); await store.append(principal, event(ref)); await finish(ref);
  time = new Date(time.getTime() + limits.detailRetentionMs + 1);
  expect(await read(ref)).toMatchObject({ events: [], highWatermark: 1, gap: true, snapshotRequired: true });
  await attempt("next"); expect(await db.executionDetail.count({ where: { attemptId: "a" } })).toBe(0);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: "a" } })).detailBytes).toBe(0);
  expect((await store.snapshot(owner, ref)).finalMessage!.text).toBe("safe");
  time = new Date(time.getTime() + limits.snapshotRetentionMs);
  await attempt("after-retention"); expect((await store.snapshot(owner, ref)).missing).toBe(true);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: "a" } })).snapshotChargeBytes).toBe(0);
});
test("64 active reservations reject capacity; small completed history permits more than 65 attempts", async () => {
  const refs: ExecutionRef[] = [];
  for (let n = 0; n < limits.snapshotGlobalBytes / limits.snapshotBytes; n++) refs.push(await attempt(`a${n}`));
  await expect(attempt("overflow")).rejects.toMatchObject({ code: "capacity" });
  expect(await db.executionAttempt.count({ where: { id: "overflow" } })).toBe(0);
  expect(await db.run.count({ where: { id: "r-overflow" } })).toBe(0);
  for (const ref of refs) await finish(ref);
  for (let n = 64; n < 70; n++) { const ref = await attempt(`a${n}`); await finish(ref); }
  expect(await db.executionSnapshot.count()).toBe(70);
}, 30_000);
test("persistent global/attempt quotas reject detail while final and four control facts remain writable", async () => {
  const ref = await attempt();
  await db.executionAttempt.update({ where: { id: ref.attemptId }, data: { detailBytes: limits.attemptBytes } });
  await expect(store.append(principal, event(ref))).rejects.toMatchObject({ code: "capacity" });
  await db.executionAttempt.update({ where: { id: ref.attemptId }, data: { detailBytes: 0 } });
  const other = await attempt("other"); await db.executionAttempt.update({ where: { id: other.attemptId }, data: { detailBytes: limits.detailGlobalBytes } });
  const fresh = createExecutionEventStore({ ...ports, db: connect() });
  await expect(fresh.append(principal, event(ref))).rejects.toMatchObject({ code: "capacity" });
  await db.$transaction(async tx => { for (const slot of ["admission", "cancel", "revoke", "terminal"] as const) await store.control(tx, principal, ref, { slot, at: time.toISOString(), status: "unknown" }); });
  await finish(ref, { missing: true, finalMessage: { messageId: "final", text: "Final despite saturation", truncated: false } });
  expect((await store.snapshot(owner, ref)).finalMessage!.text).toBe("Final despite saturation");
  expect(await db.executionControl.count({ where: { attemptId: ref.attemptId } })).toBe(limits.controlSlotsPerAttempt);
});
test("finish transaction failure rolls back Run status, stop evidence, snapshot and reservation release", async () => {
  const ref = await attempt(), snapshot = await store.snapshot(owner, ref);
  await expect(db.$transaction(async tx => {
    await tx.run.update({ where: { id: ref.runId }, data: { status: "finished" } });
    await tx.executionAttempt.update({ where: { id: ref.attemptId }, data: { stopConfirmedAt: time, heldDirectory: null } });
    await store.saveSnapshot(tx, owner, { ...snapshot, status: "completed", stopConfirmed: true }); throw new Error("finish rollback");
  })).rejects.toThrow("finish rollback");
  const a = await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId }, include: { run: true } });
  expect(a.stopConfirmedAt).toBeNull(); expect(a.heldDirectory).not.toBeNull(); expect(a.run.status).toBe("queued"); expect(a.snapshotChargeBytes).toBe(limits.snapshotBytes);
});
test("raw oversize and malformed data rejected, sensitive output redacted before persistence", async () => {
  const ref = await attempt();
  await expect(store.append(principal, event(ref, 1, "x".repeat(limits.eventBytes)))).rejects.toMatchObject({ code: "too_large" });
  await expect(store.append(principal, { ...event(ref), private: "raw" } as ExecutionEvent)).rejects.toMatchObject({ code: "invalid" });
  await store.append(principal, event(ref, 1, "TOKEN=fixture-secret https://user:pass@example.test"));
  expect(JSON.stringify((await db.executionDetail.findFirstOrThrow()).event)).not.toContain("fixture-secret");
  expect(JSON.stringify((await db.executionSnapshot.findFirstOrThrow()).snapshot)).not.toContain("example.test");
});
test("owner poll cap shared across store instances; abort promptly frees slots and authorization precedes allocation", async () => {
  const ref = await attempt(), controllers = Array.from({ length: limits.ownerPolls }, () => new AbortController());
  const { cursor } = await read(ref);
  const pending = controllers.map(controller => store.read(owner, { ...ref, cursor, limit: 1, waitMs: 15_000, signal: controller.signal }));
  await Bun.sleep(40);
  await expect(createExecutionEventStore(ports).read(owner, { ...ref, cursor, limit: 1, waitMs: 1 })).rejects.toMatchObject({ code: "capacity" });
  await expect(store.read({ ...owner, ownerId: "other" }, { ...ref, cursor, limit: 1, waitMs: 1 })).rejects.toMatchObject({ code: "forbidden" });
  const start = Date.now(); controllers.forEach(c => c.abort()); await Promise.all(pending); expect(Date.now() - start).toBeLessThan(200);
  expect((await store.read(owner, { ...ref, cursor, limit: 1, waitMs: 1 })).events).toEqual([]);
});
test("control slot whitelist cannot create overflow buckets and failed snapshot cannot release headroom", async () => {
  const ref = await attempt(), snapshot = await store.snapshot(owner, ref);
  await expect(db.$transaction(tx => store.control(tx, owner, ref, { slot: "overflow", at: time.toISOString(), status: "confirmed" } as never))).rejects.toMatchObject({ code: "invalid" });
  await expect(db.$transaction(tx => store.saveSnapshot(tx, owner, { ...snapshot, status: "completed", stopConfirmed: true }))).rejects.toMatchObject({ code: "conflict" });
  expect(await db.executionControl.count()).toBe(0);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: "a" } })).snapshotChargeBytes).toBe(limits.snapshotBytes);
});
for (const detailCount of [0, 1]) test(`saturated detail lifecycle unknown then confirmed is discoverable once without consuming seq (${detailCount} detail)`, async () => {
  const ref = await attempt();
  if (detailCount) await store.append(principal, event(ref));
  const consumed = await read(ref);
  await db.executionAttempt.update({ where: { id: ref.attemptId }, data: { detailBytes: limits.attemptBytes } });
  await expect(store.append(principal, event(ref, detailCount + 1))).rejects.toMatchObject({ code: "capacity" });
  const beforeUnknown = await store.snapshot(owner, ref);
  await db.$transaction(async tx => {
    await tx.run.update({ where: { id: ref.runId }, data: { status: "failed" } });
    await tx.executionAttempt.update({ where: { id: ref.attemptId }, data: { capabilityRevokedAt: time } });
    await store.control(tx, principal, ref, { slot: "terminal", at: time.toISOString(), status: "unknown" });
    await store.saveSnapshot(tx, principal, { ...beforeUnknown, status: "unknown", missing: true });
  });
  const unknown = await read(ref, consumed.cursor);
  expect(unknown).toMatchObject({ events: [], highWatermark: detailCount, gap: false, snapshotRequired: true });
  expect(await store.snapshot(owner, ref)).toMatchObject({ status: "unknown", stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).heldDirectory).not.toBeNull();
  expect(await read(ref, unknown.cursor)).toMatchObject({ snapshotRequired: false, gap: false });
  await finish(ref);
  const restarted = createExecutionEventStore({ ...ports, db: connect() });
  const confirmed = await restarted.read(owner, { ...ref, cursor: unknown.cursor, limit: 100, waitMs: 0 });
  expect(confirmed).toMatchObject({ events: [], highWatermark: detailCount, gap: false, snapshotRequired: true });
  expect(await restarted.snapshot(owner, ref)).toMatchObject({ status: "completed", stopConfirmed: true });
  time = new Date(time.getTime() + 1000);
  await finish(ref);
  expect(await read(ref, confirmed.cursor)).toMatchObject({ snapshotRequired: false, gap: false, highWatermark: detailCount });
  expect(await db.executionDetail.count({ where: { attemptId: ref.attemptId } })).toBe(detailCount);
});
test("old cursor recovers once; lifecycle marker does not gain scope or change on text-only resave", async () => {
  const ref = await attempt(), old = executionCursor(ref, 0);
  const first = await read(ref, old);
  expect(first).toMatchObject({ events: [], highWatermark: 0, snapshotRequired: true, gap: false });
  expect(await read(ref, first.cursor)).toMatchObject({ snapshotRequired: false });
  const snapshot = await store.snapshot(owner, ref);
  await db.$transaction(tx => store.saveSnapshot(tx, principal, { ...snapshot, finalMessage: { messageId: "m", text: "New display", truncated: false } }));
  expect(await read(ref, first.cursor)).toMatchObject({ snapshotRequired: false, highWatermark: 0 });
  await expect(store.read({ ...principal, caller: { kind: "module", moduleId: "mod", hash: "other" } }, { ...ref, cursor: first.cursor, limit: 1, waitMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
  await store.append(principal, event(ref, 1));
  expect((await read(ref, first.cursor)).events.map(e => e.seq)).toEqual([1]);
});
test("direct G wait wakes on lifecycle-only snapshot and rollback never publishes lifecycle position", async () => {
  const ref = await attempt(), { cursor } = await read(ref);
  const snapshot = await store.snapshot(owner, ref);
  await expect(db.$transaction(async tx => {
    await tx.run.update({ where: { id: ref.runId }, data: { status: "failed" } });
    await store.saveSnapshot(tx, principal, { ...snapshot, status: "unknown" });
    throw new Error("lifecycle rollback");
  })).rejects.toThrow("lifecycle rollback");
  expect(await read(ref, cursor)).toMatchObject({ snapshotRequired: false });
  const start = Date.now(), waiting = store.read(owner, { ...ref, cursor, limit: 1, waitMs: 15_000 });
  await Bun.sleep(40);
  await finish(ref);
  expect(await waiting).toMatchObject({ events: [], gap: false, snapshotRequired: true, highWatermark: 0 });
  expect(Date.now() - start).toBeLessThan(1500);
});
test("SQLite write failure propagates and never fabricates durable success", async () => {
  const ref = await attempt();
  await db.$executeRawUnsafe("CREATE TRIGGER fail_execution_detail BEFORE INSERT ON ExecutionDetail BEGIN SELECT RAISE(ABORT, 'fixture disk write failure'); END");
  await expect(store.append(principal, event(ref))).rejects.toMatchObject({ code: "unavailable" });
  expect((await read(ref)).highWatermark).toBe(0); expect(await db.executionDetail.count()).toBe(0);
});
