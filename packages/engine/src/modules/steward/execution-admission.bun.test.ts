import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ExecutionStartV2, ExecutorFinal, ExecutorSourceRecord } from "@chrona/contracts/steward";
import { enqueueCall } from "./module-calls";
import { EXECUTOR_LIMITS, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts, VerifiedDeviceStop } from "./ports";
import { executionAdmissionIntent } from "./execution-admission-intent";
import { createExecutionV2Admission } from "./execution-admission";
import { heldExecutionDirectory } from "./execution-claim";
import { createRemoteExecutionSink } from "./executor-event-ingress";
import { canonicalExecutionFinalDisplay } from "./execution-events";
import { createRemoteCompletion } from "./execution-remote-completion";
import { createExecutionEventStore } from "./execution-event-store";
import { executionDigest } from "./execution-state";
import { createExecutions } from "./execution";
import { createRuns, liveRuns } from "./runs";
import { deviceCommandBytes } from "./execution-control-budget";
import { unassignedDeviceCommandBytes } from "./execution-source-budget";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { liveRuns.clear(); for (const db of databases.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); databases.push(db);
  const workspace = await db.workspace.create({ data: { name: "M3-Q-test" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "coding", activeHash: "hash", status: "active" } });
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  let now = new Date("2026-11-06T12:00:00Z"), online = true;
  await db.executionExecutor.create({ data: { id: "device", workspaceId: workspace.id, ownerId: "owner", label: "fixture", credentialHash: "not-a-credential", incarnation: "daemon", reconciledAt: now, authorizedUntil: new Date(now.getTime() + 60_000) } });
  const ports: StewardPorts = { db, now: () => now, dataDir: await mkdtemp(join(tmpdir(), "chrona-q-test-")), publicUrl: null,
    resolveExecutionPlacement: async (_, p) => ({ ...p, executor: "device", executorGeneration: 1, directoryIdentity: executionDigest(p.projectRef.replace(/^alias-/, "")), baseline: { kind: "commit", digest: "a".repeat(40) }, label: "test" }),
    executorAdmission: {
      online: async (_, { executorId }) => online ? { executorId, generation: 1, incarnation: "daemon", authorizedUntil: new Date(now.getTime() + 60_000) } : null,
      reserve: async (tx, { ref, fence }) => { const assignmentId = randomUUID(); await tx.executorAssignment.create({ data: { attemptId: ref.attemptId, assignmentId, executorId: fence.executorId, generation: fence.generation, incarnation: fence.incarnation } }); return { ...ref, assignmentId, generation: fence.generation }; },
      prepare: async (tx, assignment, launchDigest) => { await tx.executorAssignment.update({ where: { attemptId: assignment.attemptId }, data: { launch: assignment, launchDigest, preparedAt: now } }); },
    } };
  ports.executionEvents = createExecutionEventStore(ports);
  return { db, ports, principal, runs: createRuns(ports, workspace.id), admission: createExecutionV2Admission(ports), setOnline: (value: boolean) => { online = value; }, setNow: (value: Date) => { now = value; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(key = "one", projectRef = key): ExecutionStartV2 {
  return { kind: "execution", workId: key, commandKey: key, goal: "Fixture goal", placement: { executorId: "device", projectRef, mappingRevision: 1 }, workspace: { mode: "existing", baseline: { kind: "commit", digest: "a".repeat(40) } }, queueExpiresAt: "2026-11-07T00:00:00Z", budget: { timeoutMs: 60_000, maxToolCalls: 2 } };
}
async function started(f: Fixture, key = "one") {
  const admitted = await f.admission.start(f.principal, input(key));
  const run = await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" });
  expect(run?.id).toBe(admitted.execution.runId);
  const row = await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: admitted.execution.attemptId } });
  const target = { workId: admitted.execution.workId, sessionId: admitted.execution.sessionId, runId: admitted.execution.runId, attemptId: admitted.execution.attemptId, assignmentId: row.assignmentId, generation: row.generation };
  return { ...admitted, target, row, run: run! };
}
function record(sourceSeq: number, text = "safe"): ExecutorSourceRecord {
  const value = { sourceSeq, at: "2026-11-06T12:00:01Z", item: { kind: "detail" as const, payload: { type: "message" as const, messageId: `m${sourceSeq}`, role: "assistant" as const, text, complete: true } } };
  return { ...value, digest: executionDigest(value) };
}
test.each([
  ["existing aliases share physical reservation", undefined, undefined, true],
  ["independent trees have distinct logical reservations", "tree-a", "tree-b", false],
  ["same independent workspace is stable", "tree-a", "tree-a", true],
])("%s", (_, a, b, same) => { expect(heldExecutionDirectory("device", "physical", a as string | undefined) === heldExecutionDirectory("device", "physical", b as string | undefined)).toBe(same as boolean); });
test("device admission never resolves a local cwd; original key survives expiry and permission changes", async () => {
  const f = await fixture(), first = await f.admission.start(f.principal, input());
  const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: first.execution.attemptId } });
  expect(row.resolvedCwd).toBeNull(); expect(row.directoryIdentity).toBe(executionDigest("one"));
  f.setNow(new Date("2026-11-08T12:00:00Z"));
  await f.db.module.updateMany({ data: { status: "paused" } });
  expect((await f.admission.start(f.principal, input())).execution).toEqual(first.execution);
  await expect(f.admission.start(f.principal, { ...input(), goal: "different" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count()).toBe(1);
});
test("alias and revision cannot bypass existing directory hold; expected baseline rejected", async () => {
  const f = await fixture(); await f.admission.start(f.principal, input());
  await expect(f.admission.start(f.principal, { ...input("two", "alias-one"), placement: { ...input().placement, projectRef: "alias-one", mappingRevision: 2 } })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.admission.start(f.principal, { ...input("other"), workspace: { mode: "existing", baseline: { kind: "commit", digest: "b".repeat(40) } } })).rejects.toMatchObject({ code: "conflict" });
});
test("offline queued device writes no token/start; claim+reserve+prepare fully rollback", async () => {
  const f = await fixture(), a = await f.admission.start(f.principal, input());
  const before = await f.db.run.findUniqueOrThrow({ where: { id: a.execution.runId } });
  f.setOnline(false); expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" })).toBeNull();
  expect(await f.db.run.findUnique({ where: { id: before.id } })).toMatchObject({ tokenHash: before.tokenHash, status: "queued", startedAt: null });
  f.setOnline(true); f.ports.executorAdmission!.prepare = async () => { throw new Error("prepare failure"); };
  await expect(f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" })).rejects.toThrow("prepare failure");
  expect(await f.db.executorAssignment.count()).toBe(0); expect((await f.db.run.findUniqueOrThrow({ where: { id: before.id } })).startedAt).toBeNull();
});
test("competing claim transactions keep executor/app two slots; unknown and revoked still count", async () => {
  const f = await fixture(); for (const key of ["one", "two", "three"]) await f.admission.start(f.principal, input(key));
  const paths = await f.db.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
  const script = join(f.ports.dataDir, "claim-competitor.ts");
  await writeFile(script, competitorSource(f, paths[0]!.file));
  const children = Array.from({ length: 3 }, () => Bun.spawn([process.execPath, script], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${paths[0]!.file}` }, stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
  const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 10_000);
  let claims: ({ id: string } | null)[];
  try {
    const readers = children.map(child => child.stdout.getReader());
    // All independent DB clients reach the barrier before any real claim begins.
    await Promise.all(readers.map(async reader => { const ready = await reader.read(); expect(new TextDecoder().decode(ready.value)).toBe("ready\n"); }));
    for (const child of children) { child.stdin.write("claim\n"); child.stdin.end(); }
    claims = await Promise.all(children.map(async (child, index) => {
      const output = await competitorOutput(readers[index]!);
      const errors = await new Response(child.stderr).text();
      expect(await child.exited, errors).toBe(0);
      const id = JSON.parse(output) as string | null;
      return id ? { id } : null;
    }));
  } finally {
    clearTimeout(timer);
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
    expect(children.every(child => child.exitCode !== null)).toBe(true);
  }
  expect(claims.filter(Boolean)).toHaveLength(2); expect(await f.db.executorAssignment.count()).toBe(2);
  expect(new Set(claims.filter(Boolean).map(claim => claim!.id)).size).toBe(2);
  const firstClaim = claims.find(claim => claim !== null)!;
  await f.runs.finish(firstClaim.id, { outcome: "finished", sessionId: null, error: null });
  expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" })).toBeNull();
  const unknown = await f.db.executionAttempt.findUniqueOrThrow({ where: { runId: firstClaim.id } });
  expect(unknown.heldDirectory).not.toBeNull(); expect(unknown.stopConfirmedAt).toBeNull(); expect(unknown.capabilityRevokedAt).not.toBeNull();
}, 20_000);
test("queued cancellation and expiry cannot claim; never-offered durable revocation can confirm stop after claim", async () => {
  const f = await fixture(), a = await started(f);
  await f.db.executionAttempt.update({ where: { id: a.target.attemptId }, data: { capabilityRevokedAt: f.ports.now(), cancelRequestedAt: f.ports.now() } });
  await f.runs.finish(a.target.runId, { outcome: "failed", sessionId: null, error: null }, { stopEvidence: "never_started" });
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).tombstoneDigest).not.toBeNull();
  const b = await f.admission.start(f.principal, input("two"));
  await createExecutions(f.ports).cancel(f.principal, { op: "cancel", ...b.execution, commandKey: "cancel" });
  f.setNow(new Date("2026-11-07T00:00:01Z"));
  expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" })).toBeNull();
});
test("source replay survives detail retirement; changed digest, implicit gap and failed transaction reject", async () => {
  const f = await fixture(), a = await started(f), sink = createRemoteExecutionSink(f.ports);
  const ingest = (records: ExecutorSourceRecord[]) => f.db.$transaction(tx => sink.ingest(tx, { principal: f.principal, ref: a.target, records }));
  expect(await ingest([record(1, "token=secret")])).toEqual({ acceptedThroughSourceSeq: 1, storedHighWatermark: 1 });
  expect(JSON.stringify((await f.db.executionDetail.findFirst())?.event)).not.toContain("secret");
  await f.db.executionDetail.deleteMany();
  expect(await ingest([record(1, "token=secret")])).toEqual({ acceptedThroughSourceSeq: 1, storedHighWatermark: 1 });
  await expect(ingest([record(1, "changed")])).rejects.toMatchObject({ code: "conflict" });
  await expect(ingest([record(3)])).rejects.toMatchObject({ code: "conflict" });
  const gap = { sourceSeq: 2, at: record(1).at, item: { kind: "gap" as const, throughSourceSeq: 5, reason: "backpressure" as const } };
  expect((await ingest([{ ...gap, digest: executionDigest(gap) }, record(6)])).acceptedThroughSourceSeq).toBe(6);
  await expect(f.db.$transaction(async tx => { await sink.ingest(tx, { principal: f.principal, ref: a.target, records: [record(7)] }); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).sourceHighWatermark).toBe(6);
});
test("question and source concurrent transactions share storedSeq; no prefill or question body persists", async () => {
  const f = await fixture(), a = await started(f), sink = createRemoteExecutionSink(f.ports);
  const summary = { sourceSeq: 1, at: record(1).at, item: { kind: "progress" as const, value: { phase: "thinking" as const, tool: null } } };
  await Promise.all([
    f.db.$transaction(tx => sink.ingest(tx, { principal: f.principal, ref: a.target, records: [{ ...summary, digest: executionDigest(summary) }, record(2)] })),
    f.db.$transaction(tx => sink.interaction(tx, f.principal, { id: "live-question", runId: a.target.runId, sessionId: a.target.sessionId, createdAt: record(1).at, expiresAt: "2026-11-06T12:01:00Z", status: "pending", question: { method: "editor", title: "title", message: "body-private", options: [], prefill: "prefill-private", timeoutMs: 1000 } }, a.target)),
  ]);
  const events = await f.db.executionDetail.findMany({ orderBy: { seq: "asc" } });
  expect(events.map(e => e.seq)).toEqual([1, 2]); expect(JSON.stringify(events)).not.toContain("private");
  const snapshot = await f.ports.executionEvents!.snapshot(f.principal, a.target);
  expect(snapshot.highWatermark).toBe(2); expect(snapshot.questions[0]?.requestId).toBe("live-question");
});
test("receipt quota rejects new increment but not original ACK or independent terminal final", async () => {
  const f = await fixture(), a = await started(f), sink = createRemoteExecutionSink(f.ports);
  const ingest = (records: ExecutorSourceRecord[]) => f.db.$transaction(tx => sink.ingest(tx, { principal: f.principal, ref: a.target, records }));
  await ingest([record(1)]);
  await f.db.executorAssignment.update({ where: { attemptId: a.target.attemptId }, data: { receiptCount: EXECUTOR_LIMITS.sourceReceipts - 1 } });
  await expect(ingest([record(2)])).rejects.toMatchObject({ code: "capacity" }); expect((await ingest([record(1)])).acceptedThroughSourceSeq).toBe(1);
  const final = finalOf(a); final.throughSourceSeq = 1;
  await f.db.$transaction(tx => createRemoteCompletion(f.ports).commit(tx, { principal: f.principal, target: a.target, final, digest: executionDigest(final), stop: null }));
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).finalDigest).toBe(executionDigest(final));
});
function finalOf(a: Awaited<ReturnType<typeof started>>): ExecutorFinal {
  return { ...a.target, launchDigest: a.row.launchDigest!, baseline: input().workspace.baseline, throughSourceSeq: 0, outcome: { outcome: "finished", sessionId: null, error: null }, finalMessage: { messageId: "final", text: "result", truncated: false }, missing: false, sourceReceipt: null, stop: { kind: "unknown", reason: "observer unavailable" } };
}
test("final ACK loss retains immutable unknown; later trusted stop completes original final and device result source", async () => {
  const f = await fixture(), a = await started(f), completion = createRemoteCompletion(f.ports), final = finalOf(a);
  final.changes = { scope: "baseline_to_worktree", status: "complete", patch: "fixture patch", files: [] };
  const digest = executionDigest(final), commit = (stop: VerifiedDeviceStop | null) => f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final, digest, stop }));
  await commit(null); await commit(null);
  expect(await createExecutions(f.ports).get(f.principal, final.workId)).toMatchObject({ status: "unknown", stopConfirmed: false });
  expect((await f.db.executionAttempt.findUniqueOrThrow({ where: { id: final.attemptId } })).heldDirectory).not.toBeNull();
  const stop: VerifiedDeviceStop = { executorId: "device", generation: 1, target: a.target, digest, proof: { kind: "never_started", tombstoneDigest: "f".repeat(64) } };
  await commit(stop); await commit(stop);
  expect(await createExecutions(f.ports).get(f.principal, final.workId)).toMatchObject({ status: "completed", stopConfirmed: true });
  const saved = await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: final.attemptId } });
  expect(saved.finalDigest).toBe(digest); expect(saved.final).toEqual(final); expect(saved.finalizedAt).not.toBeNull();
  expect((await createExecutions(f.ports).resultSource(f.principal, a.target)).changes?.patch).toBe("fixture patch");
});

test("global four capacity spans executors and immutable applications", async () => {
  const f = await fixture();
  for (const id of ["device2", "device3"]) await f.db.executionExecutor.create({ data: { id, workspaceId: f.principal.workspaceId, ownerId: "owner", label: id, credentialHash: id, incarnation: "daemon" } });
  for (let bucket = 0; bucket < 3; bucket++) {
    const module = await f.db.module.create({ data: { workspaceId: f.principal.workspaceId, name: `app${bucket}`, activeHash: "hash", status: "active" } });
    const principal: ExecutionPrincipal = { ...f.principal, caller: { kind: "module", moduleId: module.id, hash: "hash" } };
    for (let n = 0; n < (bucket === 2 ? 1 : 2); n++) {
      const value = input(`${bucket}-${n}`); value.placement.executorId = bucket === 0 ? "device" : bucket === 1 ? "device2" : "device3";
      await f.admission.start(principal, value);
    }
  }
  for (const executorId of ["device", "device", "device2", "device2"]) expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId })).not.toBeNull();
  expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device3" })).toBeNull();
  expect(await f.db.run.count({ where: { startedAt: { not: null } } })).toBe(4);
});
test("a session occupied by unknown execution remains exclusive; foreground ordinary bypasses coding slots", async () => {
  const f = await fixture(), a = await started(f);
  const b = await f.admission.start(f.principal, input("two"));
  await f.db.run.update({ where: { id: b.execution.runId }, data: { sessionId: a.execution.sessionId } });
  await f.runs.finish(a.target.runId, { outcome: "failed", error: null, sessionId: null });
  expect(await f.runs.claimNext("background", undefined, { kind: "execution", executorId: "device" })).toBeNull();
  const session = await f.db.session.create({ data: { workspaceId: f.principal.workspaceId, key: "web:foreground", source: "web" } });
  await f.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "chat" });
  expect(await f.runs.claimNext("foreground", undefined, { kind: "ordinary" })).toMatchObject({ sessionId: session.id, lane: "foreground" });
});

test("summary-only records refresh running snapshot without consuming client storedSeq; replay has one receipt/effect", async () => {
  const f = await fixture(), a = await started(f), sink = createRemoteExecutionSink(f.ports);
  const raw = { sourceSeq: 1, at: record(1).at, item: { kind: "resources" as const, value: { version: "test", skills: ["token=sentinel-secret"], extensions: 0 } } };
  const records = [{ ...raw, digest: executionDigest(raw) }];
  for (let n = 0; n < 2; n++) expect(await f.db.$transaction(tx => sink.ingest(tx, { principal: f.principal, ref: a.target, records }))).toEqual({ acceptedThroughSourceSeq: 1, storedHighWatermark: 0 });
  expect(await f.db.executorSourceReceipt.count()).toBe(1); expect((await f.db.executorSourceReceipt.findFirst())?.storedSeq).toBeNull();
  const summaries = await f.db.audit.findMany({ where: { kind: "provider_event" } });
  expect(summaries).toHaveLength(1); expect(JSON.stringify(summaries)).not.toContain("sentinel-secret");
  expect(await f.ports.executionEvents!.snapshot(f.principal, a.target)).toMatchObject({ status: "running", highWatermark: 0, missing: false });
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).receiptBytes).toBeGreaterThan(0);
});
test("noncanonical final display is rejected before persistence; canonical final and display contain no sentinel", async () => {
  const f = await fixture(), a = await started(f), completion = createRemoteCompletion(f.ports), raw = finalOf(a);
  raw.finalMessage!.text = "token=sentinel-secret"; raw.outcome.error = "credential=sentinel-secret";
  await expect(f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final: raw, digest: executionDigest(raw), stop: null }))).rejects.toMatchObject({ code: "invalid" });
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).final).toBeNull();
  const final = { ...raw, ...canonicalExecutionFinalDisplay(raw) };
  await f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final, digest: executionDigest(final), stop: null }));
  expect(JSON.stringify(await f.db.executorAssignment.findMany())).not.toContain("sentinel-secret");
  expect(JSON.stringify(await f.ports.executionEvents!.snapshot(f.principal, a.target))).not.toContain("sentinel-secret");
});

test("authorized preparation intent fixes IDs and rejects changed payload before any workspace I/O", async () => {
  const f = await fixture();
  const request = { commandKey: "prepare", requestDigest: executionDigest(input()), grantDigest: executionDigest("grant"), now: f.ports.now() };
  const intent = () => f.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${f.principal.workspaceId}`;
    return executionAdmissionIntent(tx, f.principal, request);
  });
  const [first, second] = await Promise.all([intent(), intent()]); expect(first).toEqual(second);
  await expect(f.db.$transaction(tx => executionAdmissionIntent(tx, f.principal, { ...request, requestDigest: executionDigest("different") }))).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count()).toBe(0); expect(await f.db.executionAttempt.count()).toBe(0);
  expect(JSON.stringify(await f.db.audit.findMany())).not.toContain("Fixture goal");
});

async function installCompletionOutbox(f: Fixture) {
  if (f.principal.caller.kind !== "module") throw new Error("fixture module required");
  const manifest = moduleManifestSchema.parse({ name: "coding", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: [{ name: "get", description: "Read work", idempotent: true, visibility: ["owner"], parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } }] });
  await f.db.moduleVersion.create({ data: { moduleId: f.principal.caller.moduleId, hash: "hash", manifest, source: "user", status: "approved", intent: {}, report: {} } });
  f.ports.onExecutionFinishedIn = async (tx, workspaceId, runId) => {
    const attempt = await tx.executionAttempt.findUniqueOrThrow({ where: { runId } });
    await enqueueCall({ tx, ports: f.ports, origin: { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, target: "coding.get", raw: { input: JSON.stringify({ workId: attempt.workId }) } }, { key: `execution-result:${attempt.id}:${attempt.stopConfirmedAt ? "stopped" : "unknown"}` });
  };
}
test("completion outbox shares final transaction; failed enqueue rolls back final/stop/snapshot and replay has one stopped invocation", async () => {
  const f = await fixture(), a = await started(f); await installCompletionOutbox(f);
  const completion = createRemoteCompletion(f.ports), final = finalOf(a), digest = executionDigest(final);
  const stop: VerifiedDeviceStop = { executorId: "device", generation: 1, target: a.target, digest, proof: { kind: "never_started", tombstoneDigest: "f".repeat(64) } };
  const enqueue = f.ports.onExecutionFinishedIn!;
  f.ports.onExecutionFinishedIn = async (...args) => { await enqueue(...args); throw new Error("outbox disk failed"); };
  const commit = () => f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final, digest, stop }));
  await expect(commit()).rejects.toThrow("outbox disk failed");
  expect(await f.db.moduleInvocation.count()).toBe(0);
  expect(await f.db.executionAttempt.findUnique({ where: { id: a.target.attemptId } })).toMatchObject({ stopConfirmedAt: null });
  expect(await f.db.executorAssignment.findUnique({ where: { attemptId: a.target.attemptId } })).toMatchObject({ final: null, finalizedAt: null });
  expect(await f.ports.executionEvents!.snapshot(f.principal, a.target)).toMatchObject({ status: "running", stopConfirmed: false });
  f.ports.onExecutionFinishedIn = enqueue;
  await commit(); await commit();
  expect(await f.db.moduleInvocation.count()).toBe(1);
  let wakeCalls = 0; f.ports.onRunFinished = async () => { if (++wakeCalls === 1) throw new Error("wake disconnected"); };
  await expect(completion.committed(f.principal.workspaceId, a.target.runId)).rejects.toThrow("wake disconnected");
  await completion.committed(f.principal.workspaceId, a.target.runId);
  expect(await f.db.moduleInvocation.count()).toBe(1);
});
test("queued cancel and unknown-to-stop completion each preserve stable outbox keys; ordinary finish has no execution callback", async () => {
  const f = await fixture(); await installCompletionOutbox(f);
  const queued = await f.admission.start(f.principal, input("queued"));
  const command = { ...queued.execution, op: "cancel" as const, commandKey: "cancel" };
  await createExecutions(f.ports).cancel(f.principal, command); await createExecutions(f.ports).cancel(f.principal, command);
  expect(await f.db.moduleInvocation.count()).toBe(1);
  const a = await started(f), completion = createRemoteCompletion(f.ports), final = finalOf(a), digest = executionDigest(final);
  await f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final, digest, stop: null }));
  const stop: VerifiedDeviceStop = { executorId: "device", generation: 1, target: a.target, digest, proof: { kind: "never_started", tombstoneDigest: "f".repeat(64) } };
  await f.db.$transaction(tx => completion.commit(tx, { principal: f.principal, target: a.target, final, digest, stop }));
  expect(await f.db.moduleInvocation.count()).toBe(3);
  const session = await f.db.session.create({ data: { workspaceId: f.principal.workspaceId, source: "web", key: "web:ordinary" } });
  await f.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "hello" });
  const run = await f.runs.claimNext("foreground"); await f.runs.finish(run!.id, { outcome: "finished", sessionId: null, error: null });
  expect(await f.db.moduleInvocation.count()).toBe(3);
});

test("offered launch with lost ACK never qualifies for never-started; local exit proof cannot release a device", async () => {
  const f = await fixture(), a = await started(f);
  await f.db.executorAssignment.update({ where: { attemptId: a.target.attemptId }, data: { offeredAt: f.ports.now() } });
  await f.db.executionAttempt.update({ where: { id: a.target.attemptId }, data: { capabilityRevokedAt: f.ports.now() } });
  for (const stopEvidence of ["never_started", "provider_exited"] as const) await expect(f.runs.finish(a.target.runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.executionAttempt.findUnique({ where: { id: a.target.attemptId } })).toMatchObject({ stopConfirmedAt: null });
  expect((await f.db.executionAttempt.findUniqueOrThrow({ where: { id: a.target.attemptId } })).heldDirectory).not.toBeNull();
});
test("receipt byte budget reserves a final explicit gap and charges real persisted metadata", async () => {
  const f = await fixture(), a = await started(f), sink = createRemoteExecutionSink(f.ports);
  await f.db.executorAssignment.update({ where: { attemptId: a.target.attemptId }, data: { receiptBytes: EXECUTOR_LIMITS.receiptBytes - 1280 } });
  const ingest = (records: ExecutorSourceRecord[]) => f.db.$transaction(tx => sink.ingest(tx, { principal: f.principal, ref: a.target, records }));
  await expect(ingest([record(1)])).rejects.toMatchObject({ code: "capacity" });
  const gap = { sourceSeq: 1, at: record(1).at, item: { kind: "gap" as const, throughSourceSeq: 9, reason: "backpressure" as const } };
  expect(await ingest([{ ...gap, digest: executionDigest(gap) }])).toEqual({ acceptedThroughSourceSeq: 9, storedHighWatermark: 1 });
  const receipt = await f.db.executorSourceReceipt.findFirstOrThrow();
  const { sourceSeq, digest, throughSourceSeq, storedSeq } = receipt;
  expect(receipt.bytes).toBe(Buffer.byteLength(JSON.stringify({ sourceSeq, digest, throughSourceSeq, storedSeq })));
  expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: a.target.attemptId } })).receiptBytes).toBe(EXECUTOR_LIMITS.receiptBytes - 1280 + receipt.bytes);
});

test("device send consumes original key before live transport; uncertain delivery never re-injects text", async () => {
  const f = await fixture(), a = await started(f), service = createExecutions(f.ports);
  liveRuns.set(a.target.runId, { done: new Promise(() => {}), abort: async () => {}, inject: async () => { throw new Error("must not inject through relay"); } });
  let deliveries = 0;
  f.ports.deliverRemoteControl = async request => {
    deliveries++; expect(request.target).toEqual(a.target); expect(request.commandKey).toBe("send");
    const receipt = await f.db.executionCommand.findUniqueOrThrow({ where: { attemptId_commandKey: { attemptId: a.target.attemptId, commandKey: "send" } } });
    expect(receipt.effect).toBe("unknown"); expect(receipt.offeredAt).toBeNull();
    throw new Error("transport unknown");
  };
  const command = { op: "send" as const, ...a.execution, commandKey: "send", text: "do-not-persist-this-text" };
  await expect(service.send(f.principal, command)).rejects.toThrow("transport unknown");
  await service.send(f.principal, command); expect(deliveries).toBe(1);
  await expect(service.send(f.principal, { ...command, text: "changed" })).rejects.toMatchObject({ code: "conflict" });
  expect(JSON.stringify(await f.db.executionCommand.findMany())).not.toContain("do-not-persist-this-text");
});
test("device commands share 128 receipts with remote questions and retain emergency cancel slot/bytes", async () => {
  const f = await fixture(), a = await started(f), service = createExecutions(f.ports);
  liveRuns.set(a.target.runId, { done: new Promise(() => {}), abort: async () => {}, inject: async () => {} });
  const prior = Array.from({ length: 127 }, (_, n) => ({ attemptId: a.target.attemptId, commandKey: `q${n}`, operation: "remote_question", requestDigest: "a".repeat(64), receipt: { requestId: `q${n}` } }));
  await f.db.executionCommand.createMany({ data: prior });
  await f.db.executorAssignment.update({ where: { attemptId: a.target.attemptId }, data: { receiptBytes: prior.reduce((total, row) => total + deviceCommandBytes(row), 0) } });
  await expect(service.send(f.principal, { op: "send", ...a.execution, commandKey: "overflow", text: "text" })).rejects.toMatchObject({ code: "capacity" });
  expect(await f.db.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: a.target.attemptId, commandKey: "overflow" } } })).toBeNull();
  await service.cancel(f.principal, { op: "cancel", ...a.execution, commandKey: "emergency" });
  expect(await f.db.executionCommand.count()).toBe(128);
  expect(await service.get(f.principal, a.execution.workId)).toMatchObject({ cancelRequested: true, stopConfirmed: false });
});
test("queued device cancellation metadata is charged without inventing an executor assignment", async () => {
  const f = await fixture(), a = await f.admission.start(f.principal, input());
  await createExecutions(f.ports).cancel(f.principal, { op: "cancel", ...a.execution, commandKey: "cancel-queued" });
  expect(await f.db.executorAssignment.count()).toBe(0);
  const command = await f.db.executionCommand.findFirstOrThrow();
  expect(await unassignedDeviceCommandBytes(f.db, "device")).toBe(deviceCommandBytes({ ...command, receipt: command.receipt as { accepted: boolean; effect: string } }));
});

function competitorSource(f: Fixture, path: string) {
  return `import { PrismaClient } from ${JSON.stringify(import.meta.resolve("@chrona/db/generated/prisma/client"))};
import { PrismaBunSqlite } from ${JSON.stringify(import.meta.resolve("prisma-adapter-bun-sqlite"))};
import { createRuns } from ${JSON.stringify(join(import.meta.dirname, "runs.ts"))};
import { createExecutionEventStore } from ${JSON.stringify(join(import.meta.dirname, "execution-event-store.ts"))};
import { executionDigest } from ${JSON.stringify(join(import.meta.dirname, "execution-state.ts"))};
const db = new PrismaClient({adapter:new PrismaBunSqlite({url:${JSON.stringify(`file:${path}`)}})});
const now = new Date("2026-11-06T12:00:00Z");
const ports = {db,now:()=>now,dataDir:${JSON.stringify(f.ports.dataDir)},publicUrl:null,
resolveExecutionPlacement:async(_,p)=>({...p,executor:"device",executorGeneration:1,directoryIdentity:executionDigest(p.projectRef),baseline:{kind:"commit",digest:"a".repeat(40)},label:"test"}),
executorAdmission:{online:async()=>({executorId:"device",generation:1,incarnation:"daemon",authorizedUntil:new Date(now.getTime()+60000)}),
reserve:async(tx,{ref,fence})=>{const assignmentId=crypto.randomUUID();await tx.executorAssignment.create({data:{attemptId:ref.attemptId,assignmentId,executorId:fence.executorId,generation:fence.generation,incarnation:fence.incarnation}});return {...ref,assignmentId,generation:1};},
prepare:async(tx,assignment,launchDigest)=>{await tx.executorAssignment.update({where:{attemptId:assignment.attemptId},data:{launch:assignment,launchDigest,preparedAt:now}});}}};
ports.executionEvents=createExecutionEventStore(ports);
console.log("ready");
for await (const chunk of Bun.stdin.stream()) { if (chunk.length) break; }
try {const run=await createRuns(ports,${JSON.stringify(f.principal.workspaceId)}).claimNext("background",undefined,{kind:"execution",executorId:"device"});console.log(JSON.stringify(run?.id??null));} finally {await db.$disconnect();}
`;
}

async function competitorOutput(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += new TextDecoder().decode(chunk.value);
    if (text.length > 1024) throw new Error("Unexpected competitor output");
  }
}

test("owner submissions share one workspace/owner bucket across three device environments", async () => {
  const f = await fixture(), owner: ExecutionPrincipal = { ...f.principal, caller: { kind: "owner" } };
  for (const id of ["device2", "device3"]) await f.db.executionExecutor.create({ data: { id, workspaceId: owner.workspaceId, ownerId: owner.ownerId, label: id, credentialHash: id, incarnation: "daemon" } });
  for (const [n, executorId] of ["device", "device2", "device3"].entries()) {
    const value = input(`owner-${n}`); value.placement.executorId = executorId;
    await f.admission.start(owner, value);
    const claimed = await f.runs.claimNext("background", undefined, { kind: "execution", executorId });
    if (n < 2) expect(claimed).not.toBeNull(); else expect(claimed).toBeNull();
  }
  expect(await f.db.run.count({ where: { startedAt: { not: null } } })).toBe(2);
});
