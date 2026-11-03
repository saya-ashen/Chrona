import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { createSchedules } from "./schedules";
import { callSync, kernelOrigin } from "./module-calls";
import { handleModuleCall } from "./module-effects";
import { testDb } from "./test-db";
import { builtinEntry, qqEntry } from "./test-entry";
import { notices } from "./test-notices";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { migrateConversationFiles } from "./chat";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Behavior = { reply: string } | { tool: string; args: unknown } | "hang";

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
      if ("tool" in behavior) await service.tools.call(input.token, behavior.tool, behavior.args);
      else await service.tools.call(input.token, "chrona_reply", { text: behavior.reply });
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
  const approval = await f.api.approvals.create({ action: "schedule", title: "日程", detail: "审查", preview: "diff", payload: {} });
  expect(await f.qq.call("approvals.list", {})).toMatchObject([{ id: approval.id, status: "open" }]);
  expect(await f.qq.call("approvals.resolve", { approval: approval.id, decision: "approve" })).toMatchObject({ id: approval.id, status: "approved" });
  const policy = await f.api.approvals.create({ action: "change_policy", title: "设置", detail: "审查", preview: "diff", payload: {} });
  expect(await f.qq.call("approvals.resolve", { approval: policy.id, decision: "approve" })).toMatchObject({ status: "approved" });
  const external = await f.api.approvals.create({ action: "send_external_message", title: "发送", detail: "确认发送", preview: "正文", payload: {} });
  expect((await f.api.approvals.resolve(external.id, { decision: "approve", scope: "once" }, "mcp")).approval.status).toBe("approved");
  // Chrona resumes directly without an approval.
  const app = await f.db.module.create({ data: { workspaceId: f.w, name: "prices", activeHash: "p1", status: "paused" } });
  await f.db.moduleVersion.create({ data: { moduleId: app.id, hash: "p1", manifest: { name: "prices", entry: "index.ts", tests: ["test.ts"] }, source: "build", intent: {}, report: {}, status: "approved" } });
  expect(await f.api.modules.lifecycle("enable", app.id, { reason: "修好了" }, false)).toMatchObject({ status: "active" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("active");
  // Listing approvals is module-visible without uses; kernel origins are not in its audience.
  const manifest = moduleManifestSchema.parse({ name: "other", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [] });
  const other = await f.db.module.create({ data: { workspaceId: f.w, name: "other", activeHash: "o" } });
  const reply = await handleModuleCall(f.ports, { workspaceId: f.w, moduleId: other.id, hash: "o", manifest }, { id: "1", method: "call", params: { target: "approvals.list", args: {}, mode: "sync", reply: false } });
  expect(reply).toMatchObject({ result: { output: [] } });
  await expect(callSync(f.ports, kernelOrigin(f.w), "chat.send", { key: "qq:dm", text: "x", channel: "chrona_qqbot" })).rejects.toMatchObject({ code: "forbidden" });
  // Declaring them makes a module an entry module (never activated automatically); system names are reserved.
  expect(moduleManifestSchema.parse({ ...manifest, uses: ["chat.send"] })).toMatchObject({ uses: ["chat.send"] });
  expect(moduleManifestSchema.safeParse({ ...manifest, name: "chat" }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...manifest, secrets: ["qq_bot"] }).success).toBe(false);
});

test("provider.wake starts the Provider for a module; an approved version still naming ai.wake (v2-10) reaches it too", async () => {
  const f = await fixture();
  for (const [name, target] of [["fresh", "provider.wake"], ["older", "ai.wake"]] as const) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses: [target] });
    const module = await f.db.module.create({ data: { workspaceId: f.w, name, activeHash: name } });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: name, manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    const reply = await handleModuleCall(f.ports, { workspaceId: f.w, moduleId: module.id, hash: name, manifest }, { id: "1", method: "call", params: { target, args: { prompt: `${name} 发现变化` }, mode: "async", key: `${name}:1`, reply: false } });
    expect(reply).toMatchObject({ result: { status: "queued" } });
  }
  f.behaviors.push({ reply: "看过了" }, { reply: "也看过了" });
  await f.settle();
  expect((await f.db.moduleInvocation.findMany({ where: { target: { in: ["provider", "ai"] } } })).map(row => [row.target, row.tool, row.status])).toEqual([["provider", "wake", "succeeded"], ["provider", "wake", "succeeded"]]);
  expect(f.started.map(input => input.prompt).filter(prompt => prompt.includes("发现变化")).length).toBe(2);
});

test("chat.file and chat.delivered only reach replies in the caller's own conversations", async () => {
  const f = await fixture();
  const web = await f.db.session.create({ data: { workspaceId: f.w, key: "web:y", source: "web" } });
  const foreign = await f.db.message.create({ data: { workspaceId: f.w, sessionId: web.id, direction: "out", channel: "in_app", text: "web reply", attachments: [{ name: "a.png", ref: "files/a.png", mime: "image/png", size: 1 }] } });
  await expect(f.qq.call("chat.file", { message: foreign.id, ref: "files/a.png" })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.qq.call("chat.delivered", { message: foreign.id, "external-id": "qq:out:x" })).rejects.toMatchObject({ code: "not_found" });
});

test("the web page is an entry like qq: its conversations push replies to web.reply, and it cannot speak in qq's", async () => {
  const f = await fixture();
  const manifest = moduleManifestSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "builtin/web/module.json"), "utf8")));
  const web = await f.db.module.create({ data: { workspaceId: f.w, name: "web", activeHash: "web-test", builtin: true } });
  await f.db.moduleVersion.create({ data: { moduleId: web.id, hash: "web-test", manifest, source: "builtin", intent: {}, report: {}, status: "approved" } });
  const call = (target: string, args: Record<string, unknown>) => handleModuleCall(f.ports, { workspaceId: f.w, moduleId: web.id, hash: "web-test", manifest }, { id: "w", method: "call", params: { target, args: args as never, mode: "sync", reply: false } });
  f.behaviors.push({ reply: "QQ 回答" }, { reply: "网页回答" });
  await send(f, "QQ 提问", "qq:in:1");
  await f.settle();
  expect(await call("chat.send", { key: "qq:dm", text: "插话", channel: "in_app" })).toMatchObject({ error: { code: "forbidden" } });
  expect(await call("chat.send", { key: "web:w1", text: "网页提问", channel: "in_app" })).toHaveProperty("result");
  await f.settle();
  const pushed = await f.db.moduleInvocation.findMany({ where: { workspaceId: f.w, tool: "reply" }, orderBy: { createdAt: "asc" } });
  expect(pushed.map(row => [row.target, (row.args as { text: string }).text])).toEqual([["qq", "QQ 回答"], ["web", "网页回答"]]);
});

test("v2-8 migration copies content-area attachments into chat's store and gives web conversations the web entry, once", async () => {
  const f = await fixture();
  const files = await f.db.module.create({ data: { workspaceId: f.w, name: "files", builtin: true } });
  const web = await f.db.module.create({ data: { workspaceId: f.w, name: "web", builtin: true } });
  await mkdir(join(f.ports.dataDir, "platform/content", files.id, "uploads"), { recursive: true });
  await writeFile(join(f.ports.dataDir, "platform/content", files.id, "uploads/a.png"), "png");
  const session = await f.db.session.create({ data: { workspaceId: f.w, key: "web:old", source: "web" } });
  const message = await f.db.message.create({ data: { workspaceId: f.w, sessionId: session.id, direction: "in", channel: "in_app", text: "old", attachments: [
    { name: "a.png", ref: "files/uploads/a.png", mime: "image/png", size: 3 }, { name: "gone.txt", ref: "files/gone.txt", mime: "text/plain", size: 1 }] } });
  expect(await migrateConversationFiles(f.ports, f.w)).toBe(2);
  const [moved, gone] = (await f.db.message.findUniqueOrThrow({ where: { id: message.id } })).attachments as { ref: string | null }[];
  expect(moved!.ref).toMatch(/^chat\/[0-9a-f-]{36}-a\.png$/);
  expect(await readFile(join(f.ports.dataDir, "platform/data", moved!.ref!), "utf8")).toBe("png");
  expect(gone!.ref).toBeNull();
  expect(await f.db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ entryModuleId: web.id });
  expect(await migrateConversationFiles(f.ports, f.w)).toBe(0);
});

test("an approval decision continues the conversation that asked, in a new run; a closed conversation is not reopened", async () => {
  const f = await fixture();
  const ask = (title: string) => ({ tool: "chrona_request_approval", args: { action: "schedule", title, detail: "d", preview: "p" } });
  f.behaviors.push(ask("每天提醒"), { reply: "已设置" }, ask("删除提醒"), { reply: "好的，不删" });
  const { sessionId } = await send(f, "每天九点提醒我", "m1") as { sessionId: string };
  await f.settle();
  const [first] = await f.api.approvals.list("open");
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: first!.id } })).payload).toMatchObject({ sessionId, lane: "foreground" });
  await f.qq.call("approvals.resolve", { approval: first!.id, decision: "approve" });
  await f.settle();
  expect(await f.db.run.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" }, select: { trigger: true, status: true } })).toEqual([{ trigger: "message", status: "finished" }, { trigger: "approval", status: "finished" }]);
  expect(f.started[1]!.prompt).toContain(`approved approval ${first!.id}`);
  // The Provider runs on this host: its files are mounted, not reached over SSH.
  expect(f.started[0]!.prompt).toContain(`this host is ${JSON.stringify(hostname())}`);
  await send(f, "把提醒删了", "m2"); await f.settle();
  const [second] = await f.api.approvals.list("open");
  await f.api.approvals.resolve(second!.id, { decision: "deny" }, "rescue");
  await f.settle();
  expect(f.started[3]!.prompt).toContain("Do not retry it");
  // The fixture clock stands still, so the two pushes may arrive in either order.
  expect((await f.qq.pushed()).map(item => item.text).sort()).toEqual(["好的，不删", "已设置"].sort());
  // Approving after the conversation closed records the decision without a run.
  const third = await f.api.approvals.create({ action: "schedule", title: "x", detail: "d", preview: "p", payload: { sessionId, lane: "foreground" } });
  await f.db.session.update({ where: { id: sessionId }, data: { status: "ended" } });
  expect((await f.api.approvals.resolve(third.id, { decision: "approve" }, "rescue")).approval).toMatchObject({ status: "approved" });
  expect(await f.db.run.count({ where: { sessionId } })).toBe(4);
});

test("settings, grants, preferences and schedules are system interfaces for entry modules (v2-9)", async () => {
  const f = await fixture();
  const web = await builtinEntry(f.ports, f.w, "web");
  const before = await web.call("settings.get", {}) as { notifications: { dailyCap: number } };
  await web.call("settings.update", { settings: JSON.stringify({ notifications: { dailyCap: before.notifications.dailyCap + 1 } }) });
  expect(await web.call("settings.get", {})).toMatchObject({ notifications: { dailyCap: before.notifications.dailyCap + 1 } });
  await expect(web.call("settings.update", { settings: "{" })).rejects.toMatchObject({ code: "invalid" });
  const grant = await f.api.grants.create({ action: "schedule", mode: "auto", scope: { kind: "global" } });
  expect(await web.call("settings.grants", {})).toMatchObject([{ id: grant.id }]);
  await web.call("settings.revoke-grant", { grant: grant.id });
  expect((await f.db.grant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).not.toBeNull();
  const preference = await f.api.preferences.add({ text: "简短回答" });
  expect(await web.call("settings.preferences", {})).toMatchObject([{ id: preference.id }]);
  await web.call("settings.forget", { preference: preference.id });
  expect(await f.db.preference.count()).toBe(0);
  const origin = await f.db.session.create({ data: { workspaceId: f.w, key: "web:s", source: "web" } });
  const schedule = await createSchedules(f.ports, f.w).create(origin.id, { mode: "wake", rule: { kind: "daily", time: "09:00" }, text: "check", label: "Check" });
  expect(await web.call("schedules.list", {})).toMatchObject([{ id: schedule.id, status: "active" }]);
  expect(await web.call("schedules.update", { schedule: schedule.id, status: "paused" })).toMatchObject({ status: "paused" });
  // QQ is an entry module; omitted uses entries no longer block module-visible calls.
  expect(await f.qq.call("settings.update", { settings: "{}" })).toBeDefined();
});

test("the earliest web replies (attachments with path, no ref) still read: name kept, no file", async () => {
  const f = await fixture();
  const web = await builtinEntry(f.ports, f.w, "web");
  const session = await f.db.session.create({ data: { workspaceId: f.w, key: "chat:in_app", source: "web" } });
  await f.db.message.create({ data: { workspaceId: f.w, sessionId: session.id, direction: "out", channel: "in_app", text: "old", attachments: [{ name: "README.md", path: "README.md", mime: "text/markdown", size: 857 }] } });
  expect(await web.call("chat.messages", { session: session.id })).toMatchObject([{ text: "old", attachments: [{ name: "README.md", ref: null, mime: "text/markdown", size: 857 }] }]);
});
