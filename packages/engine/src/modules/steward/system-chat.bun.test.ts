import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { createSchedules } from "./schedules";
import { callSync, kernelOrigin } from "./module-calls";
import { handleModuleCall } from "./module-effects";
import { testDb } from "./test-db";
import { qqEntry } from "./test-entry";
import { notices } from "./test-notices";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Behavior = { reply: string } | "hang";

/** A real service with a scripted Provider: each run takes the next behavior (reply through chrona_reply, or never finish). */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-system-chat-"));
  const workspace = await db.workspace.create({ data: { name: "chat" } }), w = workspace.id;
  let time = Date.parse("2026-10-24T05:00:00Z");
  const behaviors: Behavior[] = [], started: ProviderRunInput[] = [], hanging = new Set<string>();
  const ports: StewardPorts = { db, dataDir, now: () => new Date(time), publicUrl: "https://chrona.example", provider: { name: "scripted", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
    started.push(input);
    const behavior = behaviors.shift() ?? "hang";
    if (behavior === "hang") hanging.add(input.runId);
    let abort!: () => void;
    const aborted = new Promise<void>(resolve => { abort = resolve; });
    const done = (async () => {
      if (behavior === "hang") { await aborted; return { outcome: "timed_out" as const, sessionId: null, error: "aborted" }; }
      await service.tools.call(input.token, "chrona_reply", { text: behavior.reply });
      return { outcome: "finished" as const, sessionId: null, error: null };
    })();
    return { inject: async () => {}, abort: async () => { abort(); }, done };
  } } };
  const service = createStewardService(ports), api = service.forWorkspace(w);
  const qq = await qqEntry(ports, w);
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function settle() {
    for (let i = 0; i < 200; i++) {
      await service.tick(); await service.tick.settled();
      // Settled: nothing due is queued, and whatever still runs is a run scripted to hang.
      const busy = await db.run.findMany({ where: { workspaceId: w, OR: [{ status: "running" }, { status: "queued", OR: [{ leaseUntil: null }, { leaseUntil: { lte: ports.now() } }] }] } });
      if (busy.every(run => run.status === "running" && hanging.has(run.id))) return;
      await Bun.sleep(5);
    }
  }
  return { db, ports, w, api, service, qq, behaviors, started, settle, advance: (ms: number) => { time += ms; } };
}
const send = (f: Awaited<ReturnType<typeof fixture>>, text: string, id: string) => f.qq.call("chat.send", { key: "qq:dm", text, channel: "chrona_qqbot", "external-id": id });

test("an entry module talks to chat by routed calls; the reply is pushed to its reply tool, recorded as from system chat", async () => {
  const f = await fixture();
  f.behaviors.push({ reply: "你好" });
  expect(await send(f, "嗨", "m1")).toMatchObject({ sessionId: expect.any(String), messageId: expect.any(String), runId: expect.any(String) });
  await f.settle();
  const [reply] = await f.qq.pushed();
  expect(reply).toMatchObject({ caller: "system:chat", text: "你好", inReplyTo: "m1", workspace: f.w });
  expect(await f.db.session.findFirstOrThrow({ where: { key: "qq:dm" } })).toMatchObject({ entryModuleId: f.qq.module.id });
  await f.qq.call("chat.delivered", { message: reply!.messageId, "external-id": "qq:out:1" });
  expect(await f.db.message.findUniqueOrThrow({ where: { id: reply!.messageId } })).toMatchObject({ externalId: "qq:out:1" });
});

test("an answer written by the continuation of a timed-out run still reaches the entry, as a reply to the original message", async () => {
  const f = await fixture();
  f.behaviors.push("hang", { reply: "现在是抓取后由代码整理" });
  await send(f, "榜单是直接获取还是经过模型处理？", "m-question");
  await f.settle();
  // The first run runs out of time (as on 2026-10-24); Chrona schedules a continuation a minute later.
  f.advance(6 * 60_000); await f.api.runs.expireLeases();
  expect(await f.db.run.count({ where: { status: "timed_out" } })).toBe(1);
  f.advance(2 * 60_000); await f.settle();
  expect(f.started).toHaveLength(2);
  expect(await f.qq.pushed()).toMatchObject([{ text: "现在是抓取后由代码整理", inReplyTo: "m-question", caller: "system:chat" }]);
});

test("a wake result goes into the original QQ conversation without a separate notice; a web conversation still gets the notice", async () => {
  const f = await fixture();
  f.behaviors.push({ reply: "好的" });
  const { sessionId } = await send(f, "一小时后提醒我检查", "m1") as { sessionId: string };
  await f.settle();
  const web = await f.db.session.create({ data: { workspaceId: f.w, key: "web:x", source: "web" } });
  // One wake at a time: the scripted Provider answers runs in start order.
  for (const [origin, answer] of [[sessionId, "检查完了：一切正常"], [web.id, "网页那边也正常"]] as const) {
    f.advance(1000);
    await createSchedules(f.ports, f.w).create(origin, { mode: "wake", rule: { kind: "at", at: f.ports.now().toISOString() }, text: "检查结果", label: "检查" });
    f.behaviors.push({ reply: answer });
    expect(await f.api.schedules.fireDue()).toBe(1);
    await f.settle();
  }
  const pushed = await f.qq.pushed();
  expect(pushed.map(item => [item.text, item.inReplyTo, item.sessionId])).toEqual([["好的", "m1", sessionId], ["检查完了：一切正常", null, sessionId]]);
  const results = (await notices(f.db)).filter(notice => notice.idempotencyKey.startsWith("session-result:"));
  expect(results.map(notice => [notice.body, notice.sessionId])).toEqual([["网页那边也正常", web.id]]);
});

test("approvals through the approvals system module; other modules and Chrona itself cannot speak for the user", async () => {
  const f = await fixture();
  const approval = await f.api.approvals.create({ action: "change_policy", title: "设置", detail: "审查", preview: "diff", payload: {} });
  expect(await f.qq.call("approvals.list", {})).toMatchObject([{ id: approval.id, status: "open" }]);
  expect(await f.qq.call("approvals.resolve", { approval: approval.id, decision: "approve" })).toMatchObject({ id: approval.id, status: "approved" });
  // A module without these in `uses` is refused; so is a kernel-origin call (entry modules only).
  const manifest = moduleManifestSchema.parse({ name: "other", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [] });
  const other = await f.db.module.create({ data: { workspaceId: f.w, name: "other", activeHash: "o" } });
  const reply = await handleModuleCall(f.ports, { workspaceId: f.w, moduleId: other.id, hash: "o", manifest }, { id: "1", method: "call", params: { target: "approvals.list", args: {}, mode: "sync", reply: false } });
  expect(reply).toMatchObject({ error: { code: "undeclared" } });
  await expect(callSync(f.ports, kernelOrigin(f.w), "chat.send", { key: "qq:dm", text: "x", channel: "chrona_qqbot" })).rejects.toMatchObject({ code: "forbidden" });
  // Declaring them makes a module an entry module (never activated automatically); system names are reserved.
  expect(moduleManifestSchema.parse({ ...manifest, uses: ["chat.send"] })).toMatchObject({ uses: ["chat.send"] });
  expect(moduleManifestSchema.safeParse({ ...manifest, name: "chat" }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...manifest, secrets: ["qq_bot"] }).success).toBe(false);
});

test("chat.file and chat.delivered only reach replies in the caller's own conversations", async () => {
  const f = await fixture();
  const web = await f.db.session.create({ data: { workspaceId: f.w, key: "web:y", source: "web" } });
  const foreign = await f.db.message.create({ data: { workspaceId: f.w, sessionId: web.id, direction: "out", channel: "in_app", text: "web reply", attachments: [{ name: "a.png", ref: "files/a.png", mime: "image/png", size: 1 }] } });
  await expect(f.qq.call("chat.file", { message: foreign.id, ref: "files/a.png" })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.qq.call("chat.delivered", { message: foreign.id, "external-id": "qq:out:x" })).rejects.toMatchObject({ code: "not_found" });
});
