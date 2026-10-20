import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviderChannel } from "./provider-channel";
import { providerCancelKey, providerRuns } from "./provider-journal";
import { providerStartGate } from "./provider-start";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import { liveRuns } from "./runs";
import type { StewardPorts } from "./ports";
import type { ProviderQuestion } from "@chrona/contracts/steward";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, time: Date;
let service: ReturnType<typeof createStewardService>, api: ReturnType<typeof service.forWorkspace>;
const channels: ReturnType<typeof createProviderChannel>[] = [];
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-17T04:00:00Z"); workspaceId = (await db.workspace.create({ data: { name: "provider" } })).id;
  ports = { db, now: () => time, dataDir: await mkdtemp(join(tmpdir(), "chrona-provider-channel-")), deliveries: [], chat: null, publicUrl: null };
  service = createStewardService(ports); api = service.forWorkspace(workspaceId);
});
afterEach(async () => { await Promise.all(channels.splice(0).map(channel => channel.close())); liveRuns.clear(); await db.$disconnect(); });
async function fixture() {
  const affair = await api.affairs.create({ title: "Independent work" });
  await api.runs.enqueue({ affairId: affair.id, lane: "foreground", trigger: "message", prompt: "Work" });
  const run = (await api.runs.claimNext("foreground"))!, controller = new AbortController(), channel = createProviderChannel(ports, run); channels.push(channel);
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => { controller.abort(); await channel.close(); await api.runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Abort" }); } });
  return { affair, run, channel, controller };
}
const question = (method: ProviderQuestion["method"] = "confirm", timeoutMs = 1000): ProviderQuestion => ({ method, title: "Fixture question", message: "Only this run", options: method === "select" ? ["A", "B"] : [], timeoutMs });
async function waiting() {
  for (let i = 0; i < 100; i++) {
    const runs = await api.provider.list(); const request = runs.flatMap(run => run.interactions).find(item => item.status === "pending");
    if (request) return request; await Bun.sleep(5);
  }
  throw new Error("No pending fixture request");
}
for (const method of ["select", "confirm", "input", "editor"] as const) test(`${method}: explicit answer, no body persistence and no Chrona grants`, async () => {
  const f = await fixture(), result = f.channel.events.question(question(method), f.controller.signal), request = await waiting();
  const value = method === "select" ? 1 : method === "confirm" ? false : "PRIVATE_FIXTURE_ANSWER_DO_NOT_STORE";
  expect(await api.provider.answer(request.id, { decision: "submit", value })).toEqual({ ok: true });
  expect(await result).toEqual({ decision: "submit", value });
  expect((await api.provider.list())[0]!.interactions[0]!.status).toBe("answered");
  expect(JSON.stringify(await db.audit.findMany())).not.toContain("PRIVATE_FIXTURE_ANSWER_DO_NOT_STORE");
  expect(await db.grant.count()).toBe(0); expect(await db.approval.count()).toBe(0);
  await expect(api.provider.answer(request.id, { decision: "submit", value })).rejects.toMatchObject({ code: "conflict" });
});
test("editor originals are available only while live and never enter the journal", async () => {
  const f = await fixture(), original = "PRIVATE_PREFILL_DO_NOT_STORE\nSecond line";
  const result = f.channel.events.question({ ...question("editor"), prefill: original }, f.controller.signal), request = await waiting();
  expect(request.question.prefill).toBe(original);
  expect(JSON.stringify(await db.audit.findMany())).not.toContain("PRIVATE_PREFILL_DO_NOT_STORE");
  await api.provider.answer(request.id, { decision: "submit", value: "Replacement text" }); await result;
  expect((await api.provider.list())[0]!.interactions[0]!.question.prefill).toBeUndefined();
  expect(JSON.stringify(await db.audit.findMany())).not.toContain("Replacement text");
});
test("wrong workspace, invalid option and duplicate answer never reach the Provider", async () => {
  const f = await fixture(), result = f.channel.events.question(question("select"), f.controller.signal), request = await waiting();
  const other = (await db.workspace.create({ data: { name: "other" } })).id;
  await expect(service.forWorkspace(other).provider.answer(request.id, { decision: "submit", value: 0 })).rejects.toMatchObject({ code: "not_found" });
  await expect(api.provider.answer(request.id, { decision: "submit", value: 9 })).rejects.toMatchObject({ code: "invalid" });
  const replies = await Promise.allSettled([api.provider.answer(request.id, { decision: "submit", value: 1 }), api.provider.answer(request.id, { decision: "cancel" })]);
  expect(replies.filter(item => item.status === "fulfilled")).toHaveLength(1); expect(await result).toEqual({ decision: "submit", value: 1 });
});
test("expiry rejects late approval and returns cancellation; queued notice is suppressed", async () => {
  const f = await fixture(), result = f.channel.events.question(question("confirm", 80), f.controller.signal), request = await waiting();
  time = new Date(time.getTime() + 100);
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
  expect(await result).toEqual({ decision: "cancel" });
  expect((await api.provider.list())[0]!.interactions[0]!.status).toBe("expired");
  expect((await db.notification.findFirstOrThrow()).status).toBe("suppressed");
});
test("restart/no live process and paused affairs cannot reuse pending requests", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  liveRuns.delete(f.run.id);
  const views = await providerRuns({ db, workspaceId, now: ports.now }, undefined, () => false, () => false);
  expect(views[0]!.interactions[0]!.status).toBe("interrupted");
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
  await api.affairs.update(f.affair.id, { status: "paused" });
  f.controller.abort(); expect(await result).toEqual({ decision: "cancel" });
});
test("owner cancel blocks tools immediately, retains input and never retries the aborted run", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  await db.message.create({ data: { workspaceId, affairId: f.affair.id, channel: "in_app", direction: "in", conversationKey: "chat:in_app", text: "Keep my input", at: time } });
  await api.provider.cancel(f.run.id);
  expect(await result).toEqual({ decision: "cancel" });
  expect((await db.run.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(await db.message.count({ where: { text: "Keep my input" } })).toBe(1);
  await expect(api.runs.authenticate(f.run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
});
test("progress is safe, deduplicated and bounded; request notices use the existing budget", async () => {
  const f = await fixture(); await api.settings.update({ notifications: { dailyCap: 0 } });
  for (let i = 0; i < 350; i++) await f.channel.events.progress({ phase: i % 2 ? "reading" : "writing", tool: null });
  expect(await db.audit.count({ where: { kind: "provider_event" } })).toBe(300);
  const result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  expect((await db.notification.findFirstOrThrow()).status).toBe("folded");
  await api.provider.answer(request.id, { decision: "cancel" }); expect(await result).toEqual({ decision: "cancel" });
});
test("telemetry cannot crowd a live question or the latest usage out of the projection", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  const usage = { scope: "session", input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30, cost: 0, contextTokens: null, contextWindow: null };
  await db.audit.createMany({ data: Array.from({ length: 450 }, (_, index) => ({ id: `provider:${f.run.id}:${String(index).padStart(8, "0")}`, workspaceId, kind: "provider_event", actorKey: "chrona", subjectId: f.run.id, details: { type: "usage", value: { ...usage, total: index + 30 } } })) });
  const projected = (await api.provider.list())[0]!;
  expect(projected.interactions[0]?.id).toBe(request.id); expect(projected.usage?.total).toBe(479);
  await api.provider.answer(request.id, { decision: "cancel" }); expect(await result).toEqual({ decision: "cancel" });
});
test("sensitive request context fails closed before publication", async () => {
  const f = await fixture();
  await expect(f.channel.events.question({ ...question(), message: `password=bad ${f.run.token}` }, f.controller.signal)).rejects.toMatchObject({ code: "invalid" });
  expect(await db.audit.count({ where: { kind: "provider_question" } })).toBe(0);
  expect(await db.notification.count()).toBe(0);
});
test("cancellation during finalization wins over a previously computed failure/retry", async () => {
  const f = await fixture();
  let reached!: () => void, release!: (value: boolean) => void;
  const reachedLookup = new Promise<void>(resolve => { reached = resolve; });
  const blocked = new Promise<boolean>(resolve => { release = resolve; });
  ports.chat = { channel: "chrona_qqbot", bound: async () => { reached(); return blocked; } };
  const finishing = api.runs.finish(f.run.id, { outcome: "failed", sessionId: null, error: "Synthetic failure" });
  await reachedLookup;
  await db.audit.create({ data: { id: providerCancelKey(f.run.id), workspaceId, actorKey: "user", kind: "provider_cancel", subjectId: f.run.id, details: {} } });
  release(false); await finishing;
  expect((await db.run.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
});
test("a pending launch publishes cancellation before it can start work", async () => {
  const gate = providerStartGate(), injection = gate.handle.inject("Persisted input").then(() => false, () => true);
  await gate.handle.abort(); expect(gate.stopped()).toBe(true); expect(await injection).toBe(true);
  expect((await gate.handle.done).outcome).toBe("failed");
});
test("a recorded late cancel stops only linked automatic retries, not unrelated work or schedules", async () => {
  const f = await fixture(); await api.runs.finish(f.run.id, { outcome: "failed", sessionId: null, error: "Synthetic" });
  const retry = await db.run.findFirstOrThrow({ where: { status: "queued" } });
  const unrelated = await api.runs.enqueue({ affairId: f.affair.id, lane: "background", trigger: "schedule", prompt: "Separate work" });
  const schedule = await api.schedules.create(f.affair.id, { mode: "wake", rule: { kind: "every", minutes: 60 }, text: "Future arrangement" });
  await db.audit.create({ data: { id: providerCancelKey(f.run.id), workspaceId, actorKey: "user", kind: "provider_cancel", subjectId: f.run.id, details: {} } });
  await api.provider.cancel(f.run.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: retry.id } })).status).toBe("cancelled");
  expect((await db.run.findUniqueOrThrow({ where: { id: unrelated.id } })).status).toBe("queued");
  expect((await db.schedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("active");
});
test("a failed reply receipt never releases a positive answer", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  await db.$executeRawUnsafe("CREATE TRIGGER fail_provider_receipt BEFORE INSERT ON Audit WHEN NEW.kind = 'provider_answer' BEGIN SELECT RAISE(ABORT, 'Synthetic storage failure'); END");
  try {
    await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toThrow();
    expect(await result).toEqual({ decision: "cancel" });
    expect(await db.audit.count({ where: { kind: "provider_answer" } })).toBe(0);
  } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_provider_receipt"); }
});
test("QQ state failure still permits a budgeted Web question", async () => {
  const f = await fixture(); ports.chat = { channel: "chrona_qqbot", bound: async () => { throw new Error("Synthetic offline"); } };
  const result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  expect((await db.notification.findFirstOrThrow()).channel).toBe("in_app");
  await api.provider.answer(request.id, { decision: "submit", value: false });
  expect(await result).toEqual({ decision: "submit", value: false });
});
test("a durable queued cancel is never claimed after restart", async () => {
  const affair = await api.affairs.create({ title: "Queued" });
  const run = await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "Keep" });
  await db.audit.create({ data: { id: providerCancelKey(run.id), workspaceId, actorKey: "user", kind: "provider_cancel", subjectId: run.id, details: {} } });
  expect(await api.runs.claimNext("background")).toBeNull();
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
});
