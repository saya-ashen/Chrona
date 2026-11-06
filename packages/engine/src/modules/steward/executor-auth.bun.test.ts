import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createExecutorAuth, assertExecutorRequest } from "./executor-auth";
import { testDb } from "./test-db";
import { EXECUTOR_PROTOCOL, type ExecutorRequests } from "@chrona/contracts/steward";

async function setup() {
  const db = testDb();
  let now = new Date("2026-11-06T12:00:00Z");
  await db.workspace.create({ data: { id: "w-auth", name: "Auth temporary SQLite" } });
  const owner = { workspaceId: "w-auth", ownerId: "owner" };
  const auth = createExecutorAuth({ db, now: () => now });
  const credential = randomBytes(32).toString("hex");
  const pairing = await auth.createPairing(owner);
  const pair = { v: EXECUTOR_PROTOCOL, requestId: "pair", code: pairing.code, label: "Temporary device" };
  const receipt = await auth.pair(credential, pair);
  const fence = { executorId: receipt.executorId, generation: receipt.generation, incarnation: "incarnation-original" };
  await db.executionExecutor.update({ where: { id: fence.executorId }, data: { incarnation: fence.incarnation, reconciledAt: now, authorizedUntil: new Date(now.getTime() + 60000) } });
  return { db, auth, credential, pairing, pair, receipt, fence, owner, setNow: (value: Date) => { now = value; } };
}

test("DB pairing retries return original identity without renewal; mismatched secret, expiry and revoke fail closed", async () => {
  const f = await setup();
  try {
    const before = await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } });
    f.setNow(new Date("2026-11-06T12:20:00Z"));
    expect(await f.auth.pair(f.credential, { ...f.pair, label: "Changed label ignored" })).toEqual(f.receipt);
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    await expect(f.auth.pair(randomBytes(32).toString("hex"), f.pair)).rejects.toMatchObject({ code: "conflict" });
    const expired = await f.auth.createPairing(f.owner);
    f.setNow(new Date("2026-11-06T13:00:00Z"));
    await expect(f.auth.pair(randomBytes(32).toString("hex"), { ...f.pair, code: expired.code })).rejects.toMatchObject({ code: "forbidden" });
    await f.auth.revoke(f.owner, { ...f.receipt, commandKey: "revoke" });
    await expect(f.auth.pair(f.credential, f.pair)).rejects.toMatchObject({ code: "forbidden" });
    const stored = await f.db.executionExecutor.findUniqueOrThrow({ where: { id: before.id } });
    expect(stored.credentialHash).not.toBe(f.credential);
    expect(JSON.stringify(await f.db.audit.findMany())).not.toContain(f.credential);
    expect(JSON.stringify(await f.db.executorPairing.findMany())).not.toContain(f.pairing.code);
  } finally { await f.db.$disconnect(); }
});

test("real SQLite revoke increments once, preserves original fences/holds, and drain binds every target", async () => {
  const f = await setup();
  try {
    const session = await f.db.session.create({ data: { workspaceId: f.owner.workspaceId, key: "auth-session", source: "web" } });
    const run = await f.db.run.create({ data: { workspaceId: f.owner.workspaceId, sessionId: session.id, lane: "background", trigger: "execution", provider: "fake", prompt: "probe", cwd: "/tmp/not-opened", tokenHash: "hash-only", status: "running", startedAt: new Date() } });
    const attempt = await f.db.executionAttempt.create({ data: { ...f.owner, callerKey: "owner", workId: "work", commandKey: "start", requestDigest: "digest", runId: run.id, projectRef: "project", projectDigest: "mapping", resolvedCwd: null, logDir: run.cwd, baseline: "commit:fixture", budget: {}, executorId: f.fence.executorId, executorGeneration: 1, heldDirectory: "device-directory-hold" } });
    await f.db.executorAssignment.create({ data: { ...f.fence, attemptId: attempt.id, assignmentId: "assignment", launchDigest: "a".repeat(64), sourceHighWatermark: 2 } });
    const target = { workId: "work", sessionId: session.id, runId: run.id, attemptId: attempt.id, assignmentId: "assignment", generation: 1 };
    expect(await f.auth.authenticate(f.credential, f.fence, "active")).toMatchObject({ ...f.owner, ...f.fence, mode: "active" });
    for (const fence of [{ ...f.fence, generation: 2 }, { ...f.fence, incarnation: "another" }, { ...f.fence, executorId: "other" }]) await expect(f.auth.authenticate(f.credential, fence, "active")).rejects.toMatchObject({ code: "forbidden" });
    const key = { executorId: f.fence.executorId, generation: 1, commandKey: "revoke-stable" };
    await expect(f.auth.revoke({ ...f.owner, ownerId: "other" }, key)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.auth.revoke(f.owner, key)).toEqual({ executorId: f.fence.executorId, generation: 2, revoked: true });
    expect(await f.auth.revoke(f.owner, key)).toEqual({ executorId: f.fence.executorId, generation: 2, revoked: true });
    await expect(f.auth.revoke(f.owner, { ...key, generation: 2 })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.auth.authenticate(f.credential, f.fence, "active")).rejects.toMatchObject({ code: "forbidden" });
    const who = await f.auth.authenticate(f.credential, f.fence, "drain");
    expect(who.mode).toBe("drain");
    const request: ExecutorRequests["reconcile"] = { v: EXECUTOR_PROTOCOL, requestId: "drain", ...f.fence, entries: [{ target, launchDigest: "a".repeat(64), phase: "unknown", sourceAck: 2, stop: { kind: "unknown", reason: "No trusted observer" } }], after: null, complete: true };
    await f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", request));
    for (const field of ["workId", "sessionId", "runId", "attemptId", "assignmentId"] as const) {
      const bad = { ...request, entries: [{ ...request.entries[0]!, target: { ...target, [field]: "wrong" } }] };
      await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", bad))).rejects.toMatchObject({ code: "forbidden" });
    }
    for (const extra of [{ sourceAck: 3 }, { phase: "started" as const }, { launchDigest: "b".repeat(64) }, { finalDigest: "b".repeat(64) }]) {
      await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", { ...request, entries: [{ ...request.entries[0]!, ...extra }] }))).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "poll", { v: EXECUTOR_PROTOCOL, requestId: "no-renew", ...f.fence, waitMs: 0 }))).rejects.toMatchObject({ code: "forbidden" });
    const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.cancelRequestedAt).toBeInstanceOf(Date); expect(row.capabilityRevokedAt).toBeInstanceOf(Date);
    expect(row.stopConfirmedAt).toBeNull(); expect(row.heldDirectory).toBe("device-directory-hold");
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).toMatchObject({ generation: 2, authorizedUntil: null, reconciledAt: null });
    expect(await f.db.audit.count({ where: { kind: "executor_revoke" } })).toBe(1);
  } finally { await f.db.$disconnect(); }
});

test("bootstrap never grants active authority and owner CAS fences stale daemons durably", async () => {
  const f = await setup();
  try {
    await f.db.executionExecutor.update({ where: { id: f.fence.executorId }, data: { incarnation: null, reconciledAt: null } });
    const who = await f.auth.authenticateReconcile(f.credential, f.fence);
    expect(who.mode).toBe("recovery");
    await expect(f.auth.authenticate(f.credential, f.fence, "active")).rejects.toMatchObject({ code: "forbidden" });
    const reconcile: ExecutorRequests["reconcile"] = { v: EXECUTOR_PROTOCOL, requestId: "bootstrap", ...f.fence, entries: [], after: null, complete: true };
    await f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", reconcile));
    const next = { executorId: f.fence.executorId, generation: 1, expectedIncarnation: f.fence.incarnation, nextIncarnation: "next-daemon", commandKey: "handoff" };
    const result = await f.auth.prepareIncarnation(f.owner, next);
    expect(result).toMatchObject({ incarnation: "next-daemon", generation: 1, reconciled: false });
    expect(await f.auth.prepareIncarnation(f.owner, next)).toEqual(result);
    await expect(f.auth.prepareIncarnation(f.owner, { ...next, nextIncarnation: "changed" })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.auth.authenticateReconcile(f.credential, f.fence)).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", reconcile))).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.auth.prepareIncarnation(f.owner, { ...next, commandKey: "stale" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.auth.prepareIncarnation(f.owner, { ...next, expectedIncarnation: "next-daemon", nextIncarnation: f.fence.incarnation, commandKey: "back" })).rejects.toMatchObject({ code: "conflict" });
    const candidates = await Promise.allSettled(["third-a", "third-b"].map(nextIncarnation => f.auth.prepareIncarnation(f.owner, { ...next, expectedIncarnation: "next-daemon", nextIncarnation, commandKey: nextIncarnation })));
    expect(candidates.filter(value => value.status === "fulfilled")).toHaveLength(1);
    const current = await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } });
    expect(await f.auth.prepareIncarnation(f.owner, next)).toEqual(result);
    expect((await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).incarnation).toBe(current.incarnation);
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).toMatchObject({ generation: 1, authorizedUntil: null, reconciledAt: null });
  } finally { await f.db.$disconnect(); }
});

test("new daemon reconciles original assignment without rewriting its identity or allowing restart", async () => {
  const f = await setup();
  try {
    const session = await f.db.session.create({ data: { workspaceId: f.owner.workspaceId, key: "old-assignment", source: "web" } });
    const run = await f.db.run.create({ data: { workspaceId: f.owner.workspaceId, sessionId: session.id, lane: "background", trigger: "execution", provider: "probe", prompt: "probe", cwd: "/tmp/not-opened", tokenHash: "old-daemon" } });
    const attempt = await f.db.executionAttempt.create({ data: { ...f.owner, callerKey: "owner", workId: "old-work", commandKey: "old-start", requestDigest: "d", runId: run.id, projectRef: "p", projectDigest: "d", resolvedCwd: null, logDir: run.cwd, baseline: "snapshot:probe", budget: {}, executorId: f.fence.executorId, executorGeneration: 1, heldDirectory: "retain-hold" } });
    await f.db.executorAssignment.create({ data: { ...f.fence, attemptId: attempt.id, assignmentId: "old-assignment", launchDigest: "a".repeat(64), sourceHighWatermark: 2 } });
    await f.db.executionExecutor.update({ where: { id: f.fence.executorId }, data: { incarnation: null } });
    await expect(f.auth.authenticateReconcile(f.credential, f.fence)).rejects.toMatchObject({ code: "forbidden" });
    await f.db.executionExecutor.update({ where: { id: f.fence.executorId }, data: { incarnation: f.fence.incarnation } });
    await f.auth.prepareIncarnation(f.owner, { executorId: f.fence.executorId, generation: 1, expectedIncarnation: f.fence.incarnation, nextIncarnation: "new-daemon", commandKey: "transfer" });
    const fence = { ...f.fence, incarnation: "new-daemon" };
    const who = await f.auth.authenticateReconcile(f.credential, fence);
    const target = { workId: "old-work", sessionId: session.id, runId: run.id, attemptId: attempt.id, assignmentId: "old-assignment", generation: 1 };
    const request: ExecutorRequests["reconcile"] = { v: EXECUTOR_PROTOCOL, requestId: "old-reconcile", ...fence, entries: [{ target, launchDigest: "a".repeat(64), phase: "unknown", sourceAck: 0 }], after: null, complete: true };
    await f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", request));
    const final: ExecutorRequests["final"] = { v: EXECUTOR_PROTOCOL, requestId: "old-final", ...fence, digest: "b".repeat(64), final: { ...target, throughSourceSeq: 0, baseline: { kind: "snapshot", digest: "probe" }, launchDigest: "a".repeat(64), outcome: { outcome: "failed", sessionId: null, error: null }, finalMessage: { messageId: "m", text: "Probe", truncated: false }, missing: false, sourceReceipt: null, stop: { kind: "unknown", reason: "No observer" } } };
    await f.db.$transaction(tx => assertExecutorRequest(tx, who, "final", final));
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "final", { ...final, final: { ...final.final, runId: "wrong" } }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, who, "reconcile", { ...request, entries: [{ ...request.entries[0]!, phase: "started" }] }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.auth.authenticate(f.credential, fence, "active")).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { assignmentId: "old-assignment" } })).toMatchObject({ incarnation: f.fence.incarnation });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ heldDirectory: "retain-hold", stopConfirmedAt: null });
    await f.auth.revoke(f.owner, { executorId: f.fence.executorId, generation: 1, commandKey: "revoke-new" });
    await expect(f.auth.authenticate(f.credential, f.fence, "drain")).rejects.toMatchObject({ code: "forbidden" });
    const drain = await f.auth.authenticate(f.credential, fence, "drain");
    await f.db.$transaction(tx => assertExecutorRequest(tx, drain, "reconcile", request));
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, drain, "reconcile", { ...request, entries: [{ ...request.entries[0]!, sourceAck: 3 }] }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.db.$transaction(tx => assertExecutorRequest(tx, drain, "reconcile", { ...request, entries: [{ ...request.entries[0]!, identity: { bootId: "00000000-0000-4000-8000-000000000000", unit: "chrona-executor-a.service", invocationId: "1".repeat(32), controlGroup: "/untrusted" } }] }))).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { assignmentId: "old-assignment" } })).sourceHighWatermark).toBe(2);
  } finally { await f.db.$disconnect(); }
});

test("incarnation CAS rollback leaves identity and receipt unchanged", async () => {
  const f = await setup();
  try {
    await f.db.$executeRawUnsafe('CREATE TRIGGER "fail_transition" BEFORE INSERT ON "Audit" BEGIN SELECT RAISE(ABORT, \'probe rollback\'); END');
    await expect(f.auth.prepareIncarnation(f.owner, { executorId: f.fence.executorId, generation: 1, expectedIncarnation: f.fence.incarnation, nextIncarnation: "rollback", commandKey: "rollback" })).rejects.toThrow();
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).toMatchObject({ incarnation: f.fence.incarnation });
    expect(await f.db.audit.count()).toBe(0);
  } finally { await f.db.$disconnect(); }
});

test("revoke is atomic with cancel/capability facts and its stable key receipt", async () => {
  const f = await setup();
  try {
    const run = await f.db.run.create({ data: { workspaceId: f.owner.workspaceId, lane: "background", trigger: "execution", provider: "probe", prompt: "probe", cwd: "/tmp/not-opened", tokenHash: "rollback-only" } });
    await f.db.executionAttempt.create({ data: { ...f.owner, callerKey: "owner", workId: "rollback-work", commandKey: "rollback-start", requestDigest: "digest", runId: run.id, projectRef: "project", projectDigest: "mapping", resolvedCwd: null, logDir: run.cwd, baseline: "snapshot:probe", budget: {}, executorId: f.fence.executorId } });
    await f.db.$executeRawUnsafe('CREATE TRIGGER "fail_revoke_probe" BEFORE UPDATE ON "ExecutionAttempt" BEGIN SELECT RAISE(ABORT, \'probe rollback\'); END');
    const key = { executorId: f.fence.executorId, generation: 1, commandKey: "atomic-revoke" };
    await expect(f.auth.revoke(f.owner, key)).rejects.toThrow();
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: key.executorId } })).toMatchObject({ generation: 1, revokedAt: null });
    expect(await f.db.audit.count()).toBe(0);
    await f.db.$executeRawUnsafe('DROP TRIGGER "fail_revoke_probe"');
    expect(await f.auth.revoke(f.owner, key)).toMatchObject({ generation: 2, revoked: true });
  } finally { await f.db.$disconnect(); }
});
