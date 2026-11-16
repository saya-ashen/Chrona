import { readFile } from "./journal-test-storage";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentReadOutput, runtimeTranscriptSchema } from "@chrona/contracts/steward";
import { createPages } from "../external/web/pages";
import { createAgentConversations } from "./conversations";
import { captureApplicationDelivery, deliveryReceiptSchema, readDeliveryPages, reconcileApplicationDelivery, type ApplicationDelivery } from "./delivery";
import { healthFixture, receiptFixture, receiptItem, receiptEvent } from "./delivery-fixture";

type Args = Record<string, unknown>;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "chrona-delivery-integration-")); directories.push(path); return path;
}
// Explicit offline read envelopes exercise the consumer's structured receipt boundary.
function agentRead(items: () => unknown[], events: () => unknown[] = () => []) {
  return async (runId = "run-1") => agentReadOutput.parse({ run: { runId, contextId: "context-1", status: "finished", active: false }, items: events(), nextCursor: events().length ? `opaque:${events().length}` : null, ended: true, interactions: [], transcript: runtimeTranscriptSchema.parse(items()) });
}

for (const size of [2000, 2001]) test(`consumer Agent read receipt envelope at ${size} characters`, async () => {
  const receipt = receiptFixture();
  receipt.members = Array.from({ length: 4 }, (_, i) => ({ ...receipt.members[0]!, name: `music-${i}${"x".repeat(50)}`, moduleId: `music-${i}`, versionId: "v".repeat(128) }));
  const base = JSON.stringify({ result: receipt }).length;
  receipt.requestKey = "r".repeat(size - base + receipt.requestKey.length);
  deliveryReceiptSchema.parse(receipt);
  const item = { ...receiptItem(), text: JSON.stringify({ result: receipt }) };
  expect(item.text).toHaveLength(size);
  const event = receiptEvent(); event.payload.value.output = receipt;
  const stream = await agentRead(() => [item], () => [event])();
  const turn = { runId: "run-1", at: "2026-11-09T00:00:02.000Z", baseline: [], runRequest: { tools: [{ moduleId: "author-id", tool: "submit" }] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, stream.items);
  expect(turn.applicationDelivery[0]?.receipt).toEqual(receipt);
  expect(stream.transcript?.[0]).toMatchObject({ kind: "result", text: item.text });
});

async function conversationFixture() {
  const dataDir = await directory(), calls: { target: string; args: Args }[] = [], replies: Args[] = [];
  const runs = new Map<string, { contextId: string; runId: string; status: string; active: boolean }>();
  const state = { items: [] as unknown[], events: [] as ReturnType<typeof receiptEvent>[], streamUnavailable: false, loseRunResponse: false, health: [] as ReturnType<typeof healthFixture>[], pages: [] as { module: string; moduleId: string; hash: string; id: string; title: string }[] };
  const stream = agentRead(() => state.items, () => state.events);
  let clock = Date.parse("2026-11-09T00:00:02.000Z");
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push({ target, args });
    if (target === "web.settings") return { provider: null, autoRecall: false, autoRetain: false };
    if (target === "agent.run") {
      const run = { contextId: "context-1", runId: `run-${runs.size + 1}`, status: "running", active: true }; runs.set(run.runId, run);
      if (state.loseRunResponse) throw new Error("response lost");
      return run;
    }
    if (target === "agent.read") {
      const page = await stream(String(args.runId));
      return { ...page, run: runs.get(String(args.runId)), ...(state.streamUnavailable ? { transcript: undefined } : {}) };
    }
    if (target === "modules.health") return { items: state.health, nextCursor: null };
    if (target === "modules.receipt") {
      expect(args).toEqual({ receiptId: "receipt-1" }); return receiptFixture();
    }
    throw new Error(`Unexpected delivery call ${target}`);
  };
  const restart = () => createAgentConversations({ dataDir, call, tools: [{ moduleId: "author-id", tool: "submit" }], now: () => new Date(clock), reply: event => { replies.push(event); }, deliveryPages: async () => state.pages });
  const journal = async () => JSON.parse(await readFile(join(dataDir, "conversations/sessions.sqlite"), "utf8"));
  return { restart, journal, calls, replies, runs, state, advance: () => { clock += 2000; } };
}

for (const pendingAdmission of [false, true]) test(`old timeout delivery reconciles while a newer ${pendingAdmission ? "admission is uncertain" : "Run is active"}`, async () => {
  const f = await conversationFixture();
  const first = await f.restart().send({ text: "创建应用", requestKey: "first" });
  Object.assign(f.runs.get(first.runId!)!, { status: "timed_out", active: false });
  f.state.items = [receiptItem()];
  f.state.events = [receiptEvent()];
  await f.restart().poll();
  const saved = (await f.restart().messages(first.sessionId)).find(message => message.execution?.runId === first.runId)!;
  expect(saved.execution).toMatchObject({ status: "timed_out", applicationDelivery: [{ targets: [{ activation: "unknown" }] }] });
  f.advance();
  f.state.loseRunResponse = pendingAdmission;
  const next = f.restart().send({ session: first.sessionId, text: "查看另一事项", requestKey: "second" });
  if (pendingAdmission) await expect(next).rejects.toThrow("response lost"); else await next;
  f.state.health = [healthFixture()];
  f.state.pages = [{ module: "music", moduleId: "music-id", hash: "b".repeat(40), id: "home", title: "音乐" }];
  const before = f.calls.length;
  const execution = await f.restart().execution(first.sessionId);
  expect(execution).toMatchObject({ status: pendingAdmission ? "pending" : "running", active: true });
  const messages = await f.restart().messages(first.sessionId);
  const corrected = messages.find(message => message.id === saved.id)!;
  expect(corrected.execution).toMatchObject({ runId: first.runId, status: "timed_out", active: false, canContinue: true, applicationDelivery: [{ receipt: receiptFixture(), targets: [{ activation: "active", health: "observed", pages: [{ href: "/p/music/home" }] }], browser: "unknown" }] });
  expect(f.calls.slice(before).every(call => ["agent.read", "modules.health", "modules.receipt"].includes(call.target))).toBe(true);
  expect(f.calls.filter(call => call.target === "agent.run")).toHaveLength(2);
  expect((await f.journal()).sessions[0].turns[0].applicationDelivery[0].receipt).toEqual(receiptFixture());
  expect(f.replies.some(event => event.message === saved.id && JSON.stringify(event.execution).includes('"activation":"active"'))).toBe(true);
});

test("a delayed terminal transcript cannot capture a later Run's receipt or prose", async () => {
  const f = await conversationFixture();
  const first = await f.restart().send({ text: "先检查", requestKey: "first" });
  Object.assign(f.runs.get(first.runId!)!, { status: "timed_out", active: false });
  f.state.streamUnavailable = true;
  await f.restart().poll();
  f.advance();
  const second = await f.restart().send({ session: first.sessionId, text: "另建应用", requestKey: "second" });
  f.state.streamUnavailable = false;
  expect(second.runId).toBe("run-2");
  f.state.items = [{ ...receiptItem(), at: "2026-11-09T00:00:04.000Z" }, { kind: "text", text: "第二轮回复", at: "2026-11-09T00:00:05.000Z" }];
  f.state.events = [receiptEvent(second.runId!)];
  // Persisted result ownership comes from Run identity, independently of transcript times.
  await f.restart().poll();
  const journal = await f.journal(), turns = journal.sessions[0].turns;
  expect(turns[0].applicationDelivery).toBeUndefined();
  expect(turns[0].transcript).toEqual([]);
  expect(turns[1].applicationDelivery[0].receipt).toEqual(receiptFixture());
  expect(f.calls.some(call => call.target === "modules.health" || call.target === "modules.receipt")).toBe(false);
});

test("Web private list/get reader proves only the full current page identity", async () => {
  const dataDir = await directory(), hash = "b".repeat(40);
  const inventory = [{ id: "music-id", name: "music", status: "active", activeHash: hash }];
  const pages = createPages({ dataDir, modules: async () => inventory, tools: async () => new Map() });
  const owner = { kind: "module", module: "music", moduleId: "music-id", hash };
  const page = { id: "home", title: "音乐", javascript: "export default function mount(element) { element.textContent = 'Music'; return () => element.replaceChildren(); }" };
  await pages.tool("page-set", page, owner);
  expect((await pages.list())[0]).not.toHaveProperty("hash");
  expect(await readDeliveryPages(pages)).toEqual([{ module: "music", moduleId: "music-id", hash, id: "home", title: "音乐" }]);
  const turn = { runId: "run-1", at: "2026-11-09T00:00:02.000Z", baseline: [], runRequest: { tools: [{ moduleId: "author-id", tool: "submit" }] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptEvent()]);
  const call = async (target: string) => target === "modules.health" ? { items: [healthFixture()], nextCursor: null } : receiptFixture();
  await reconcileApplicationDelivery(call, turn.applicationDelivery, "2026-11-09T00:00:05.000Z", () => readDeliveryPages(pages));
  expect(turn.applicationDelivery[0]!.targets[0]!.pages).toEqual([{ id: "home", title: "音乐", href: "/p/music/home" }]);
  inventory[0]!.activeHash = "d".repeat(40);
  expect(await readDeliveryPages(pages)).toEqual([]);
  await reconcileApplicationDelivery(call, turn.applicationDelivery, "2026-11-09T00:00:07.000Z", () => readDeliveryPages(pages));
  expect(turn.applicationDelivery[0]!.targets[0]).toMatchObject({ pages: [], pagesCheck: "unknown" });
});

test("executable pages retain the real registering version and reject callers without a version", async () => {
  const hash = "b".repeat(40), dataDir = await directory();
  const inventory = [{ id: "music-id", name: "music", status: "active", activeHash: hash }];
  const dependencies = { dataDir, modules: async () => inventory, tools: async () => new Map() };
  const pages = createPages(dependencies), caller = { kind: "module", module: "music", moduleId: "music-id", hash };
  const page = { id: "home", title: "Music", javascript: "export default function mount() { return () => {}; }" };
  await expect(pages.tool("page-set", page, { ...caller, hash: "c".repeat(40) })).rejects.toMatchObject({ code: "conflict" });
  await pages.tool("page-set", page, caller);
  const evidence = [{ module: "music", moduleId: "music-id", hash, id: "home", title: "Music" }];
  expect(await readDeliveryPages(createPages(dependencies))).toEqual(evidence);
  inventory[0]!.activeHash = "d".repeat(40);
  const turn = { runId: "run-1", runRequest: { tools: [{ moduleId: "author-id", tool: "submit" }] }, baseline: [], at: "2026-11-09T00:00:00.000Z", applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptEvent()]);
  await reconcileApplicationDelivery(async (name: string) => name === "modules.health" ? { items: [{ ...healthFixture(), activeHash: inventory[0]!.activeHash }], nextCursor: null } : receiptFixture(), turn.applicationDelivery, "2026-11-09T00:00:07.000Z", () => readDeliveryPages(pages));
  expect(turn.applicationDelivery[0]!.targets[0]).toMatchObject({ activation: "different", pages: [], pagesCheck: "unknown" });
  const { hash: _hash, ...legacyCaller } = caller;
  await expect(pages.tool("page-set", page, legacyCaller)).rejects.toMatchObject({ code: "forbidden" });
  expect(await readDeliveryPages(pages)).toEqual([]);
});

test("private page reader excludes legacy, replaced, missing and unreadable records", async () => {
  const item = { module: "music", moduleId: "music-id", id: "home", title: "Music" };
  for (const page of [null, item, { ...item, hash: "b".repeat(40), moduleId: "replacement" }, { ...item, hash: "b".repeat(40), module: "other" }, { ...item, hash: "b".repeat(40), id: "other" }]) {
    expect(await readDeliveryPages({ list: async () => [item], get: async () => page })).toEqual([]);
  }
  expect(await readDeliveryPages({ list: async () => [item], get: async () => { throw new Error("stale"); } })).toEqual([]);
});

test("release generator ships matching conversation and delivery helpers to all three entries", async () => {
  const root = await directory();
  await Promise.all(["web", "mcp", "qq", "memory-local", "mind", "events", "notify", "author", "remote-execution"].map(app => mkdir(join(root, "external", app), { recursive: true })));
  const generator = resolve(import.meta.dir, "../../../../../../build/entry-conversations.ts");
  const child = Bun.spawn([process.execPath, generator, root], { stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(stderr).toBe(""); expect(exit).toBe(0);
  const client = `// Generated by build/entry-conversations.ts from entry-app/kernel-client.ts.\n${await readFile(join(import.meta.dir, "kernel-client.ts"), "utf8")}`;
  for (const app of ["web", "mcp", "qq", "events", "notify", "author", "remote-execution"]) expect(await readFile(join(root, "external", app, "kernel-client.ts"), "utf8")).toBe(client);
  expect(await Bun.file(join(root, "external/mind/kernel-client.ts")).exists()).toBe(false);

  for (const [file, source] of [["agent-conversations.ts", "conversations.ts"], ["delivery.ts", "delivery.ts"]]) {
    const expected = `// Generated by build/entry-conversations.ts from entry-app/${source}.\n${await readFile(join(import.meta.dir, source!), "utf8")}`;
    for (const app of ["web", "mcp", "qq"]) {
      expect(await readFile(join(root, "external", app, file!), "utf8")).toBe(expected);
      expect(await readFile(join(import.meta.dir, "../external", app, file!), "utf8")).toBe(expected);
    }
  }
});
