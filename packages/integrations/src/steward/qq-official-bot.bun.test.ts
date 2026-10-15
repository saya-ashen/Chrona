import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, qqBotConfig, routeQqText, type QqBinding, type QqChatPort } from "./qq-official-bot";
import { createQqTokenSource } from "./qq-official";

const APP = "1905797537";
let dir: string, at: Date;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "qq-bot-")); at = new Date("2026-10-15T08:00:00Z"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness() {
  const state = createQqBotState(join(dir, "state"), APP);
  const replies: { openid: string; messageId: string; text: string }[] = [], calls: { kind: string; input: any }[] = [], bound: [QqBinding, string | null][] = [];
  const port: QqChatPort = {
    async request(input) { calls.push({ kind: "request", input }); return { status: "received", ref: "K7QM" }; },
    async respond(input) { calls.push({ kind: "respond", input }); return { status: "applied", state: "paused", subject: { title: "服务" } }; },
    async pending(input) { calls.push({ kind: "pending", input }); return { works: [{ ref: "K7QM", status: "running", request: "答辩" }] }; },
  };
  const handler = createQqBotHandler({ state, now: () => at, chat: () => port, reply: async (openid, messageId, text) => { replies.push({ openid, messageId, text }); }, onBound: async (b, r) => { bound.push([b, r]); } });
  let n = 0;
  const say = (openid: string, content: string, id = `M${++n}`, quoted = "") => handler.onMessage({ id, openid, content, quoted, timestamp: "" });
  return { state, replies, calls, bound, say };
}

test("config needs a numeric AppID and a state location; the secret is only a path", () => {
  expect(qqBotConfig({ CHRONA_QQ_APP_ID: APP, CHRONA_DATA_DIR: "/data", CHRONA_QQ_SECRET_FILE: "/s" })).toEqual({ appId: APP, stateDir: `/data/qq-bot/${APP}`, secretFile: "/s" });
  expect(qqBotConfig({ CHRONA_QQ_APP_ID: "abc", CHRONA_DATA_DIR: "/data" })).toBeNull();
  expect(qqBotConfig({ CHRONA_QQ_APP_ID: APP })).toBeNull();
});

test("before binding: only help/binding text, nothing reaches Chrona, strangers are not spammed", async () => {
  const h = harness();
  await h.say("U1", "帮我看看最近的事务");
  await h.say("U1", "进度");
  await h.say("U1", "帮助");
  expect(h.calls).toEqual([]);
  expect(h.replies.map(r => r.text)).toEqual([expect.stringContaining("尚未绑定"), expect.stringContaining("尚未绑定")]);
  expect(h.replies.every(r => r.openid === "U1" && /^M\d$/.test(r.messageId))).toBe(true);
  await h.say("U1", "绑定 ABCDEFGH");
  expect(h.replies.at(-1)!.text).toContain("没有待使用的绑定码");
});

test("one-time code: hashed at rest, wrong codes burn attempts, success binds once, a second person cannot take over", async () => {
  const h = harness();
  const { code } = await h.state.createChallenge({ workspaceId: "ws", now: at });
  const stored = readFileSync(join(dir, "state", "challenge.json"), "utf8");
  expect(stored).not.toContain(code);
  expect(statSync(join(dir, "state")).mode & 0o777).toBe(0o700);
  expect(statSync(join(dir, "state", "challenge.json")).mode & 0o777).toBe(0o600);
  await h.say("EVIL", "绑定 ZZZZZZZZ");
  expect(h.replies.at(-1)!.text).toContain("不正确");
  await h.say("U1", `/chrona 绑定 ${code.toLowerCase()}`);
  expect(h.replies.at(-1)!.text).toContain("绑定成功");
  expect(h.bound).toEqual([[{ version: 1, appId: APP, openid: "U1", workspaceId: "ws", boundAt: at.toISOString(), replacedOpenid: null }, null]]);
  expect(readdirSync(join(dir, "state"))).not.toContain("challenge.json");
  await h.say("EVIL", `绑定 ${code}`); // replay of a used code
  expect(h.replies.at(-1)!.text).toContain("没有待使用的绑定码");
  await h.say("EVIL", "进度");
  expect(h.replies.at(-1)!.text).toContain("没有使用权限");
  expect(h.calls).toEqual([]);
  // Even a fresh non-replace challenge cannot be minted or redeemed over an existing owner.
  await expect(h.state.createChallenge({ workspaceId: "ws" })).rejects.toThrow("Already bound");
});

test("challenge expiry and attempt exhaustion", async () => {
  const h = harness();
  await h.state.createChallenge({ workspaceId: "ws", ttlMinutes: 1, now: at });
  at = new Date(at.getTime() + 61_000);
  await h.say("U1", "绑定 ABCDEFGH");
  expect(h.replies.at(-1)!.text).toContain("过期");
  const { code } = await h.state.createChallenge({ workspaceId: "ws", now: at });
  for (let i = 0; i < 5; i++) await h.say("U1", "绑定 ZZZZZZZZ");
  await h.say("U1", `绑定 ${code}`);
  expect(h.replies.at(-1)!.text).toContain("没有待使用的绑定码");
  expect(h.bound).toEqual([]);
});

test("replace challenge rebinds and reports the previous owner", async () => {
  const h = harness();
  await h.say("U1", `绑定 ${(await h.state.createChallenge({ workspaceId: "ws", now: at })).code}`);
  await h.say("U2", `绑定 ${(await h.state.createChallenge({ workspaceId: "ws", replace: true, now: at })).code}`);
  expect(h.bound.map(([b, r]) => [b.openid, r])).toEqual([["U1", null], ["U2", "U1"]]);
  expect(await h.state.binding()).toMatchObject({ openid: "U2", replacedOpenid: "U1" }); // survives a crash before the move finishes
  await expect(h.state.createChallenge({ workspaceId: "other", replace: true, now: at })).rejects.toThrow("bound workspace");
});

test("owner messages go to Chrona with the dedicated identity; duplicates and restarts never repeat a write", async () => {
  const h = harness();
  await h.say("U1", `绑定 ${(await h.state.createChallenge({ workspaceId: "ws", now: at })).code}`);
  await h.say("U1", "帮我准备周五答辩", "IN1");
  await h.say("U1", "帮我准备周五答辩", "IN1"); // gateway replay
  expect(h.calls).toEqual([{ kind: "request", input: { chat: { platform: "chrona_qq", chatType: "dm", userId: "U1", chatId: "U1", messageId: "IN1", userText: "帮我准备周五答辩", route: "dedicated_bot" }, text: "帮我准备周五答辩" } }]);
  expect(h.replies.at(-1)).toMatchObject({ messageId: "IN1", text: expect.stringContaining("已收到，码 K7QM") });
  const restarted = harness(); // same state directory, fresh process
  await restarted.say("U1", "帮我准备周五答辩", "IN1");
  expect(restarted.calls).toEqual([]);
  await restarted.say("U1", "暂停", "IN2", "【Chrona】服务变化\n回复：K7QM 收到｜暂后｜完成｜暂停");
  expect(restarted.calls[0]).toMatchObject({ kind: "respond", input: { ref: "K7QM", action: "pause", chat: { userText: "K7QM 暂停" } } });
  await restarted.say("U1", "进度", "IN3");
  expect(restarted.replies.at(-1)!.text).toContain("工作 K7QM｜处理中｜答辩");
  await restarted.say("U1", "帮助", "IN4");
  expect(restarted.replies.at(-1)!.text).toContain("不经过 Hermes");
});

test("routing: optional /chrona prefix, refs never guessed, everything else is a request", () => {
  expect(routeQqText("/chrona K7QM 暂后 4小时").route).toEqual({ kind: "respond", ref: "K7QM", action: "snooze", snoozeHours: 4 });
  expect(routeQqText("暂停 K7QM").route).toEqual({ kind: "respond", ref: "K7QM", action: "pause" });
  expect(routeQqText("K7QM 反馈 只告诉我关键服务").route).toEqual({ kind: "respond", ref: "K7QM", action: "feedback", note: "只告诉我关键服务" });
  expect(routeQqText("暂停").route).toEqual({ kind: "need_ref", action: "pause" });
  expect(routeQqText("暂停", "【Chrona】a\n回复：K7QM 收到\n回复：ABCD 收到").route).toEqual({ kind: "need_ref", action: "pause" });
  expect(routeQqText("暂停", "别人的消息 回复：K7QM").route).toEqual({ kind: "need_ref", action: "pause" });
  expect(routeQqText("K7QM ABCD 暂停").route).toMatchObject({ kind: "clarify", reason: "multiple_refs" });
  expect(routeQqText("K7QM 暂后 999小时").route).toMatchObject({ kind: "clarify", reason: "invalid_snooze" });
  expect(routeQqText("K7QM").route).toMatchObject({ kind: "clarify", reason: "missing_action" });
  // Quoting a notification never turns a sentence into an action on it.
  expect(routeQqText("取消 明天的会议", "【Chrona】x\n回复：K7QM 收到").route).toMatchObject({ kind: "clarify", reason: "extra_text", ref: "K7QM" });
  expect(routeQqText("取消", "【Chrona】x\n回复：K7QM 收到").route).toEqual({ kind: "respond", ref: "K7QM", action: "revoke" });
  expect(routeQqText("K7QM 暂停 一下").route).toMatchObject({ kind: "clarify", reason: "extra_text" });
  expect(routeQqText("取消 明天的会议").route).toEqual({ kind: "need_ref", action: "revoke" });
  expect(routeQqText("今晚吃什么好").route).toEqual({ kind: "request", text: "今晚吃什么好" });
  expect(routeQqText("  ").route).toEqual({ kind: "help" });
});

test("delivery: only the bound recipient, local per-recipient limit, receipt in the bot namespace", async () => {
  const sent: any[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    if (url.includes("getAppAccessToken")) return new Response(JSON.stringify({ access_token: "t", expires_in: 7200 }));
    sent.push({ url, body: JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify({ id: `R${sent.length}` }));
  };
  const tokens = createQqTokenSource({ appId: APP, readSecret: async () => "s", fetch });
  const allowed = new Set(["chrona_qq:U1"]);
  const delivery = createChronaQqDelivery({ tokens, fetch, publicUrl: "https://chrona.example", allowedRecipients: () => allowed, perMinute: 2, now: () => 0 });
  const message = { idempotencyKey: "k", title: "服务恢复", body: "Chino 服务恢复", link: null, recipient: "chrona_qq:U1", replyRef: "K7QM", whyItMatters: "", nextStep: "", appPath: "/today" };
  expect(await delivery.send(message)).toEqual({ outcome: "accepted", receiptRef: "chrona_qq:R1" });
  expect(sent[0].url).toEndWith("/v2/users/U1/messages");
  expect(sent[0].body.msg_id).toBeUndefined();
  expect(sent[0].body.content).toContain("回复：K7QM 收到｜暂后｜完成｜暂停");
  expect(sent[0].body.content).not.toMatch(/\/chrona\s/);
  expect(sent[0].body.content).toContain("详情：https://chrona.example/zh/today");
  expect(await delivery.send({ ...message, recipient: "qqbot:U1" })).toMatchObject({ outcome: "rejected", retryable: false });
  expect(await delivery.send({ ...message, recipient: "chrona_qq:U2" })).toMatchObject({ outcome: "rejected", retryable: false });
  await delivery.send(message);
  expect(await delivery.send(message)).toMatchObject({ outcome: "rejected", retryable: true, error: "Local QQ rate limit" });
  expect(sent).toHaveLength(2);
});

test("CLI minting and server redemption are serialized: a code shown to the user is never clobbered", async () => {
  const h = harness();
  const first = await h.state.createChallenge({ workspaceId: "ws", now: at });
  const [, second] = await Promise.all([h.state.redeem("U1", "ZZZZZZZZ", at), createQqBotState(join(dir, "state"), APP).createChallenge({ workspaceId: "ws", now: at })]);
  // Whichever order won, the newest code is the stored one and still has all its attempts.
  const stored = JSON.parse(readFileSync(join(dir, "state", "challenge.json"), "utf8"));
  expect([4, 5]).toContain(stored.attemptsLeft);
  expect((await h.state.redeem("U1", second.code, at)).ok).toBe(true);
  expect(first.code).not.toBe(second.code);
  expect(readdirSync(join(dir, "state"))).not.toContain(".lock");
});
