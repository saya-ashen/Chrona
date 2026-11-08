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
import { providerCancelKey } from "./provider-journal";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string, time: Date, principal: ExecutionPrincipal;
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z");
  workspaceId = (await db.workspace.create({ data: { name: "recovery" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-recovery-")), now: () => time, publicUrl: null };
  const module = await db.module.create({ data: { workspaceId, name: "recovery-app", activeHash: "hash", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest: { name: "recovery-app", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: [], tests: ["test.ts"] }, status: "approved", source: "user", intent: {}, report: {} } });
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
test.each(["failed", "timed_out", "unavailable", "cancelled", "finished"] as const)("build %s preserves work and never resumes the originating Agent context", async outcome => {
  const runs = createRuns(ports, workspaceId);
  const build = await db.session.create({ data: { workspaceId, key: "build:sample", source: "build", originSessionId: sessionId } });
  await db.audit.create({ data: { id: `build-targets:${build.id}`, workspaceId, subjectId: build.id, kind: "build_targets", actorKey: "user", details: { name: "sample", modules: ["sample"] } } });
  await runs.enqueue({ sessionId: build.id, lane: "build", trigger: "build", prompt: "Keep this draft" });
  const run = (await runs.claimNext("build"))!;
  await writeFile(join(run.cwd, "draft.txt"), "kept");
  if (outcome === "timed_out") time = new Date(run.deadlineAt.getTime() + 1);
  if (outcome === "cancelled") await db.audit.create({ data: { id: providerCancelKey(run.id), workspaceId, kind: "provider_cancel", actorKey: "user", subjectId: run.id, details: {} } });
  await runs.finish(run.id, { outcome: outcome === "cancelled" ? "failed" : outcome, sessionId: "provider-context", error: outcome === "finished" ? null : "Synthetic" }, { stopEvidence: "provider_exited" });
  const status = outcome === "unavailable" ? "provider_unavailable" : outcome;
  expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status });
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(await db.audit.count({ where: { kind: "run_continuation" } })).toBe(0);
  expect(await db.message.count({ where: { sessionId } })).toBe(0);
  expect(await readFile(join(run.cwd, "draft.txt"), "utf8")).toBe("kept");
  const facts = await db.audit.findMany({ where: { kind: "kernel_fact_pending" } });
  if (["failed", "timed_out", "unavailable"].includes(outcome)) {
    expect(facts).toHaveLength(1);
    expect(facts[0]!.details).toMatchObject({ type: "lifecycle", data: { key: `build-paused:${run.id}`, session: build.id, fact: { kind: "build-paused", status, outcome: status } } });
  } else expect(facts).toHaveLength(0);
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
});
test("expired Agent lease aborts and revokes capability but retains unknown stop until Provider exit", async () => {
  const runs = createRuns(ports, workspaceId);
  await queueContext();
  const run = (await runs.claimNext("foreground"))!;
  let aborted = false;
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => { aborted = true; } });
  time = new Date(run.deadlineAt.getTime() + 1);
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
