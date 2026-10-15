import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import { createStewardService, type StewardPorts } from "./service";
import { liveRuns } from "./runs";

let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>;
let workspaceId: string, time: Date, sent: string[];
const conversationKey = "chat:in_app";
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z"); sent = [];
  workspaceId = (await db.workspace.create({ data: { name: "recovery" } })).id;
  ports = { db, now: () => time, dataDir: await mkdtemp(join(tmpdir(), "chrona-recovery-")), publicUrl: null, chat: null,
    deliveries: [{ channel: "in_app", send: async input => { sent.push(input.body); return { outcome: "accepted", receiptRef: null }; } }] };
  service = createStewardService(ports);
  await db.message.create({ data: { workspaceId, conversationKey, channel: "in_app", direction: "in", text: "Original request", at: time } });
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
const api = () => service.forWorkspace(workspaceId);
async function start(affairId?: string, lane: "foreground" | "background" = "foreground") {
  await api().runs.enqueue({ affairId, lane, trigger: "message", conversationKey, prompt: "Original request" });
  return (await api().runs.claimNext(lane))!;
}

for (const outcome of ["failed", "unavailable", "timed_out", "lease"] as const) {
  for (const lane of ["foreground", "background"] as const) {
    if (outcome === "timed_out" && lane === "foreground") continue; // Deadline deliberately switches lanes.
    test(`${lane} ${outcome}: retry preserves identity, context and original prompt`, async () => {
      const affair = await api().affairs.create({ title: "Study" });
      const run = await start(affair.id, lane);
      const inbound = await db.message.findFirstOrThrow({ where: { direction: "in" } });
      await db.audit.create({ data: { workspaceId, actorKey: "owner", kind: "chat_run_input", subjectId: run.id, details: { messageId: inbound.id } } });
      if (outcome === "lease") {
        await db.run.update({ where: { id: run.id }, data: { leaseUntil: time } });
        expect(await api().runs.expireLeases()).toBe(1);
      } else await api().runs.finish(run.id, { outcome, sessionId: null, error: "fake failure" });
      const retry = await db.run.findFirstOrThrow({ where: { status: "queued" } });
      for (const key of ["conversationKey", "affairId", "lane", "trigger", "prompt", "cwd"] as const) expect(retry[key]).toBe(run[key]);
      expect(retry.tokenHash).not.toBe(run.tokenHash);
      expect((await db.audit.findFirstOrThrow({ where: { kind: "chat_run_input", subjectId: retry.id } })).details).toEqual({ messageId: inbound.id });
      time = retry.leaseUntil!;
      const claimed = (await api().runs.claimNext(lane))!;
      if (lane === "foreground") {
        await service.tools.call(claimed.token, "chrona_reply", { text: "Resumed successfully" });
        expect(sent).toEqual(["Resumed successfully"]);
        expect((await db.message.findFirstOrThrow({ where: { direction: "out" } })).conversationKey).toBe(conversationKey);
      }
      await api().runs.finish(claimed.id, { outcome: "finished", sessionId: null, error: null });
    });
  }
}

test("root provider failure also preserves conversation and prompt", async () => {
  const run = await start();
  await api().runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: "offline" });
  const retry = await db.run.findFirstOrThrow({ where: { status: "queued" } });
  expect(retry).toMatchObject({ affairId: null, conversationKey, lane: "foreground", trigger: "message", prompt: run.prompt });
  time = retry.leaseUntil!;
  await service.tools.call((await api().runs.claimNext("foreground"))!.token, "chrona_reply", { text: "Root resumed" });
  expect(sent).toEqual(["Root resumed"]);
});

for (const root of [false, true]) for (const replied of [false, true]) test(`deadline: root=${root}, replied=${replied}; background continuation, one honest message at most`, async () => {
  const affair = await api().affairs.create({ title: "Study" });
  const run = await start(root ? undefined : affair.id);
  if (root) await service.tools.call(run.token, "chrona_focus", { affairId: affair.id });
  if (replied) await service.tools.call(run.token, "chrona_reply", { text: "Already working" });
  // An unrelated older reply must not suppress this run's deadline message.
  await db.message.create({ data: { workspaceId, conversationKey, direction: "out", channel: "in_app", text: "Other run", at: time } });
  time = run.deadlineAt;
  await Promise.all([api().runs.expireLeases(), api().runs.finish(run.id, { outcome: "timed_out", sessionId: null, error: "deadline" })]);
  await api().runs.finish(run.id, { outcome: "timed_out", sessionId: null, error: "duplicate" });
  const pending = await db.run.findMany({ where: { status: "queued" } });
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ affairId: affair.id, conversationKey, lane: "background", trigger: run.trigger, prompt: run.prompt });
  expect(pending[0]!.cwd).not.toBe(join(ports.dataDir, "affairs"));
  expect(sent).toEqual(replied ? ["Already working"] : ["这次处理超时了，我会在后台继续。"]);
  expect(await db.message.count({ where: { text: "这次处理超时了，我会在后台继续。" } })).toBe(replied ? 0 : 1);
  expect((await api().runs.claimNext("background"))!.affairId).toBe(affair.id);
});

for (const focus of ["none", "paused"] as const) test(`deadline with ${focus} focus does not promise impossible continuation`, async () => {
  const run = await start();
  if (focus === "paused") {
    const affair = await api().affairs.create({ title: "Paused" });
    await service.tools.call(run.token, "chrona_focus", { affairId: affair.id });
    await api().affairs.update(affair.id, { status: "paused" });
  }
  time = run.deadlineAt;
  await api().runs.expireLeases();
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("无法在后台继续");
});

test("deadline abort completion race is classified as timeout and not foreground failure retry", async () => {
  const affair = await api().affairs.create({ title: "Study" });
  const run = await start(affair.id);
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => {
    await api().runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Pi run aborted" });
  } });
  time = run.deadlineAt;
  await api().runs.expireLeases();
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("timed_out");
  expect(await db.run.count({ where: { status: "queued", lane: "foreground" } })).toBe(0);
  expect(await db.run.count({ where: { status: "queued", lane: "background" } })).toBe(1);
  expect(sent).toEqual(["这次处理超时了，我会在后台继续。"]);
});

test("deadline delivery failure keeps durable message and continuation and signals completion", async () => {
  ports.deliveries = [{ channel: "in_app", send: async () => { throw new Error("offline"); } }];
  const affair = await api().affairs.create({ title: "Study" });
  const run = await start(affair.id);
  time = run.deadlineAt;
  await api().runs.expireLeases();
  expect(await db.message.count({ where: { direction: "out" } })).toBe(1);
  expect(await db.run.count({ where: { status: "queued", lane: "background" } })).toBe(1);
  expect(await db.audit.count({ where: { kind: "chat_run_finished", subjectId: run.id } })).toBe(1);
  expect((await db.audit.findFirstOrThrow({ where: { kind: "deadline_reply_delivery" } })).details).toMatchObject({ outcome: "failed" });
});
