import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviderChannel } from "./provider-channel";
import { providerRuns } from "./provider-journal";
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
  expect(await db.approval.count()).toBe(0);
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
test.each([null, 1] as const)("question wait stays bounded with run timeout %s", async minutes => {
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { runTimeoutMinutes: minutes } } });
  const f = await fixture(), result = f.channel.events.question(question("confirm", 120_000), f.controller.signal), request = await waiting();
  expect(Date.parse(request.expiresAt) - time.getTime()).toBe(minutes === null ? 120_000 : 60_000);
  f.controller.abort();
  expect(await result).toEqual({ decision: "cancel" });
});
test("expiry rejects late approval and returns cancellation; queued notice is suppressed", async () => {
  const f = await fixture(), result = f.channel.events.question(question("confirm", 80), f.controller.signal), request = await waiting();
  time = new Date(time.getTime() + 100);
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
  expect(await result).toEqual({ decision: "cancel" });
  expect((await api.provider.list())[0]!.interactions[0]!.status).toBe("expired");
  // A durable withdrawal exists even if no notification application is running.
  expect((await db.kernelFact.findMany({ where: { consumedAt: null } })).map(row => row.payload)).toContainEqual({ type: "withdraw", data: { key: `provider-input:${f.run.id}` } });
  expect(await db.moduleInvocation.count({ where: { target: "notify", tool: "withdraw" } })).toBe(0);
});
test("restart/no live process cannot reuse pending requests", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  liveRuns.delete(f.run.id);
  const views = await providerRuns({ db, workspaceId, now: ports.now }, {}, () => false, () => false);
  expect(views[0]!.interactions[0]!.status).toBe("interrupted");
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
  f.controller.abort(); expect(await result).toEqual({ decision: "cancel" });
});
test("owner cancel blocks tools immediately, retains input and never retries the aborted run", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  await api.provider.cancel(f.run.id);
  expect(await result).toEqual({ decision: "cancel" });
  expect((await db.run.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  await expect(api.runs.authenticate(f.run.token)).rejects.toMatchObject({ code: "forbidden" });
  await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict" });
});
test("progress is safe, deduplicated and bounded; requests publish durable notification facts", async () => {
  const f = await fixture();
  for (let i = 0; i < 350; i++) await f.channel.events.progress({ phase: i % 2 ? "reading" : "writing", tool: null });
  expect(await db.runEvent.count()).toBe(300);
  const result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  // Notification budgets belong to notify; the kernel publishes a normal request fact.
  expect(await notice(db)).toMatchObject({ level: "now", idempotencyKey: `provider-input:${f.run.id}` });
  await api.provider.answer(request.id, { decision: "cancel" }); expect(await result).toEqual({ decision: "cancel" });
});
test("telemetry cannot crowd a live question or the latest usage out of the projection", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  const usage = { scope: "session", input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30, cost: 0, contextTokens: null, contextWindow: null };
  await db.runEvent.createMany({ data: Array.from({ length: 450 }, (_, index) => ({ runId: f.run.id, sequence: index + 1, kind: "usage", payload: { type: "usage", value: { ...usage, total: index + 30 } } })) });
  await db.runEvent.createMany({ data: Array.from({ length: 401 }, (_, index) => ({ runId: f.run.id, sequence: index + 451, kind: "progress", payload: { type: "progress", value: { phase: "reading", tool: null } } })) });
  const projected = (await api.provider.list())[0]!;
  expect(projected.interactions[0]?.id).toBe(request.id); expect(projected.usage?.total).toBe(479);
  await api.provider.answer(request.id, { decision: "cancel" }); expect(await result).toEqual({ decision: "cancel" });
});
test("sensitive request context fails closed before publication", async () => {
  const f = await fixture();
  await expect(f.channel.events.question({ ...question(), message: `password=bad ${f.run.token}` }, f.controller.signal)).rejects.toMatchObject({ code: "invalid" });
  expect(await db.runInteraction.count()).toBe(0);
  expect((await notices(db)).length).toBe(0);
});
test("a pending launch publishes cancellation before it can start work", async () => {
  const gate = providerStartGate(), injection = gate.handle.inject("Persisted input").then(() => false, () => true);
  await gate.handle.abort(); expect(gate.stopped()).toBe(true); expect(await injection).toBe(true);
  expect((await gate.handle.done).outcome).toBe("failed");
});
test("a failed run creates no kernel retry and late cancellation leaves app timers and unrelated work alone", async () => {
  const f = await fixture(); await api.runs.finish(f.run.id, { outcome: "failed", sessionId: null, error: "Synthetic" });
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  const unrelated = await api.runs.enqueue({ sessionId: f.session.id, lane: "background", trigger: "schedule", prompt: "Separate work" });
  const module = await db.module.create({ data: { workspaceId, name: "timer-owner" } });
  // Private legacy row: cancellation must not mutate unrelated stored state.
  const schedule = await db.timer.create({ data: { workspaceId, moduleId: module.id, timerId: "legacy inert fixture", rule: { kind: "every", minutes: 60 }, payload: {}, nextAt: new Date("2030-01-01Z") } });
  await db.run.update({ where: { id: f.run.id }, data: { cancelRequestedAt: new Date() } });
  await api.provider.cancel(f.run.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: unrelated.id } })).status).toBe("queued");
  expect((await db.timer.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("active");
});
test("a failed reply receipt never releases a positive answer", async () => {
  const f = await fixture(), result = f.channel.events.question(question(), f.controller.signal), request = await waiting();
  await db.$executeRawUnsafe("CREATE TRIGGER fail_provider_receipt BEFORE UPDATE OF status ON RunInteraction WHEN NEW.status != 'pending' BEGIN SELECT RAISE(ABORT, 'Synthetic storage failure'); END");
  try {
    await expect(api.provider.answer(request.id, { decision: "submit", value: true })).rejects.toThrow();
    expect(await result).toEqual({ decision: "cancel" });
    expect(await db.runInteraction.count({ where: { status: { not: "pending" } } })).toBe(0);
  } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_provider_receipt"); }
});
test("a durable queued cancel is never claimed after restart", async () => {
  const session = await db.session.create({ data: { workspaceId, key: "web:queued", source: "web" } });
  const run = await api.runs.enqueue({ sessionId: session.id, lane: "background", trigger: "schedule", prompt: "Keep" });
  await db.run.update({ where: { id: run.id }, data: { cancelRequestedAt: new Date() } });
  expect(await api.runs.claimNext("background")).toBeNull();
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
});

test("invalid questions never consume the accepted question budget", async () => {
  const f = await fixture();
  for (let i = 0; i < 20; i++) {
    await expect(f.channel.events.question({ ...question(), method: "invalid" } as unknown as ProviderQuestion, f.controller.signal)).rejects.toMatchObject({ code: "invalid" });
  }
  for (let i = 0; i < 12; i++) {
    const answer = f.channel.events.question(question("confirm", 60_000), f.controller.signal), request = await waiting();
    await api.provider.answer(request.id, { decision: "cancel" });
    expect(await answer).toEqual({ decision: "cancel" });
  }
  await expect(f.channel.events.question(question(), f.controller.signal)).rejects.toMatchObject({
    code: "conflict", message: "Provider interaction budget exhausted (12 accepted questions)",
  });
});
