import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createRuns, nextLocalMidnight } from "./runs";
import { createAffairs } from "./affairs";
import { RUN_LIMITS } from "@chrona/contracts/steward";
let db: ReturnType<typeof testDb>, now: Date, runs: ReturnType<typeof createRuns>, affairId: string;
beforeEach(async () => {
  db = testDb(); now = new Date("2026-10-20T02:00:00Z");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  affairId = (await createAffairs({ db, workspaceId: "w", now: () => now }).create({ request: "Research" })).id;
  runs = createRuns({ db, now: () => now, chat: null, publicUrl: null });
});
afterEach(async () => { await db.$disconnect(); });
test("claim hashes capability; only one running run; deadline and invalid tokens forbidden", async () => {
  const claim = (await runs.claimNext())!;
  expect(claim.token).toHaveLength(64);
  const row = await db.affairRun.findUniqueOrThrow({ where: { id: claim.runId } });
  expect(row.tokenHash).not.toBe(claim.token);
  expect((await runs.authenticate(claim.token)).affair.id).toBe(affairId);
  expect(await runs.claimNext()).toBeNull();
  await expect(runs.authenticate("wrong")).rejects.toMatchObject({ code: "forbidden" });
  await expect(runs.authenticate(claim.token, claim.deadlineAt)).rejects.toMatchObject({ code: "forbidden" });
});
test("unavailable uses consecutive exponential backoff capped at 30 minutes, never failure", async () => {
  for (const delay of [1, 2, 4, 8, 16, 30, 30]) {
    const claim = (await runs.claimNext())!;
    await runs.finishRun(claim.runId, { outcome: "unavailable", note: "Unavailable" });
    const affair = await db.affair.findUniqueOrThrow({ where: { id: affairId } });
    expect(affair.failures).toBe(0);
    expect(affair.agentState).toBe("queued");
    expect(affair.nextRunAt!.getTime() - now.getTime()).toBe(delay * 60000);
    expect((await db.affairRun.findUniqueOrThrow({ where: { id: claim.runId } })).status).toBe("agent_unavailable");
    now = affair.nextRunAt!;
  }
});
test("exited and timeout count failures; third stops and notifies once; finish idempotent", async () => {
  for (const outcome of ["exited", "timeout", "exited"] as const) {
    const claim = (await runs.claimNext())!;
    await runs.finishRun(claim.runId, { outcome, note: "Failed" });
    expect((await db.affairRun.findUniqueOrThrow({ where: { id: claim.runId } })).status).toBe(outcome === "timeout" ? "timed_out" : "no_outcome");
    await runs.finishRun(claim.runId, { outcome, note: "Duplicate" });
  }
  expect(await db.affair.findUnique({ where: { id: affairId } })).toMatchObject({ failures: 3, agentState: "failed" });
  expect(await db.notification.count()).toBe(1);
  expect(await runs.claimNext()).toBeNull();
});
test("lease expiration retries without failure; stale process cannot change retry", async () => {
  const claim = (await runs.claimNext())!;
  now = claim.deadlineAt;
  expect(await runs.expireLeases()).toBe(1);
  expect(await runs.shouldStop(claim.runId)).toBe(true);
  await runs.finishRun(claim.runId, { outcome: "exited", note: "late" });
  expect(await db.affair.findUnique({ where: { id: affairId } })).toMatchObject({ failures: 0, agentState: "queued" });
  expect((await runs.claimNext())!.runId).not.toBe(claim.runId);
});
test("daily cap uses local date and records a single note", async () => {
  for (let i = 0; i < RUN_LIMITS.maxRunsPerAffairPerDay; i++) {
    await db.affairRun.create({ data: { workspaceId: "w", affairId, number: i + 1, wakeReason: "retry", affairRevision: 1, tokenHash: `old-${i}`, status: "closed", startedAt: now, deadlineAt: now, leaseUntil: now } });
  }
  expect(await runs.claimNext()).toBeNull();
  expect(await runs.claimNext()).toBeNull();
  const row = await db.affair.findUniqueOrThrow({ where: { id: affairId } });
  expect(row.nextRunAt!.toISOString()).toBe("2026-10-20T16:00:00.000Z");
  expect(await db.affairEntry.count({ where: { kind: "note" } })).toBe(1);
  now = row.nextRunAt!;
  expect((await runs.claimNext())!.affairId).toBe(affairId);
});
test("local midnight handles DST and non-hour offsets", () => {
  expect(nextLocalMidnight(new Date("2026-03-08T05:00:00Z"), "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  expect(nextLocalMidnight(now, "Asia/Kathmandu").toISOString()).toBe("2026-10-20T18:15:00.000Z");
});
test("paused affair stops and rejects capability; killed run cancelled", async () => {
  const claim = (await runs.claimNext())!;
  await db.affair.update({ where: { id: affairId }, data: { status: "paused" } });
  expect(await runs.shouldStop(claim.runId)).toBe(true);
  await expect(runs.authenticate(claim.token)).rejects.toMatchObject({ code: "forbidden" });
  await runs.finishRun(claim.runId, { outcome: "killed", note: "Stopped" });
  expect(await db.affairRun.findUnique({ where: { id: claim.runId } })).toMatchObject({ status: "cancelled" });
  expect(await runs.claimNext()).toBeNull();
});
