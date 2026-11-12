import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConversations } from "./agent-conversations";
import type { ApplicationDelivery, DeliveryPage } from "./delivery";
import { healthFixture, receiptEvent, receiptFixture } from "../../entry-app/delivery-fixture";

type Args = Record<string, unknown>;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-web-conversation-")); directories.push(dataDir);
  const journal = async () => JSON.parse(await readFile(join(dataDir, "conversations/state.json"), "utf8"));
  const calls: { target: string; args: Args }[] = [];
  const runs = new Map<string, { runId: string; contextId: string; status: string; active: boolean }>();
  const delivery = {
    receipt: receiptFixture() as ApplicationDelivery["receipt"],
    health: [healthFixture()],
    pages: [{ module: "music", moduleId: "music-id", hash: "b".repeat(40), id: "home", title: "音乐" }] as DeliveryPage[],
    pageReads: 0,
    unavailable: false,
    receiptRead: undefined as (() => Promise<void>) | undefined,
  };
  let clock = Date.parse("2026-11-09T00:00:05.000Z");
  const stream = { status: "finished", active: false, result: "succeeded", transcript: true, loseAdmission: false, loseWrite: false, includeReceipt: true, extraUnknown: false, gone: false };
  const call = async (target: string, args: Args = {}, options?: { key?: string }): Promise<unknown> => {
    calls.push({ target, args });
    if (target === "web.settings") return { provider: null, autoRecall: false, autoRetain: false };
    if (target === "agent.run") {
      const key = options!.key!;
      if (!runs.has(key)) runs.set(key, { runId: `run-${runs.size + 1}`, contextId: "context-1", status: "running", active: true });
      if (stream.loseAdmission) { stream.loseAdmission = false; throw new Error("response lost"); }
      return runs.get(key);
    }
    if (target === "agent.write") { if (stream.loseWrite) throw new Error("write response lost"); return { accepted: true }; }
    if (target === "agent.read") {
      if (stream.gone) throw Object.assign(new Error("Run not found"), { code: "not_found" });
      const event = receiptEvent(String(args.runId));
      if (stream.result === "unknown") Object.assign(event.payload.value, { status: "unknown", outputState: "omitted", output: null });
      const items = stream.includeReceipt ? [event] : [];
      if (stream.extraUnknown) {
        const unknown = receiptEvent(String(args.runId));
        Object.assign(unknown.payload.value, { callId: "call-2", status: "unknown", outputState: "omitted", output: null });
        items.push(unknown);
      }
      return { run: { runId: args.runId, status: stream.status, active: stream.active }, items, interactions: [], nextCursor: null, ended: !stream.active,
        ...(stream.transcript ? { transcript: [{ at: "2026-11-09T00:00:04.000Z", kind: "text", text: "已核对" }] } : {}) };
    }
    if (target === "modules.receipt") {
      await delivery.receiptRead?.();
      if (delivery.unavailable) throw new Error("denied");
      return delivery.receipt;
    }
    if (target === "modules.health") {
      if (delivery.unavailable) throw new Error("offline");
      return { items: delivery.health, nextCursor: null };
    }
    throw new Error(`Unexpected call: ${target}`);
  };
  const restart = () => createAgentConversations({ dataDir, call, tools: [{ moduleId: "author-id", tool: "submit" }], reply: () => {}, now: () => new Date(clock), deliveryPages: async () => {
    delivery.pageReads++;
    if (delivery.unavailable) throw new Error("offline");
    return delivery.pages;
  } });
  const count = (target: string) => calls.filter(call => call.target === target).length;
  const approve = () => { delivery.receipt = { ...delivery.receipt, state: "approved", approvalId: "approval-1", members: delivery.receipt.members.map(member => ({ ...member, status: "approved" })) }; };
  return { journal, restart, delivery, stream, calls, runs, count, approve, advance: () => { clock += 2000; } };
}

test("snapshot queries bypass a blocked receipt reconciliation while all writes stay serial and durable", async () => {
  const f = await fixture(), app = f.restart();
  const sent = await app.send({ text: "创建应用", requestKey: "original" });
  const entered = gate(), release = gate();
  f.delivery.receiptRead = async () => { entered.resolve(); await release.promise; };
  const polling = app.poll();
  await entered.promise;
  // The exact receipt is already durable even while its current status is unavailable.
  expect((await f.journal()).sessions[0].turns[0].applicationDelivery[0]).toMatchObject({ receipt: receiptFixture(), receiptCheck: "unknown" });
  let updated = false;
  const update = app.update(sent.sessionId, { title: "更新标题" }).then(() => { updated = true; });
  const externalId = app.externalId(`reply:${sent.messageId}`, "external-1");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshots = Promise.all([app.list(), app.runs(), app.session(sent.sessionId), app.owns(sent.sessionId), app.transcript(sent.sessionId), app.attachment(sent.messageId, "missing")]);
    const [listed, runs, session, owns, transcript, attachment] = await Promise.race([snapshots, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("snapshot queries blocked on writer")), 500); })]);
    expect(listed).toHaveLength(1);
    expect(runs).toMatchObject([{ id: sent.runId, active: false }]);
    expect(session.title).toBe("创建应用");
    expect(owns).toBe(true);
    expect(transcript).toHaveLength(1);
    expect(attachment).toBeUndefined();
    expect(updated).toBe(false);
  } finally {
    clearTimeout(timer); release.resolve();
    await Promise.all([polling, update, externalId]);
  }
  const session = (await f.journal()).sessions[0];
  expect(session.title).toBe("更新标题");
  expect(session.messages.at(-1).externalId).toBe("external-1");
  expect(session.turns[0].applicationDelivery[0].receiptCheck).toBe("current");
  expect(session.messages.at(-1).execution.applicationDelivery[0].receipt.receiptId).toBe("receipt-1");
  expect(f.count("agent.run")).toBe(1);
});

test("settled history stops background checks, but every explicit execution/messages read revalidates delivery", async () => {
  const f = await fixture(); f.approve();
  const app = f.restart(), sent = await app.send({ text: "创建应用", requestKey: "original" });
  await app.poll();
  expect((await f.journal()).sessions[0].turns[0].applicationDelivery[0].targets[0]).toMatchObject({ activation: "active", health: "observed", pagesCheck: "current" });
  const before = f.calls.length, pageReads = f.delivery.pageReads;
  f.advance(); f.delivery.health[0]!.activeHash = "e".repeat(40);
  await f.restart().poll();
  await f.restart().poll();
  expect(f.calls.length).toBe(before);
  expect(f.delivery.pageReads).toBe(pageReads);
  const stale = await f.restart().execution(sent.sessionId);
  expect(stale?.applicationDelivery?.[0]?.targets[0]).toMatchObject({ activation: "different", health: "unknown", pages: [], pagesCheck: "unknown" });
  // No clock advance: an explicit read must not use the former 1.5-second shortcut.
  f.delivery.health = [healthFixture()]; f.delivery.pages[0]!.title = "新的入口";
  const messages = await app.messages(sent.sessionId);
  expect(messages.at(-1)?.execution?.applicationDelivery?.[0]?.targets[0]).toMatchObject({ activation: "active", pages: [{ title: "新的入口" }] });
  f.delivery.unavailable = true;
  expect((await app.execution(sent.sessionId))?.applicationDelivery?.[0]).toMatchObject({ receiptCheck: "unknown", targets: [{ activation: "unknown", health: "unknown", pages: [], pagesCheck: "unknown" }] });
  expect(f.count("agent.run")).toBe(1);
  expect(f.calls.every(call => ["web.settings", "agent.run", "agent.read", "modules.health", "modules.receipt"].includes(call.target))).toBe(true);
});

test("unapproved receipts keep progressing after restart and observations are reused only within each poll", async () => {
  const f = await fixture(), app = f.restart();
  await app.send({ text: "第一个会话", requestKey: "first" });
  const second = await app.send({ text: "第二个会话", requestKey: "second" });
  await app.poll();
  expect(f.count("modules.health")).toBe(1);
  expect(f.count("modules.receipt")).toBe(1);
  expect(f.delivery.pageReads).toBe(1);
  f.delivery.receipt.state = "pending_approval"; f.advance();
  await f.restart().poll();
  expect((await f.journal()).sessions.every((session: { turns: { applicationDelivery: ApplicationDelivery[] }[] }) => session.turns[0]!.applicationDelivery[0]!.receipt.state === "pending_approval")).toBe(true);
  expect(f.count("modules.health")).toBe(2);
  expect(f.count("modules.receipt")).toBe(2);
  expect(f.delivery.pageReads).toBe(2);
  f.approve(); f.advance(); await f.restart().poll();
  expect(f.count("modules.receipt")).toBe(3);
  const before = f.calls.length;
  f.advance(); await app.poll(); expect(f.calls.length).toBe(before);
  // Explicit reads allocate fresh observations even with the same timestamp.
  f.delivery.health[0]!.configuredStatus = "disabled";
  expect((await app.execution(second.sessionId))?.applicationDelivery?.[0]?.targets[0]?.activation).toBe("inactive");
  expect(f.count("modules.health")).toBe(4);
  expect(f.count("modules.receipt")).toBe(4);
  expect(f.delivery.pageReads).toBe(4);
  expect(f.count("agent.run")).toBe(2);
});

test("explicit reads refresh older delivery messages after a newer turn without repeating shared inventory reads", async () => {
  const f = await fixture(); f.approve();
  const app = f.restart(), first = await app.send({ text: "创建应用", requestKey: "first" });
  await app.poll(); f.advance();
  await app.send({ session: first.sessionId, text: "后续核对", requestKey: "second" });
  await app.poll();
  const before = f.count("modules.health"), pagesBefore = f.delivery.pageReads;
  f.delivery.health[0]!.activeHash = "e".repeat(40);
  const messages = await f.restart().messages(first.sessionId);
  const deliveries = messages.filter(message => message.direction === "out").map(message => message.execution?.applicationDelivery?.[0]);
  expect(deliveries).toHaveLength(2);
  for (const delivery of deliveries) expect(delivery?.targets[0]).toMatchObject({ activation: "different", pages: [], pagesCheck: "unknown" });
  expect(f.count("modules.health") - before).toBe(1);
  expect(f.delivery.pageReads - pagesBefore).toBe(1);
  expect(f.count("agent.run")).toBe(2);
});

test("terminal unknown tool results remain polled until a late receipt is collected, without replay", async () => {
  const f = await fixture(); f.approve(); f.stream.status = "timed_out"; f.stream.result = "unknown";
  const sent = await f.restart().send({ text: "创建应用", requestKey: "original" });
  await f.restart().poll();
  expect((await f.journal()).sessions[0].turns[0]).toMatchObject({ pendingToolResults: ["call-1"], status: "timed_out", active: false });
  expect(f.count("modules.receipt")).toBe(0);
  f.stream.result = "succeeded";
  await f.restart().poll();
  expect((await f.journal()).sessions[0].turns[0]).toMatchObject({ pendingToolResults: [], applicationDelivery: [{ receipt: { state: "approved" } }] });
  expect((await f.restart().execution(sent.sessionId))?.status).toBe("timed_out");
  expect(f.count("agent.run")).toBe(1);
  expect(f.count("agent.write")).toBe(0);
});

test("late-result polling does not repeatedly reconcile a separate settled delivery", async () => {
  const f = await fixture(); f.approve(); f.stream.status = "timed_out"; f.stream.extraUnknown = true;
  const app = f.restart(), sent = await app.send({ text: "创建应用", requestKey: "original" });
  await app.poll();
  expect((await f.journal()).sessions[0].turns[0]).toMatchObject({ pendingToolResults: ["call-2"], applicationDelivery: [{ receipt: { state: "approved" } }] });
  f.stream.includeReceipt = false; f.advance();
  await f.restart().poll(); await f.restart().poll();
  expect(f.count("agent.read")).toBe(3);
  expect(f.count("modules.health")).toBe(1);
  expect(f.count("modules.receipt")).toBe(1);
  expect(f.delivery.pageReads).toBe(1);
  await app.execution(sent.sessionId);
  expect(f.count("modules.receipt")).toBe(2);
  expect(f.count("agent.run")).toBe(1);
});

test("finished streams with an uncollected reply keep polling after receipt approval", async () => {
  const f = await fixture(); f.approve(); f.stream.transcript = false;
  const app = f.restart(), sent = await app.send({ text: "创建应用", requestKey: "original" });
  await app.poll();
  expect((await f.journal()).sessions[0].messages).toHaveLength(1);
  expect((await f.journal()).sessions[0].turns[0].streamPending).toBe(true);
  f.stream.transcript = true;
  await f.restart().poll();
  expect((await f.journal()).sessions[0].messages.at(-1)).toMatchObject({ id: `reply:${sent.messageId}`, text: "已核对" });
  expect(f.count("agent.run")).toBe(1);
});

test("snapshot reads and background polls never replay unknown admission or supplemental delivery", async () => {
  const f = await fixture(); f.stream.loseAdmission = true;
  const app = f.restart();
  await expect(app.send({ text: "原请求", requestKey: "original" })).rejects.toThrow("response lost");
  const session = (await app.list())[0]!;
  await app.poll(); await app.runs(); await app.session(session.id); await app.owns(session.id); await app.transcript(session.id);
  expect(f.count("agent.run")).toBe(1);
  expect(f.count("agent.read")).toBe(0);
  const admitted = await app.reconcile(session.id, { requestKey: "original" });
  expect(admitted.runId).toBe("run-1");
  expect(f.runs.size).toBe(1);
  f.stream.status = "running"; f.stream.active = true; f.stream.loseWrite = true;
  const supplemental = { session: session.id, text: "补充", requestKey: "supplemental" };
  await expect(app.send(supplemental)).rejects.toThrow("write response lost");
  await app.poll();
  await expect(f.restart().send(supplemental)).rejects.toMatchObject({ code: "unknown" });
  expect(f.count("agent.write")).toBe(1);
  expect(f.count("agent.run")).toBe(2);
});

test("a Run that no longer exists ends its turn instead of being polled forever", async () => {
  const f = await fixture(), app = f.restart();
  Object.assign(f.stream, { status: "running", active: true });
  await app.send({ text: "你好", requestKey: "gone" });
  f.stream.gone = true;
  await app.poll();
  const reads = f.count("agent.read");
  await app.poll(); await app.poll();
  expect(f.count("agent.read")).toBe(reads);
  const turn = (await f.journal()).sessions[0].turns[0];
  expect(turn).toMatchObject({ status: "failed", active: false });
  expect(turn.reason).toContain("不存在");
});
