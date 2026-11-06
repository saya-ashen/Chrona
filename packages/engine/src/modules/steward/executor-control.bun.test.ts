import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { testDb } from "./test-db";
import { createExecutorAuth } from "./executor-auth";
import { createExecutorControl } from "./executor-control";
import { createExecutionEventStore } from "./execution-event-store";
import { createRemoteExecutionSink } from "./executor-event-ingress";
import { createRemoteCompletion } from "./execution-remote-completion";
import { EXECUTOR_PROTOCOL, executorDigest, type ExecutorAssignment } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

async function setup() {
  const db = testDb(), now = new Date();
  await db.workspace.create({ data: { id: "w-device", name: "Device controller test" } });
  const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/not-read", publicUrl: null };
  ports.executionEvents = createExecutionEventStore(ports);
  ports.remoteExecutionSink = createRemoteExecutionSink(ports);
  ports.remoteCompletion = createRemoteCompletion(ports);
  const control = createExecutorControl(ports), auth = createExecutorAuth(ports), credential = randomBytes(32).toString("hex");
  const code = await auth.createPairing({ workspaceId: "w-device", ownerId: "owner" });
  const receipt = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: "pair", code: code.code, label: "Test" });
  const fence = { executorId: receipt.executorId, generation: 1, incarnation: "original" };
  const request = () => ({ v: EXECUTOR_PROTOCOL, requestId: crypto.randomUUID(), ...fence });
  const recovery = await auth.authenticateReconcile(credential, fence);
  expect(await control.controller.reconcile(recovery, { ...request(), entries: [], complete: true, after: null }, AbortSignal.timeout(1000))).toMatchObject({ reconciled: true });
  const who = await auth.authenticate(credential, fence, "active");
  return { db, ports, control, auth, credential, fence, request, who, now };
}
async function assignment(f: Awaited<ReturnType<typeof setup>>, index: number) {
  const session = await f.db.session.create({ data: { workspaceId: f.who.workspaceId, key: `device-${index}`, source: "web" } });
  const deadlineAt = new Date(f.now.getTime() + 60000);
  const run = await f.db.run.create({ data: { workspaceId: f.who.workspaceId, sessionId: session.id, lane: "background", trigger: "execution", provider: "fixed-device", prompt: "probe", cwd: "/tmp/server-log-not-device", status: "running", startedAt: f.now, deadlineAt, tokenHash: `hash-${index}` } });
  const attempt = await f.db.executionAttempt.create({ data: { workspaceId: f.who.workspaceId, ownerId: "owner", callerKey: "owner", workId: `work-${index}`, commandKey: `start-${index}`, requestDigest: "digest", runId: run.id, projectRef: "project", projectDigest: "mapping", resolvedCwd: null, logDir: run.cwd, baseline: `commit:${"a".repeat(40)}`, budget: { timeoutMs: 60000, maxToolCalls: 2 }, executorId: f.fence.executorId, executorGeneration: 1, directoryIdentity: "b".repeat(64), mappingRevision: 1, heldDirectory: `physical-${index}` } });
  const mapping = { executorId: f.fence.executorId, projectRef: "project", mappingRevision: 1, directoryIdentity: "b".repeat(64), baseline: { kind: "commit" as const, digest: "a".repeat(40) }, label: "Project" };
  let value!: ExecutorAssignment;
  await f.db.$transaction(async tx => {
    const target = await f.control.admission.reserve(tx, { ref: { workId: attempt.workId, runId: run.id, sessionId: session.id, attemptId: attempt.id }, fence: f.fence, mapping, deadlineAt });
    value = { ...target, executorId: f.fence.executorId, incarnation: f.fence.incarnation, mapping, workspaceRef: `workspace-${index}`, workspaceMode: "existing", goal: "Test", budget: { timeoutMs: 60000, maxToolCalls: 2 }, deadlineAt: deadlineAt.toISOString() };
    await f.control.admission.prepare(tx, value, await executorDigest(value));
    await f.ports.executionEvents!.admit(tx, { workspaceId: f.who.workspaceId, ownerId: f.who.ownerId, caller: { kind: "owner" } }, target);
  });
  return value;
}
test("real DB prepared launch is offered durably once; stale generation and incarnation cannot mutate", async () => {
  const f = await setup();
  try {
    const a = await assignment(f, 1);
    const first = await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000));
    expect(first.launches[0]?.assignment).toEqual(a);
    expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).offeredAt).not.toBeNull();
    expect((await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000))).launches).toEqual([]);
    await f.auth.prepareIncarnation({ workspaceId: f.who.workspaceId, ownerId: f.who.ownerId }, { executorId: f.fence.executorId, generation: 1, expectedIncarnation: "original", nextIncarnation: "replacement", commandKey: "transition" });
    await expect(f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.db.executionAttempt.findUnique({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: "physical-1", stopConfirmedAt: null });
  } finally { await f.db.$disconnect(); }
});
test("server omissions are enumerated, unknown entries explicit, incomplete pagination never grants online", async () => {
  const f = await setup();
  try {
    const a = await assignment(f, 2), b = await assignment(f, 3);
    await f.db.executionExecutor.update({ where: { id: f.fence.executorId }, data: { reconciledAt: null, authorizedUntil: null } });
    const who = await f.auth.authenticateReconcile(f.credential, f.fence);
    const unknown = { workId: "unknown", runId: "unknown", sessionId: "unknown", attemptId: "unknown", assignmentId: "unknown", generation: 1 };
    const first = await f.control.controller.reconcile(who, { ...f.request(), entries: [{ target: unknown, launchDigest: "c".repeat(64), phase: "unknown", sourceAck: 0 }], complete: false, after: null }, AbortSignal.timeout(1000));
    expect(first).toMatchObject({ reconciled: false, decisions: [{ target: unknown, action: "unknown" }] });
    expect(await f.db.executionExecutor.findUnique({ where: { id: f.fence.executorId } })).toMatchObject({ reconciledAt: null, authorizedUntil: null });
    const last = await f.control.controller.reconcile(who, { ...f.request(), entries: [], complete: true, after: first.after }, AbortSignal.timeout(1000));
    expect(last.reconciled).toBe(true);
    expect(last.decisions.map(row => row.target.assignmentId).sort()).toEqual([a.assignmentId, b.assignmentId].sort());
    expect(last.decisions.every(row => row.action === "stop")).toBe(true);
    expect(await f.db.executionAttempt.count({ where: { heldDirectory: { not: null }, stopConfirmedAt: null } })).toBe(2);
  } finally { await f.db.$disconnect(); }
});

test("inject uses consumed key, persists offeredAt before response and never persists or repeats live text", async () => {
  const f = await setup();
  try {
    const a = await assignment(f, 4), target = { workId: a.workId, sessionId: a.sessionId, runId: a.runId, attemptId: a.attemptId, assignmentId: a.assignmentId, generation: a.generation };
    await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000));
    await f.db.executionCommand.create({ data: { attemptId: a.attemptId, commandKey: "one-live-key", operation: "send", requestDigest: "hash-only", receipt: { accepted: true, effect: "unknown" } } });
    const input = { target, commandKey: "one-live-key", text: "transient-inject-sentinel" };
    await f.control.deliverRemoteControl(input);
    const response = await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000));
    expect(response.controls).toEqual([{ op: "inject", ...input }]);
    const stored = await f.db.executionCommand.findUniqueOrThrow({ where: { attemptId_commandKey: { attemptId: a.attemptId, commandKey: input.commandKey } } });
    expect(stored.offeredAt).not.toBeNull(); expect(JSON.stringify(stored)).not.toContain(input.text);
    await f.control.deliverRemoteControl(input);
    expect((await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000))).controls).toEqual([]);
  } finally { await f.db.$disconnect(); }
});

const targetOf = (a: ExecutorAssignment) => ({ workId: a.workId, sessionId: a.sessionId, runId: a.runId, attemptId: a.attemptId, assignmentId: a.assignmentId, generation: a.generation });
async function prelaunchFinal(a: ExecutorAssignment) {
  const launchDigest = await executorDigest(a);
  return { ...targetOf(a), launchDigest, baseline: a.mapping.baseline, throughSourceSeq: 0, sourceReceipt: null, finalMessage: null, missing: false,
    outcome: { outcome: "unavailable" as const, sessionId: null, error: "Executor stopped before launch" },
    stop: { kind: "never_started" as const, tombstoneDigest: await executorDigest({ kind: "executor_prelaunch_never_started", target: targetOf(a), launchDigest }) } };
}
async function offered(f: Awaited<ReturnType<typeof setup>>, index: number) {
  const a = await assignment(f, index);
  expect((await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000))).launches[0]?.assignment).toEqual(a);
  return a;
}

test("offered prelaunch final atomically releases slot/hold and replays stable ACK after controller restart", async () => {
  const f = await setup();
  try {
    const a = await offered(f, 10), final = await prelaunchFinal(a), digest = await executorDigest(final);
    const result = await f.control.controller.final(f.who, { ...f.request(), final, digest }, AbortSignal.timeout(1000));
    expect(result).toEqual({ digest, accepted: true, stopConfirmed: true });
    const saved = await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } });
    expect(saved).toMatchObject({ tombstoneDigest: final.stop.tombstoneDigest, finalDigest: digest, final });
    expect(saved.finalizedAt).not.toBeNull();
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: null });
    expect(await f.db.executionAttempt.count({ where: { executorId: f.fence.executorId, stopConfirmedAt: null } })).toBe(0);
    const restarted = createExecutorControl(f.ports);
    expect(await restarted.controller.final(f.who, { ...f.request(), final, digest }, AbortSignal.timeout(1000))).toEqual(result);
    expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).toEqual(saved);
  } finally { await f.db.$disconnect(); }
});

test("wrong target, launch, digest and retirement tombstone never release original offered assignment", async () => {
  for (const invalid of ["target", "launch", "digest", "retire", "proof"] as const) {
    const f = await setup();
    try {
      const a = await offered(f, 11), final = await prelaunchFinal(a);
      if (invalid === "target") final.workId = "wrong-work";
      if (invalid === "launch") final.launchDigest = "0".repeat(64);
      if (invalid === "retire") final.stop.tombstoneDigest = await executorDigest({ assignmentId: a.assignmentId, finalDigest: "1".repeat(64), retired: true });
      if (invalid === "proof") final.stop.tombstoneDigest = "f".repeat(64);
      const digest = invalid === "digest" ? "0".repeat(64) : await executorDigest(final);
      try { expect((await f.control.controller.final(f.who, { ...f.request(), final, digest }, AbortSignal.timeout(1000))).stopConfirmed).toBe(false); }
      catch (error) { expect(["forbidden", "conflict"]).toContain((error as { code: string }).code); }
      expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: "physical-11", stopConfirmedAt: null });
      expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).toMatchObject({ finalizedAt: null, tombstoneDigest: null });
    } finally { await f.db.$disconnect(); }
  }
});

test("any persisted start/source or nonzero/falsely successful final blocks prelaunch stop", async () => {
  for (const evidence of ["identity", "started", "source", "produced", "final-source", "receipt", "success"] as const) {
    const f = await setup();
    try {
      const a = await offered(f, 12), final: import("@chrona/contracts/steward").ExecutorFinal = await prelaunchFinal(a);
      if (evidence === "identity") await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { processIdentity: { unit: "original" } } });
      if (evidence === "started") await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { startedAt: f.now } });
      if (evidence === "source") await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { sourceHighWatermark: 1 } });
      if (evidence === "produced") await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { sourceProducedThrough: 1 } });
      if (evidence === "final-source") final.throughSourceSeq = 1;
      if (evidence === "receipt") final.sourceReceipt = { placement: { executorId: a.executorId, projectRef: a.mapping.projectRef, mappingRevision: a.mapping.mappingRevision }, baseline: a.mapping.baseline, manifestDigest: "a".repeat(64), fileCount: 1, verifiedAt: f.now.toISOString(), stage: "claim" };
      if (evidence === "success") final.outcome.outcome = "finished";
      try { expect((await f.control.controller.final(f.who, { ...f.request(), final, digest: await executorDigest(final) }, AbortSignal.timeout(1000))).stopConfirmed).toBe(false); }
      catch (error) { expect((error as { code: string }).code).toBe("conflict"); }
      expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: "physical-12", stopConfirmedAt: null });
      expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).toMatchObject({ finalizedAt: null, tombstoneDigest: null });
    } finally { await f.db.$disconnect(); }
  }
});

test("reconcile strengthens unknown final stop without replacing final/digest, including revoked original drain", async () => {
  for (const revoked of [false, true]) {
    const f = await setup();
    try {
      const a = await offered(f, 13), prelaunch = await prelaunchFinal(a);
      const final = { ...prelaunch, stop: { kind: "unknown" as const, reason: "Original prelaunch observation not yet available" } }, digest = await executorDigest(final);
      expect(await f.control.controller.final(f.who, { ...f.request(), final, digest }, AbortSignal.timeout(1000))).toMatchObject({ stopConfirmed: false });
      if (revoked) await f.auth.revoke({ workspaceId: f.who.workspaceId, ownerId: f.who.ownerId }, { executorId: f.fence.executorId, generation: 1, commandKey: "revoke-prelaunch" });
      const who = await f.auth.authenticateReconcile(f.credential, f.fence);
      if (revoked) {
        expect(who.mode).toBe("drain");
        await expect(f.control.controller.poll(who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "forbidden" });
        await expect(f.control.controller.report(who, { ...f.request(), target: targetOf(a), records: [] }, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "forbidden" });
      }
      const response = await createExecutorControl(f.ports).controller.reconcile(who, { ...f.request(), after: null, complete: true, entries: [{ target: targetOf(a), launchDigest: prelaunch.launchDigest, phase: "final", sourceAck: 0, finalDigest: digest, stop: prelaunch.stop }] }, AbortSignal.timeout(1000));
      expect(response.decisions).toEqual([{ target: targetOf(a), action: "ack_final" }]);
      expect(response.reconciled).toBe(!revoked);
      const saved = await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } });
      expect(saved).toMatchObject({ final, finalDigest: digest, tombstoneDigest: prelaunch.stop.tombstoneDigest });
      expect(saved.finalizedAt).not.toBeNull();
      expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: null });
      expect(await f.control.controller.final(who, { ...f.request(), final, digest }, AbortSignal.timeout(1000))).toEqual({ digest, accepted: true, stopConfirmed: true });
      if (revoked) expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).toMatchObject({ authorizedUntil: null, reconciledAt: null });
    } finally { await f.db.$disconnect(); }
  }
});

test("server never_offered remains compatible and a failed completion rolls prelaunch proof/final/hold back together", async () => {
  for (const rollback of [false, true]) {
    const f = await setup();
    try {
      const a = rollback ? await offered(f, 14) : await assignment(f, 14), final = await prelaunchFinal(a);
      if (!rollback) {
        final.stop.tombstoneDigest = await executorDigest({ assignmentId: a.assignmentId, launchDigest: final.launchDigest, kind: "never_offered" });
        await f.db.executorAssignment.update({ where: { attemptId: a.attemptId }, data: { tombstoneDigest: final.stop.tombstoneDigest } });
      } else {
        const completion = f.ports.remoteCompletion!;
        f.ports.remoteCompletion = { ...completion, async commit(tx, input) { await completion.commit(tx, input); throw new Error("Injected completion transaction failure"); } };
      }
      const call = f.control.controller.final(f.who, { ...f.request(), final, digest: await executorDigest(final) }, AbortSignal.timeout(1000));
      if (!rollback) expect(await call).toMatchObject({ stopConfirmed: true });
      else {
        await expect(call).rejects.toThrow("Injected completion transaction failure");
        expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).toMatchObject({ final: null, finalDigest: null, tombstoneDigest: null, finalizedAt: null });
        expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: "physical-14", stopConfirmedAt: null });
      }
    } finally { await f.db.$disconnect(); }
  }
});

test("reconcile wrong binding/proof preserves unknown final and directory until exact original prelaunch proof", async () => {
  const f = await setup();
  try {
    const a = await offered(f, 15), prelaunch = await prelaunchFinal(a);
    const final = { ...prelaunch, stop: { kind: "unknown" as const, reason: "Proof pending" } }, digest = await executorDigest(final);
    await f.control.controller.final(f.who, { ...f.request(), final, digest }, AbortSignal.timeout(1000));
    const who = await f.auth.authenticateReconcile(f.credential, f.fence);
    for (const invalid of ["proof", "target", "launch"] as const) {
      const entry = { target: targetOf(a), launchDigest: prelaunch.launchDigest, phase: "final" as const, sourceAck: 0, finalDigest: digest, stop: { ...prelaunch.stop } };
      if (invalid === "proof") entry.stop.tombstoneDigest = "f".repeat(64);
      if (invalid === "target") entry.target.workId = "wrong-work";
      if (invalid === "launch") entry.launchDigest = "0".repeat(64);
      const call = f.control.controller.reconcile(who, { ...f.request(), after: null, complete: true, entries: [entry] }, AbortSignal.timeout(1000));
      if (invalid === "proof") expect((await call).decisions[0]?.action).toBe("stop");
      else await expect(call).rejects.toMatchObject({ code: "forbidden" });
      expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).toMatchObject({ heldDirectory: "physical-15", stopConfirmedAt: null });
      expect(await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.attemptId } })).toMatchObject({ final, finalDigest: digest, finalizedAt: null, tombstoneDigest: null });
    }
    const result = await f.control.controller.reconcile(who, { ...f.request(), after: null, complete: true, entries: [{ target: targetOf(a), launchDigest: prelaunch.launchDigest, phase: "final", sourceAck: 0, finalDigest: digest, stop: prelaunch.stop }] }, AbortSignal.timeout(1000));
    expect(result.decisions[0]?.action).toBe("ack_final");
  } finally { await f.db.$disconnect(); }
});
