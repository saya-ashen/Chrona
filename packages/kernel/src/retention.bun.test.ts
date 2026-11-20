import { afterEach, expect, test } from "bun:test";
import type { Prisma } from "@chrona/db";
import { testDb } from "./__testing__/test-db";
import { pruneHistory } from "./retention";
import { appendRunEventIn } from "./execution/run-events";
import { createTick } from "./runtime/tick";
import { moduleFailurePolicy, recordModuleExecution } from "./modules/module-failure-policy";
import { settleRunCompletion } from "./agent/agent-completion-settlement";

const now = new Date("2026-11-12T12:00:00Z");
const old = new Date("2026-11-01T12:00:00Z");
const boundary = new Date("2026-11-05T12:00:00Z");
const closes: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); });
async function fixture() {
  const db = testDb(); closes.push(() => db.$disconnect());
  const workspaceId = (await db.workspace.create({ data: { name: "retention" } })).id;
  const moduleId = (await db.module.create({ data: { workspaceId, name: "app", status: "active", activeHash: "hash" } })).id;
  const run = (id: string, extra: Partial<Prisma.RunUncheckedCreateInput> = {}) => db.run.create({ data: {
    id, workspaceId, lane: "foreground", trigger: "test", provider: "fake", tokenHash: id,
    prompt: "", cwd: "/tmp", status: "finished", stopStatus: "confirmed", endedAt: old, createdAt: old, ...extra,
  } });
  const invocation = (id: string, extra: Partial<Prisma.ModuleInvocationUncheckedCreateInput> = {}) => db.moduleInvocation.create({ data: {
    id, workspaceId, caller: "module:app", target: "app", tool: "timer", args: {}, key: id,
    mode: "timer", status: "succeeded", createdAt: old, finishedAt: old, ...extra,
  } });
  const moduleRun = (id: string, extra: Partial<Prisma.ModuleRunUncheckedCreateInput> = {}) => db.moduleRun.create({ data: {
    id, moduleId, hash: "hash", triggerId: id, exitCode: 0, firedAt: old, createdAt: old, ...extra,
  } });
  const call = (id: string, extra: Partial<Prisma.ModuleCallUncheckedCreateInput> = {}) => db.moduleCall.create({ data: {
    id, moduleId, workspaceId, moduleName: "app", hash: "hash", key: id, method: "read", status: "executed", createdAt: old, ...extra,
  } });
  const event = (runId: string, sequence = 1, extra: Partial<Prisma.RunEventUncheckedCreateInput> = {}) => db.runEvent.create({ data: {
    runId, sequence, kind: "progress", payload: {}, createdAt: old, ...extra,
  } });
  const fact = (id: string, extra: Partial<Prisma.KernelFactUncheckedCreateInput> = {}) => db.kernelFact.create({ data: {
    id, workspaceId, payload: { type: "lifecycle", data: { key: id, fact: { kind: "module-paused", app: "gone" } } },
    consumedBy: "removed-app", consumedAt: old, createdAt: old, ...extra,
  } });
  const audit = (id: string, kind = "module_activate", createdAt = old) => db.audit.create({ data: {
    id, workspaceId, kind, actorKey: "chrona", details: {}, createdAt,
  } });
  const epoch = (activationId: string, createdAt = old, candidateHash = "hash") => db.moduleActivation.create({ data: {
    activationId, moduleId, candidateHash, previousHash: null, activatedAt: createdAt.toISOString(),
    status: "verified", changes: [], checks: {}, observedCapabilities: [], dataHandling: "preserve",
    nextAction: "none", rollback: { attempted: false, result: "not-attempted", reason: null }, createdAt, updatedAt: createdAt,
  } });
  const result = (id: string, activationId: string, createdAt = old) => db.moduleExecutionResult.create({ data: {
    id, moduleId, hash: "hash", activationId, resultId: id, outcome: "success", consecutiveFailures: 0, createdAt,
  } });
  return { db, workspaceId, moduleId, run, invocation, moduleRun, call, event, fact, audit, epoch, result };
}

test("ninety-day payload expiry preserves consumed receipt identities and unknown work", async () => {
  const f = await fixture(), expired = new Date("2026-07-01T00:00:00Z");
  const run = await f.run("settled-90", { prompt: "old request body", summary: "old result body", error: "old diagnostic", toolCalls: [{ tool: "effect" }], endedAt: expired, createdAt: expired });
  await f.run("unknown-90", { prompt: "must keep unknown request", stopStatus: "unknown", endedAt: expired, createdAt: expired });
  for (const status of ["succeeded", "unknown", "running"] as const) await f.invocation(`receipt-${status}`, {
    targetIdentity: f.moduleId, mode: "sync", tool: "write", args: { private: "old arguments" }, output: { private: "old output" },
    requestDigest: "fixed-digest", runId: status === "succeeded" ? run.id : null, status, createdAt: expired, finishedAt: expired,
  });
  await pruneHistory(f.db, now);
  const receipt = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: "receipt-succeeded" } });
  expect(receipt).toMatchObject({ key: "receipt-succeeded", requestDigest: "fixed-digest", args: {}, output: null, status: "failed", errorCode: "conflict" });
  expect(receipt.error).toContain("key remains consumed");
  expect(await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ prompt: "", summary: null, error: null, toolCalls: [], stopStatus: "confirmed" });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: "unknown-90" } })).toMatchObject({ prompt: "must keep unknown request", stopStatus: "unknown" });
  for (const status of ["unknown", "running"]) expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: `receipt-${status}` } })).toMatchObject({ args: { private: "old arguments" }, output: { private: "old output" }, status });
});

test("seven-day boundary is strict for every expiring model; current failure-policy state and event sequence survive", async () => {
  const f = await fixture();
  await f.epoch("old"); await f.epoch("new", boundary);
  for (const [name, at] of [["old", old], ["boundary", boundary], ["new", now]] as const) {
    await f.invocation(name, { createdAt: at, finishedAt: at });
    await f.moduleRun(name, { createdAt: at, firedAt: at });
    await f.call(name, { createdAt: at });
    await f.run(name, { endedAt: at, eventSequence: 1 }); await f.event(name, 1, { createdAt: at });
    await f.fact(name, { createdAt: at, consumedAt: at });
    await f.audit(name, "module_activate", at);
    await f.result(name, "old", at);
  }
  await f.result("current-policy", "new");
  expect(await pruneHistory(f.db, now)).toEqual({ calls: 1, invocations: 1, runs: 1, results: 1, events: 1, facts: 1, audit: 1 });
  const retainedRows = await Promise.all([
    f.db.moduleInvocation.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    f.db.moduleCall.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    f.db.moduleRun.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    f.db.kernelFact.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    f.db.audit.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  for (const rows of retainedRows) expect(rows).toEqual([{ id: "boundary" }, { id: "new" }]);
  expect((await f.db.moduleExecutionResult.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(r => r.id)).toEqual(["boundary", "current-policy", "new"]);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: "old" } })).toMatchObject({ eventSequence: 1 });
  await f.db.$transaction(tx => appendRunEventIn(tx, "old", "progress", { afterPrune: true }, now));
  expect(await f.db.runEvent.findMany({ where: { runId: "old" }, select: { sequence: true } })).toEqual([{ sequence: 2 }]);
});

test("pending/unknown claims, leases, undelivered replies, keyed receipts and live Run references never expire", async () => {
  const f = await fixture();
  for (const status of ["queued", "running", "waiting", "unknown", "deferred", "future-status"]) await f.invocation(status, { status });
  await f.invocation("lease", { leaseToken: "old-token", leaseUntil: old });
  await f.invocation("lease-without-token", { leaseUntil: old });
  await f.invocation("reply", { reply: true, replyAttempts: 3 });
  await f.invocation("keyed-sync", { mode: "sync" });
  await f.invocation("keyed-async", { mode: "async", operationOutput: { status: "pending_approval" } });
  for (const [id, extra] of [
    ["live", { status: "running", endedAt: null }], ["uncertain", { stopStatus: "unknown" }],
    ["leased", { leaseUntil: old }], ["recent-stop", { endedAt: now }],
  ] as const) {
    await f.run(id, extra); await f.invocation(id, { runId: id }); await f.event(id);
  }
  await f.run("awaiting-reply"); await f.invocation("pending-on-run", { runId: "awaiting-reply", reply: true }); await f.event("awaiting-reply");
  await f.invocation("settled-reply", { reply: true, repliedAt: old });
  await f.invocation("settled-failure", { status: "failed" });
  // Explicit keys preserve exact read replies as well as effect receipts.
  await f.invocation("keyed-read", { mode: "sync", target: "modules", tool: "describe" });
  await f.invocation("stream-event", { mode: "sync", target: "runtime-callback", tool: "event" });
  await f.invocation("recent-read", { mode: "sync", target: "modules", tool: "list", createdAt: now, finishedAt: now });
  const before = await f.db.moduleInvocation.count();
  expect(await pruneHistory(f.db, now)).toMatchObject({ invocations: 2, events: 0 });
  expect(await f.db.moduleInvocation.count()).toBe(before - 2);
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "keyed-sync" } })).not.toBeNull();
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "keyed-read" } })).not.toBeNull();
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "stream-event" } })).not.toBeNull();
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "recent-read" } })).not.toBeNull();
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "settled-reply" } })).toBeNull();
  expect(await f.db.moduleInvocation.findUnique({ where: { id: "settled-failure" } })).toBeNull();
});

test("ModuleRun -1 and delivery claims stay; model accounting/replay and unknown/internal calls stay", async () => {
  const f = await fixture();
  await f.moduleRun("unfinished", { exitCode: -1 });
  await f.invocation("recoverable", { status: "unknown" });
  await f.moduleRun("recoverable");
  await f.moduleRun("model-pending"); await f.call("model-pending", { method: "model", status: "pending", moduleRunId: "model-pending" });
  await f.moduleRun("recent", { createdAt: now });
  await f.call("live-rejected", { status: "rejected", moduleRunId: "unfinished" });
  await f.call("live-claim", { status: "failed", moduleRunId: "recoverable" });
  for (const status of ["pending", "queued", "running", "waiting", "unknown"]) await f.call(status, { status });
  for (const error of ["unknown", "internal"]) await f.call(`error-${error}`, { status: "failed", error });
  await f.call("model-executed", { method: "model" }); await f.call("model-failed", { method: "model", status: "failed" });
  await f.call("model-rejected", { method: "model", status: "rejected" });
  await f.call("legacy-terminal", { status: "failed", error: "provider_failed" });
  await f.moduleRun("finished");
  expect(await pruneHistory(f.db, now)).toMatchObject({ calls: 2, runs: 1 });
  expect(await f.db.moduleRun.findUnique({ where: { id: "finished" } })).toBeNull();
  expect(await f.db.moduleRun.count()).toBe(4);
  expect(await f.db.moduleCall.findUnique({ where: { id: "model-executed" } })).not.toBeNull();
  expect(await f.db.moduleCall.findUnique({ where: { id: "model-failed" } })).not.toBeNull();
});

test("failure-policy deduplication keeps every current/unmatched epoch receipt including same-hash resume", async () => {
  const f = await fixture();
  await f.epoch("a"); await f.epoch("z"); // exact timestamp tie-break is activationId
  await f.epoch("other-hash", now, "other");
  await f.result("superseded", "a"); await f.result("current-1", "z"); await f.result("current-2", "z");
  await f.result("unmatched", "missing");
  await f.db.module.update({ where: { id: f.moduleId }, data: { activationId: "resume-is-not-epoch" } });
  expect(await pruneHistory(f.db, now)).toMatchObject({ results: 1 });
  expect((await f.db.moduleExecutionResult.findMany({ orderBy: { id: "asc" }, select: { id: true } })).map(r => r.id)).toEqual(["current-1", "current-2", "unmatched"]);
});

test("a newer different-hash activation retires inactive execution history", async () => {
  const f = await fixture();
  await f.epoch("old-hash"); await f.epoch("new-hash", now, "new");
  await f.result("old-result", "old-hash");
  await f.db.module.update({ where: { id: f.moduleId }, data: { activeHash: "new" } });
  expect(await pruneHistory(f.db, now)).toMatchObject({ results: 1 });
  expect(await f.db.moduleExecutionResult.count()).toBe(0);
});

test("failure streaks and duplicate success/failure replay survive diagnostic pruning without Audit mirrors", async () => {
  const f = await fixture();
  await f.epoch("superseded"); await f.epoch("current", boundary);
  await f.result("obsolete", "superseded");
  const input = { workspaceId: f.workspaceId, moduleId: f.moduleId, hash: "hash", activationId: "current", now: old };
  await recordModuleExecution(f.db, { ...input, resultId: "success", outcome: "success" });
  for (const resultId of ["failure-1", "failure-2", "failure-3"]) await recordModuleExecution(f.db, { ...input, resultId, outcome: "failure" });
  await f.db.module.update({ where: { id: f.moduleId }, data: { activationId: "resume-is-not-epoch" } });
  const before = await moduleFailurePolicy(f.db, input);
  expect(before).toMatchObject({ consecutiveFailures: 3, shouldPause: true });
  expect(await f.db.audit.count()).toBe(0);
  expect(await pruneHistory(f.db, now)).toMatchObject({ results: 1, audit: 0 });
  expect(await moduleFailurePolicy(f.db, input)).toEqual(before);
  for (const [resultId, outcome] of [["success", "success"], ["failure-1", "failure"]] as const) {
    expect(await recordModuleExecution(f.db, { ...input, resultId, outcome, now })).toMatchObject({ duplicate: true, consecutiveFailures: 3, shouldPause: true });
  }
  expect(await recordModuleExecution(f.db, { ...input, activationId: "superseded", resultId: "obsolete", outcome: "failure", now })).toBeNull();
  expect(await f.db.audit.count()).toBe(0);
  expect(await f.db.moduleExecutionResult.count()).toBe(4);
});

test("completed provider reservations and completion events remain replayable after diagnostic pruning", async () => {
  const f = await fixture();
  await f.run("completion", { eventSequence: 2 });
  await f.call("reservation", { method: "model", status: "executed" });
  await f.db.agentRunProvider.create({ data: {
    runId: "completion", kind: "completion", providerId: "provider", moduleId: f.moduleId, hash: "hash", revision: "r1",
    declaration: {}, providerOptions: {}, completion: { reservationId: "reservation", maxOutputTokens: 20, limits: { maxOutputTokens: 20, eventTimeoutMs: 1000 } },
  } });
  await f.db.agentRunAdmission.create({ data: { runId: "completion", moduleId: f.moduleId, hash: "hash", targets: [], content: {} } });
  await f.event("completion", 1, { kind: "completion", payload: { text: "retained" } });
  await f.event("completion", 2);
  const ports = { db: f.db, now: () => now, dataDir: "/tmp", publicUrl: null };
  const observation = { outcome: { outcome: "finished" as const, sessionId: null, error: null } };
  const before = await settleRunCompletion(ports, f.workspaceId, "completion", observation);
  expect(await pruneHistory(f.db, now)).toMatchObject({ calls: 0, events: 1 });
  expect(await settleRunCompletion(ports, f.workspaceId, "completion", observation)).toEqual(before);
  expect(await f.db.runEvent.findMany({ where: { runId: "completion" }, select: { kind: true } })).toEqual([{ kind: "completion" }]);
});

test("facts preserve active or paused consumer ACKs, pending pages, withdrawals and explicit consumer selection", async () => {
  const f = await fixture();
  await f.db.module.update({ where: { id: f.moduleId }, data: { status: "paused" } });
  await f.db.kernelFactConsumer.create({ data: { workspaceId: f.workspaceId, moduleId: f.moduleId, revision: "selection", updatedAt: old } });
  await f.fact("ack-retry", { consumedBy: f.moduleId });
  await f.fact("pending", { consumedBy: null, consumedAt: null });
  await f.fact("withdraw", { payload: { type: "withdraw", data: { key: "staged-key" } } });
  await f.fact("future-type", { payload: { type: "future" } });
  await f.fact("recent-ack", { consumedAt: now });
  await f.fact("orphan");
  expect(await pruneHistory(f.db, now)).toMatchObject({ facts: 1 });
  expect(await f.db.kernelFact.findUnique({ where: { id: "orphan" } })).toBeNull();
  expect(await f.db.kernelFact.count()).toBe(5);
  expect(await f.db.kernelFactConsumer.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } })).toMatchObject({ revision: "selection", moduleId: f.moduleId });
});

test("only pure-log Audit kinds expire; live authority, ordering, bounded health tails and unknown kinds survive", async () => {
  const f = await fixture();
  const retained = ["execution_admission_intent", "execution_governance_receipt", "execution_governance_reconcile", "run_continuation", "chat_run_input", "module_build_started", "module_enabled", "module_disabled", "module_runtime_incident", "module_output_mismatch", "future_kind"];
  for (const kind of retained) await f.audit(kind, kind);
  const logs = [
    "approval_created", "approval_resolved", "grant_created", "grant_revoked", "grant_consumed",
    "secret_set", "secret_removed", "settings_updated", "module_activate", "module_auto_activated", "module_rollback", "module_migration_started",
    "module_submission", "module_build_settled", "module_build_rejection", "admin_rollback", "reflection_started", "reflection_suggested",
    "module_settings_updated", "workspace_stray_quarantined", "workspace_stray_quarantine_failed", "build_settings_updated", "module_build_failed",
    "module_model_call", "module_tool_call", "module_status_changed", "module_removed", "module_group_activation", "module_candidate_rejected",
    "build_targets", "build_request", "run_claimed", "run_finished", "run_reply", "tool_limit_rejected", "tool_started", "tool_finished", "run_finalize_failed", "execution_capture_failed",
  ];
  for (const kind of logs) { await f.audit(`old-${kind}`, kind); await f.audit(`new-${kind}`, kind, now); }
  expect(await pruneHistory(f.db, now)).toMatchObject({ audit: logs.length });
  expect(await f.db.audit.count()).toBe(retained.length + logs.length);
  for (const kind of retained) expect(await f.db.audit.findUnique({ where: { id: kind } })).not.toBeNull();
});

test("a pass drains backlogs past one 500-row batch; concurrent/repeated ticks share an hourly guard", async () => {
  const f = await fixture();
  await f.epoch("before"); await f.epoch("after", boundary); await f.run("bulk", { eventSequence: 505 });
  for (let start = 0; start < 505; start += 100) {
    const ids = Array.from({ length: Math.min(100, 505 - start) }, (_, i) => `row-${start + i}`);
    await f.db.moduleInvocation.createMany({ data: ids.map(id => ({ id, workspaceId: f.workspaceId, caller: "kernel", target: "app", tool: "timer", args: {}, key: id, mode: "timer", status: "succeeded", createdAt: old, finishedAt: old })) });
    await f.db.moduleCall.createMany({ data: ids.map(id => ({ id, workspaceId: f.workspaceId, moduleName: "app", hash: "hash", key: id, method: "read", status: "rejected", createdAt: old })) });
    await f.db.moduleRun.createMany({ data: ids.map(id => ({ id, moduleId: f.moduleId, hash: "hash", triggerId: id, firedAt: old, exitCode: 0, createdAt: old })) });
    await f.db.moduleExecutionResult.createMany({ data: ids.map(id => ({ id, moduleId: f.moduleId, hash: "hash", activationId: "before", resultId: id, outcome: "failure", consecutiveFailures: 1, createdAt: old })) });
    await f.db.runEvent.createMany({ data: ids.map((_, i) => ({ runId: "bulk", sequence: start + i + 1, kind: "progress", payload: {}, createdAt: old })) });
    await f.db.kernelFact.createMany({ data: ids.map(id => ({ id, workspaceId: f.workspaceId, payload: { type: "notice" }, consumedBy: "removed", consumedAt: old, createdAt: old })) });
    await f.db.audit.createMany({ data: ids.map(id => ({ id, workspaceId: f.workspaceId, kind: "module_activate", actorKey: "chrona", details: {}, createdAt: old })) });
  }
  const counts = { calls: 505, invocations: 505, runs: 505, results: 505, events: 505, facts: 505, audit: 505 };
  expect(await Promise.all([pruneHistory(f.db, now), pruneHistory(f.db, now)])).toEqual([counts, null]);
  expect(await pruneHistory(f.db, new Date(now.getTime() + 3599_999))).toBeNull();
  expect(await pruneHistory(f.db, old)).toBeNull();
  expect(await pruneHistory(f.db, new Date(now.getTime() + 3600_000))).toEqual({ calls: 0, invocations: 0, runs: 0, results: 0, events: 0, facts: 0, audit: 0 });
});

test("tick does not wait for or fail on pruning; a failed pass is logged and cannot spin", async () => {
  const db = testDb(); closes.push(() => db.$disconnect());
  const execute = db.$executeRaw.bind(db);
  let attempts = 0;
  db.$executeRaw = ((query: Prisma.Sql) => {
    if (query.sql.includes('DELETE FROM "ModuleVersion"')) return execute(query);
    attempts++;
    return Promise.reject(new Error("retention write failure"));
  }) as typeof db.$executeRaw;
  const logged: string[] = [], error = console.error;
  console.error = (line: string) => { logged.push(line); };
  try {
    const { failures } = await createTick({ db, now: () => now, dataDir: "/tmp", publicUrl: null })();
    await Bun.sleep(0);
    expect(failures).toHaveLength(0);
  } finally { console.error = error; }
  expect(logged.some(line => line.includes("prune_failed") && line.includes("retention write failure"))).toBe(true);
  expect(attempts).toBe(1);
  expect(await pruneHistory(db, now)).toBeNull();
  db.$executeRaw = execute;
  expect(await pruneHistory(db, new Date(now.getTime() + 3600_000))).toEqual({ calls: 0, invocations: 0, runs: 0, results: 0, events: 0, facts: 0, audit: 0 });
});
