import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitContextPrimitive, ownedRun, view, type ModulePrincipal } from "../agent/agent-context";
import { createRuns, liveRuns, nextLocalMidnight } from "./runs";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import { notices } from "../__testing__/test-notices";
import { assertTerminalRecordsReleaseQuota, assertExplicitRetryIssuesFreshAttempt, assertInterleavedSettlementConverges } from "../__testing__/state-machine-invariants";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string, time: Date, principal: ModulePrincipal;
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z");
  workspaceId = (await db.workspace.create({ data: { name: "recovery" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-recovery-")), now: () => time, publicUrl: null };
  const module = await db.module.create({ data: { workspaceId, name: "recovery-app", activeHash: "hash", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest: { name: "recovery-app", entry: "index.ts", keepAlive: true, effects: [], uses: [], tests: ["test.ts"] }, status: "approved", source: "user", intent: {}, report: {} } });
  principal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  sessionId = (await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string }).contextId;
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
async function queueContext(requestKey = "run") {
  return await admitContextPrimitive(ports, principal, "run", { contextId: sessionId, requestKey, lane: "foreground", prompt: "Keep this", tools: [], content: [] }) as { runId: string };
}
test("a context retains one execution identity and rejects another owner or detached module", async () => {
  const queued = await queueContext();
  expect(await db.agentContext.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ workspaceId, ownerId: principal.ownerId, moduleId: principal.caller.moduleId, hash: principal.caller.hash, status: "active", cwd: join(ports.dataDir, "sessions", sessionId) });
  await expect(ownedRun(db, { ...principal, ownerId: "another-owner" }, queued.runId)).rejects.toMatchObject({ code: "not_found" });
  expect(await db.agentContext.count({ where: { workspaceId } })).toBe(1);
  await db.agentContext.update({ where: { id: sessionId }, data: { moduleId: null } });
  await expect(ownedRun(db, principal, queued.runId)).rejects.toMatchObject({ code: "not_found" });
  await expect(createRuns(ports, workspaceId).enqueue({ sessionId, lane: "foreground", trigger: "source", prompt: "Detached module" })).rejects.toMatchObject({ code: "forbidden" });
});

test.each(["failed", "unavailable"] as const)("Agent context %s preserves continuation but only its application can request another attempt", async outcome => {
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  await writeFile(join(run.cwd, "draft.txt"), "kept");
  await runs.finish(run.id, { outcome, sessionId: "provider-context", error: "Synthetic" }, { stopEvidence: "provider_exited" });
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: outcome === "unavailable" ? "provider_unavailable" : outcome, active: false });
  expect((await db.agentContext.findUniqueOrThrow({ where: { id: sessionId } })).providerSessionId).toBe("provider-context");
  expect(await readFile(join(run.cwd, "draft.txt"), "utf8")).toBe("kept");
  time = new Date(time.getTime() + 86400_000);
  expect(await runs.claimNext("foreground")).toBeNull();
  expect(await db.audit.count({ where: { kind: "run_continuation" } })).toBe(0);
  expect(await notices(db)).toHaveLength(0);
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
  const retry = await queueContext("application-retry");
  const claimed = (await runs.claimNext("foreground"))!;
  expect(claimed).toMatchObject({ id: retry.runId, sessionId, cwd: run.cwd, prompt: "Keep this" });
});
test("unknown Agent stop holds the context until actual Provider exit, without automatic retry", async () => {
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  expect(run).toMatchObject({ deadlineAt: null, leaseUntil: null });
  time = new Date(time.getTime() + 21 * 60_000);
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Interrupted" });
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: "unknown", active: true });
  await expect(queueContext("blocked-retry")).rejects.toMatchObject({ code: "conflict" });
  expect(await runs.claimNext("foreground")).toBeNull();
  await runs.finish(run.id, { outcome: "failed", sessionId: "provider-context", error: "Interrupted" }, { stopEvidence: "provider_exited" });
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: "failed", active: false });
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  await queueContext("confirmed-retry");
  expect(await runs.claimNext("foreground")).not.toBeNull();
});
test("expired Agent lease aborts and revokes capability but retains unknown stop until Provider exit", async () => {
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { runTimeoutMinutes: 1 } } });
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  let aborted = false;
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => { aborted = true; } });
  time = new Date(run.deadlineAt!.getTime() + 1);
  expect(await runs.expireLeases()).toBe(1); expect(aborted).toBe(true);
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: "unknown", active: true });
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(queueContext("blocked-retry")).rejects.toMatchObject({ code: "conflict" });
  await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("timed_out");
  expect(await runs.expireLeases()).toBe(0);
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
});
for (const [zone, at, expected] of [
  ["Asia/Shanghai", "2026-10-15T04:00:00Z", "2026-10-15T16:00:00.000Z"],
  ["America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00.000Z"],
]) test(`daily reset respects local midnight and DST: ${zone}`, () => {
  expect(nextLocalMidnight(new Date(at!), zone!).toISOString()).toBe(expected!);
});

test("stop authority survives diagnostic edits and audit deletion; error wording alone never occupies capacity", async () => {
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "lost process" });
  await db.run.update({ where: { id: run.id }, data: { error: "different diagnostic" } });
  await db.audit.deleteMany();
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: "unknown", active: true });
  await expect(queueContext("still-blocked")).rejects.toMatchObject({ code: "conflict" });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Execution stop is unconfirmed" }, { stopEvidence: "provider_exited" });
  expect(view(await ownedRun(ports.db, principal, run.id))).toMatchObject({ status: "failed", active: false });
  await queueContext("confirmed");
  expect(await runs.claimNext("foreground")).not.toBeNull();
});

test("confirmed terminal Runs release foreground capacity across repeated admissions", async () => {
  const runs = createRuns(ports, workspaceId);
  await assertTerminalRecordsReleaseQuota({
    quota: 1,
    extra: 2,
    async allocate(index) {
      const queued = await queueContext(`quota-${index}`);
      const claimed = await runs.claimNext("foreground");
      expect(claimed?.id).toBe(queued.runId);
      expect(await runs.claimNext("foreground")).toBeNull();
      return queued.runId;
    },
    async settleTerminal(runId) {
      await runs.finish(runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
      expect(view(await ownedRun(db, principal, runId))).toMatchObject({ status: "finished", active: false });
    },
  });
});

test("an explicit application retry claims a fresh Run and capability after failure", async () => {
  const runs = createRuns(ports, workspaceId), claims = new Set<string>();
  await assertExplicitRetryIssuesFreshAttempt({
    async runFailingAttempt() {
      const queued = await queueContext("first-failure");
      const claimed = (await runs.claimNext("foreground"))!;
      expect(claimed.id).toBe(queued.runId);
      claims.add(claimed.id);
      await runs.finish(claimed.id, { outcome: "failed", sessionId: null, error: "fixture failure" }, { stopEvidence: "provider_exited" });
      return claimed;
    },
    async retry(failed) {
      const queued = await queueContext("explicit-retry");
      const claimed = (await runs.claimNext("foreground"))!;
      expect(claimed.id).toBe(queued.runId);
      expect(claimed.id).not.toBe(failed.id);
      expect(claimed.token).not.toBe(failed.token);
      await expect(runs.authenticate(failed.token)).rejects.toMatchObject({ code: "forbidden" });
      expect(await runs.authenticate(claimed.token)).toMatchObject({ run: { id: claimed.id } });
      claims.add(claimed.id);
    },
    observedDownstreamAttempts: () => claims.size,
  });
});

test("cancellation and Provider exit converge when stop observation is interleaved", async () => {
  const runs = createRuns(ports, workspaceId);
  await assertInterleavedSettlementConverges({
    async beginRequest(scenario) {
      await queueContext(`interleaved-${scenario}`);
      return (await runs.claimNext("foreground"))!;
    },
    async resolveExternally(run) {
      await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Observer disconnected" });
    },
    async enterWaiting(run) {
      await db.run.update({ where: { id: run.id }, data: { cancelRequestedAt: ports.now() } });
    },
    async readFinalState(run) {
      await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
      const current = view(await ownedRun(db, principal, run.id));
      return { status: current.status, active: current.active };
    },
    isStuckWaiting: state => state.active,
  });
});
