import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import { admitContextPrimitive } from "./agent-context";
import { createRuns, liveRuns, nextLocalMidnight } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string, time: Date, principal: ExecutionPrincipal;
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
test.each(["failed", "unavailable"] as const)("Agent context %s preserves continuation but only its application can request another attempt", async outcome => {
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  await writeFile(join(run.cwd, "draft.txt"), "kept");
  await runs.finish(run.id, { outcome, sessionId: "provider-context", error: "Synthetic" }, { stopEvidence: "provider_exited" });
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: outcome === "unavailable" ? "provider_unavailable" : outcome, active: false });
  expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).providerSessionId).toBe("provider-context");
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
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: "unknown", active: true });
  await expect(queueContext("blocked-retry")).rejects.toMatchObject({ code: "conflict" });
  expect(await runs.claimNext("foreground")).toBeNull();
  await runs.finish(run.id, { outcome: "failed", sessionId: "provider-context", error: "Interrupted" }, { stopEvidence: "provider_exited" });
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: "failed", active: false });
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
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: "unknown", active: true });
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
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: "unknown", active: true });
  await expect(queueContext("still-blocked")).rejects.toMatchObject({ code: "conflict" });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Execution stop is unconfirmed" }, { stopEvidence: "provider_exited" });
  expect(await admitContextPrimitive(ports, principal, "get", { runId: run.id })).toMatchObject({ status: "failed", active: false });
  await queueContext("confirmed");
  expect(await runs.claimNext("foreground")).not.toBeNull();
});
