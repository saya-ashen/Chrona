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
import type { ProviderQuestion, ProviderInteraction } from "@chrona/contracts/steward";
import { notice, notices } from "./test-notices";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, time: Date;
let service: ReturnType<typeof createStewardService>, api: ReturnType<typeof service.forWorkspace>;
const channels: ReturnType<typeof createProviderChannel>[] = [];
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-17T04:00:00Z"); workspaceId = (await db.workspace.create({ data: { name: "provider" } })).id;
  ports = { db, now: () => time, dataDir: await mkdtemp(join(tmpdir(), "chrona-provider-channel-")), publicUrl: null };
  service = createStewardService(ports); api = service.forWorkspace(workspaceId);
});
afterEach(async () => { await Promise.all(channels.splice(0).map(channel => channel.close())); liveRuns.clear(); await db.$disconnect(); });
async function fixture(observer?: (request: ProviderInteraction) => Promise<void>) {
  const session = await db.session.create({ data: { workspaceId, key: "web:test", source: "web" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Work" });
  const run = (await api.runs.claimNext("foreground"))!, controller = new AbortController(), channel = createProviderChannel(ports, run, observer); channels.push(channel);
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => { controller.abort(); await channel.close(); await api.runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Abort" }); } });
  return { session, run, channel, controller };
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
test("interaction observer uses persisted public identity and retains answer authority after detail failure", async () => {
  const observed: ProviderInteraction[] = [];
  const f = await fixture(async request => { observed.push(structuredClone(request)); throw new Error("Detail full"); });
  const result = f.channel.events.question({ ...question("editor"), prefill: "PRIVATE_ORIGINAL" }, f.controller.signal);
  const request = await waiting();
  await api.provider.answer(request.id, { decision: "submit", value: "PRIVATE_ANSWER" });
  expect(await result).toEqual({ decision: "submit", value: "PRIVATE_ANSWER" });
  expect(observed.map(value => [value.id, value.status])).toEqual([[request.id, "pending"], [request.id, "answered"]]);
  expect(JSON.stringify(observed)).not.toContain("PRIVATE_");
  await expect(f.channel.close()).rejects.toThrow("Detail full");
  channels.splice(channels.indexOf(f.channel), 1);
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
  // The notify module drops the queued notice: Chrona withdraws it by key.
  expect(await db.moduleInvocation.count({ where: { target: "notify", tool: "withdraw", key: `withdraw:provider-input:${f.run.id}` } })).toBe(1);
});
test("restart/no live process cannot reuse pending requests", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  liveRuns.delete(f.run.id);
  const views = await providerRuns({ db, workspaceId, now: ports.now }, undefined, () => false, () => false);
  expect(views[0]!.interactions[0]!.status).toBe("interrupted");
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
  f.controller.abort(); expect(await result).toEqual({ decision: "cancel" });
});
test("owner cancel blocks tools immediately, retains input and never retries the aborted run", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  await db.message.create({ data: { workspaceId, sessionId: f.session.id, channel: "in_app", direction: "in", text: "Keep my input", at: time } });
  await api.provider.cancel(f.run.id);
  expect(await result).toEqual({ decision: "cancel" });
  expect((await db.run.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(await db.message.count({ where: { text: "Keep my input" } })).toBe(1);
  await expect(api.runs.authenticate(f.run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
});
test("progress is safe, deduplicated and bounded; request notices go through notify.send", async () => {
  const f = await fixture(); await api.settings.update({ notifications: { dailyCap: 0 } });
  for (let i = 0; i < 350; i++) await f.channel.events.progress({ phase: i % 2 ? "reading" : "writing", tool: null });
  expect(await db.audit.count({ where: { kind: "provider_event" } })).toBe(300);
  const result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  // The budget (folded under dailyCap 0) is the notify module's; Chrona queues a normal, non-responding notice.
  expect(await notice(db)).toMatchObject({ level: "now", idempotencyKey: `provider-input:${f.run.id}` });
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
  expect((await notices(db)).length).toBe(0);
});
test("a pending launch publishes cancellation before it can start work", async () => {
  const gate = providerStartGate(), injection = gate.handle.inject("Persisted input").then(() => false, () => true);
  await gate.handle.abort(); expect(gate.stopped()).toBe(true); expect(await injection).toBe(true);
  expect((await gate.handle.done).outcome).toBe("failed");
});
test("a recorded late cancel stops only linked automatic retries, not unrelated work or schedules", async () => {
  const f = await fixture(); await api.runs.finish(f.run.id, { outcome: "failed", sessionId: null, error: "Synthetic" });
  const retry = await db.run.findFirstOrThrow({ where: { status: "queued" } });
  const unrelated = await api.runs.enqueue({ sessionId: f.session.id, lane: "background", trigger: "schedule", prompt: "Separate work" });
  const schedule = await api.schedules.create(f.session.id, { mode: "wake", rule: { kind: "every", minutes: 60 }, text: "Future arrangement" });
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
test("a durable queued cancel is never claimed after restart", async () => {
  const session = await db.session.create({ data: { workspaceId, key: "web:queued", source: "web" } });
  const run = await api.runs.enqueue({ sessionId: session.id, lane: "background", trigger: "schedule", prompt: "Keep" });
  await db.audit.create({ data: { id: providerCancelKey(run.id), workspaceId, actorKey: "user", kind: "provider_cancel", subjectId: run.id, details: {} } });
  expect(await api.runs.claimNext("background")).toBeNull();
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
});
