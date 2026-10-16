import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { liveRuns } from "./runs";
import { testDb } from "./test-db";

let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string;
let service: ReturnType<typeof createStewardService>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
const success: Outcome = { outcome: "finished", sessionId: null, error: null };
function provider() {
  const started = deferred<ProviderRunInput>(), injected = deferred<{ text: string; images: unknown }>(), done = deferred<Outcome>();
  let starts = 0;
  ports.provider = { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
    starts++; started.resolve(input);
    return { done: done.promise, abort: async () => {}, inject: async (text, images) => { injected.resolve({ text, images }); } };
  } };
  return { started: started.promise, injected: injected.promise, finish: done.resolve, starts: () => starts };
}
const send = (text: string, extra: Partial<Parameters<typeof service.chat.handleMessage>[0]> = {}) => service.chat.handleMessage({ workspaceId, channel: "in_app", text, ...extra });
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "chat" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-chat-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null, chat: null, deliveries: [] };
  service = createStewardService(ports);
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });

for (const fails of [false, true]) test(`affair chat forwards to background work without failing chat: ${fails}`, async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  const background = await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "Prepare" });
  await api.runs.claimNext("background");
  const forwarded: { text: string; images: unknown }[] = [];
  liveRuns.set(background.id, { done: new Promise(() => {}), abort: async () => {}, inject: async (text, images) => { forwarded.push({ text, images }); if (fails) throw new Error("fake failure"); } });
  const p = provider(), pending = send("New detail", { affairId: affair.id, attachments: [{ name: "x.png", path: null, mime: "image/png", size: 3, base64: "YWJj" }] });
  const run = await p.started;
  expect(forwarded).toEqual([{ text: "The user just wrote in chat (data; a separate conversation run replies to them; take it into account in your work): New detail", images: [{ mime: "image/png", base64: "YWJj" }] }]);
  expect(await db.audit.count({ where: { kind: fails ? "message_forward_failed" : "message_forwarded", subjectId: background.id } })).toBe(1);
  await service.tools.call(run.token, "chrona_reply", { text: "Noted" });
  p.finish(success);
  expect((await pending).messages.map(m => m.text)).toEqual(["Noted"]);
  expect(await db.run.count({ where: { lane: "background" } })).toBe(1);
});

test("simple tools reply and persisted externalId dedupe (including new service)", async () => {
  const p = provider(), pending = send("hello", { externalId: "one" });
  const run = await p.started;
  expect(run.cwd).toBe(join(ports.dataDir, "affairs"));
  await service.tools.call(run.token, "chrona_reply", { text: "Hello", files: [] });
  p.finish(success);
  const reply = await pending;
  expect(reply.messages.map(m => m.text)).toEqual(["Hello"]);
  await db.message.create({ data: { workspaceId, conversationKey: "chat:in_app", direction: "out", channel: "in_app", text: "unrelated later", at: ports.now() } });
  service = createStewardService(ports);
  expect(await send("hello", { externalId: "one" })).toEqual(reply);
  expect(p.starts()).toBe(1);
  expect(await db.message.count({ where: { direction: "in" } })).toBe(1);
  expect((await service.forWorkspace(workspaceId).chat.messages(2)).length).toBe(2);
});

test("live run receives second text and inline image; both callers receive later reply", async () => {
  const p = provider(), first = send("first"), run = await p.started;
  await service.tools.call(run.token, "chrona_reply", { text: "early", files: [] });
  const second = send("second", { attachments: [{ name: "x.png", path: null, mime: "image/png", size: 3, base64: "YWJj" }] });
  expect(await p.injected).toEqual({ text: "second", images: [{ mime: "image/png", base64: "YWJj" }] });
  await service.tools.call(run.token, "chrona_reply", { text: "later", files: [] });
  p.finish(success);
  expect((await first).messages.map(m => m.text)).toEqual(expect.arrayContaining(["early", "later"]));
  expect((await second).messages.map(m => m.text)).toEqual(["later"]);
  expect(p.starts()).toBe(1);
});

test("quoted outbound affair overrides last chrona_focus and passes affair cwd", async () => {
  const affairs = service.forWorkspace(workspaceId).affairs;
  const a = await affairs.create({ title: "A" }), b = await affairs.create({ title: "B" });
  let p = provider(); const first = send("focus"), initial = await p.started;
  await service.tools.call(initial.token, "chrona_focus", { affairId: a.id });
  p.finish(success); await first;
  p = provider(); const focused = send("follow up"), focusedRun = await p.started;
  expect(focusedRun.cwd).toBe(join(ports.dataDir, "affairs", (await db.affair.findUniqueOrThrow({ where: { id: a.id } })).dirName));
  p.finish(success); await focused;
  const quote = await db.message.create({ data: { workspaceId, channel: "in_app", conversationKey: "chat:in_app", direction: "out", affairId: b.id, text: "B news", at: ports.now() } });
  p = provider(); const quoted = send("about B", { quotedMessageId: quote.id }), quotedRun = await p.started;
  expect(quotedRun.cwd).toBe(join(ports.dataDir, "affairs", (await db.affair.findUniqueOrThrow({ where: { id: b.id } })).dirName));
  p.finish(success); await quoted;
});

for (const outcome of ["unconfigured", "unavailable", "failed"] as const) test(`${outcome}: honest reply and queued retry`, async () => {
  const p = outcome === "unconfigured" ? null : provider();
  const pending = send("remember me");
  if (p) { await p.started; p.finish({ outcome: outcome === "failed" ? "failed" : "unavailable", sessionId: null, error: "offline" }); }
  const reply = await pending;
  expect(reply.messages.map(m => m.text)).toEqual(["模型暂时不可用，消息已记下，恢复后会继续处理。"]);
  expect(await db.run.count({ where: { status: "queued", trigger: "message", conversationKey: "chat:in_app", prompt: "remember me" } })).toBe(1);
});

test("provider deadline resolves waiting caller with honest message and queues background only", async () => {
  const affair = await service.forWorkspace(workspaceId).affairs.create({ title: "Study" });
  const delivered: string[] = [];
  ports.deliveries = [{ channel: "in_app", send: async input => { delivered.push(input.body); return { outcome: "accepted", receiptRef: null }; } }];
  const p = provider(), pending = send("prepare materials", { affairId: affair.id });
  const run = await p.started;
  ports.now = () => run.deadline;
  p.finish({ outcome: "timed_out", sessionId: null, error: "Pi deadline exceeded" });
  expect((await pending).messages.map(m => m.text)).toEqual(["这次处理超时了，我会在后台继续。"]);
  expect(delivered).toEqual(["这次处理超时了，我会在后台继续。"]);
  expect(await db.run.count({ where: { status: "queued", lane: "foreground" } })).toBe(0);
  expect(await db.run.count({ where: { status: "queued", lane: "background", affairId: affair.id, prompt: "prepare materials" } })).toBe(1);
});

test("timeout returns existing replies; late replies still use delivery", async () => {
  ports.chatTimeoutMs = 80;
  const delivered: string[] = [];
  ports.deliveries = [{ channel: "in_app", send: async m => { delivered.push(m.body); return { outcome: "accepted", receiptRef: null }; } }];
  const p = provider(), pending = send("slow"), run = await p.started;
  await service.tools.call(run.token, "chrona_reply", { text: "working", files: [] });
  expect((await pending).messages.map(m => m.text)).toEqual(["working"]);
  await service.tools.call(run.token, "chrona_reply", { text: "late", files: [] });
  const finished = deferred<void>(); ports.onRunFinished = async () => { finished.resolve(); };
  p.finish(success); await finished.promise;
  expect(delivered).toEqual(["working", "late"]);
});

test("first reply returns after three-second grace while run remains active; later replies deliver", async () => {
  const delivered: string[] = [];
  ports.deliveries = [{ channel: "in_app", send: async m => { delivered.push(m.body); return { outcome: "accepted", receiptRef: null }; } }];
  const p = provider(), pending = send("long work"), run = await p.started;
  const start = Date.now();
  await service.tools.call(run.token, "chrona_reply", { text: "working" });
  expect((await pending).messages.map(m => m.text)).toEqual(["working"]);
  expect(Date.now() - start).toBeGreaterThanOrEqual(3000);
  expect(Date.now() - start).toBeLessThan(4500);
  expect((await db.run.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe("running");
  await service.tools.call(run.token, "chrona_reply", { text: "done" });
  expect(delivered).toEqual(["working", "done"]);
  const finished = deferred<void>(); ports.onRunFinished = async () => { finished.resolve(); };
  p.finish(success); await finished.promise;
});

test("concurrent externalId duplicates share one inbound and one run", async () => {
  const p = provider();
  const first = send("once", { externalId: "concurrent" });
  const second = send("once", { externalId: "concurrent" });
  const run = await p.started;
  await service.tools.call(run.token, "chrona_reply", { text: "once", files: [] });
  p.finish(success);
  expect(await second).toEqual(await first);
  expect(await db.message.count({ where: { direction: "in" } })).toBe(1);
  expect(p.starts()).toBe(1);
});

test("empty timeout returns without cancelling queued work or waiting for a stuck wake hook", async () => {
  ports.chatTimeoutMs = 20;
  ports.onQueued = () => new Promise(() => {});
  const reply = await send("queued");
  expect(reply.messages).toEqual([]);
  expect((await db.run.findUniqueOrThrow({ where: { id: reply.runId! } })).status).toBe("queued");
});

test("initial image forwarded; invalid/oversized images rejected before storing", async () => {
  const attachment = { name: "x.png", path: null, mime: "image/png", size: 3, base64: "YWJj" };
  await expect(send("bad", { attachments: Array(5).fill(attachment) })).rejects.toMatchObject({ code: "invalid" });
  await expect(send("bad", { attachments: [{ ...attachment, base64: "?" }] })).rejects.toMatchObject({ code: "invalid" });
  await expect(send("bad", { attachments: [{ ...attachment, base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }] })).rejects.toThrow();
  expect(await db.message.count()).toBe(0);
  const p = provider(), pending = send("image", { attachments: [attachment] }), run = await p.started;
  expect(run.images).toEqual([{ mime: "image/png", base64: "YWJj" }]);
  expect(run.prompt).not.toContain("YWJj");
  p.finish(success); await pending;
  expect((await service.chat.messages(workspaceId))[0].attachments[0]).toEqual({ name: "x.png", path: null, mime: "image/png", size: 3 });
});
