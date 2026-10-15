import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, createQqPassiveReplies, qqBotConfig, type QqChatPort } from "./qq-official-bot";
import { createQqTokenSource } from "./qq-official";
const APP = "1905797537";
let dir: string, at: Date;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "qq-bot-")); at = new Date("2026-10-15T08:00:00Z"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function harness(options: { run?: QqChatPort["handleMessage"]; timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> } = {}) {
  const state = createQqBotState(join(dir, "state"), APP);
  const replies: { text: string; sequence: number }[] = [], calls: Parameters<QqChatPort["handleMessage"]>[0][] = [], outbox: string[] = [];
  const handler = createQqBotHandler({ state, now: () => at, timers: options.timers,
    chat: { async handleMessage(input) { calls.push(input); return options.run ? options.run(input) : { reply: "收到" }; } },
    reply: async (_openid, _id, text, sequence) => { replies.push({ text, sequence }); },
    enqueueFinal: async (_binding, _id, text) => { outbox.push(text); },
  });
  let n = 0;
  const say = (openid: string, content: string, id = `M${++n}`, timestamp = at.toISOString()) => handler.onMessage({ id, openid, content, quoted: "", timestamp });
  const bind = async () => { await say("U1", `绑定 ${(await state.createChallenge({ workspaceId: "ws", now: at })).code}`); replies.length = 0; };
  return { state, replies, calls, outbox, say, bind };
}
test("configuration requires numeric app and state directory", () => {
  expect(qqBotConfig({ CHRONA_QQ_APP_ID: APP, CHRONA_DATA_DIR: "/data" })?.stateDir).toBe(`/data/qq-bot/${APP}`);
  expect(qqBotConfig({ CHRONA_QQ_APP_ID: "bad" })).toBeNull();
});
test("unbound and non-owner cannot reach concierge; stranger rate limit preserves help", async () => {
  const h = harness();
  await h.say("U2", "需求"); await h.say("U2", "进度"); await h.say("U2", "帮助");
  expect(h.replies).toHaveLength(2); expect(h.replies[0]!.text).toContain("尚未绑定");
  await h.bind(); await h.say("U3", "需求");
  expect(h.replies[0]!.text).toContain("没有使用权限"); expect(h.calls).toEqual([]);
});
test("owner text goes unchanged to concierge; replay and restart dedupe", async () => {
  const h = harness(); await h.bind();
  for (const text of ["帮我准备答辩", "/chrona 暂停", "帮助", "进度"]) await h.say("U1", text, text);
  expect(h.calls.map(c => c.text)).toEqual(["帮我准备答辩", "/chrona 暂停", "帮助", "进度"]);
  expect(h.calls[0]).toEqual({ workspaceId: "ws", channel: "chrona_qqbot", externalId: "帮我准备答辩", text: "帮我准备答辩" });
  expect(h.replies).toEqual(Array.from({ length: 4 }, () => ({ text: "收到", sequence: 1 })));
  await h.say("U1", "duplicate", "帮助"); expect(h.calls).toHaveLength(4);
  const restart = harness(); await restart.say("U1", "duplicate", "帮助"); expect(restart.calls).toHaveLength(0);
});
test("slow concierge acknowledges at 8 seconds then sends final with next sequence", async () => {
  let fire: (() => void) | undefined, release: (() => void) | undefined;
  const timers = { setTimeout: ((fn: () => void, ms: number) => { expect(ms).toBe(8000); fire = fn; return 1; }) as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout };
  const h = harness({ timers, run: async () => { await new Promise<void>(r => { release = r; }); return { reply: "最终答复" }; } });
  await h.bind(); const pending = h.say("U1", "需求");
  while (!release) await new Promise(r => setTimeout(r, 1));
  expect(h.replies).toEqual([]); fire!(); release!(); await pending;
  expect(h.replies).toEqual([{ text: "收到，处理中…", sequence: 1 }, { text: "最终答复", sequence: 2 }]);
});
test("passive quota reserves four unique sequences and expires after 60 min", async () => {
  const seq: number[] = []; const send = createQqPassiveReplies(async (_o, _i, _t, n) => { seq.push(n); }, () => at.getTime());
  const message = { id: "m", openid: "U1", timestamp: at.toISOString(), content: "", quoted: "" };
  for (let i = 0; i < 4; i++) expect(await send(message, "x")).toBe(true);
  expect(await send(message, "final")).toBe(false); expect(seq).toEqual([1, 2, 3, 4]);
  at = new Date(at.getTime() + 3600_000); expect(await send({ ...message, id: "expired" }, "x")).toBe(false);
});
test("expired passive window sends final through outbox callback", async () => {
  const h = harness(); await h.bind();
  await h.say("U1", "需求", "expired", new Date(at.getTime() - 3600_000).toISOString());
  expect(h.replies).toEqual([]); expect(h.outbox).toEqual(["收到"]);
});
test("binding code hash, permissions, attempt exhaustion, expiry and replacement", async () => {
  const h = harness(); const challenge = await h.state.createChallenge({ workspaceId: "ws", now: at });
  expect(readFileSync(join(dir, "state/challenge.json"), "utf8")).not.toContain(challenge.code);
  expect(statSync(join(dir, "state/challenge.json")).mode & 0o777).toBe(0o600);
  for (let i = 0; i < 5; i++) expect((await h.state.redeem("U1", "ZZZZZZZZ", at)).ok).toBe(false);
  expect(await h.state.redeem("U1", challenge.code, at)).toMatchObject({ reason: "no_challenge" });
  await h.bind(); const replacement = await h.state.createChallenge({ workspaceId: "ws", replace: true, now: at });
  expect((await h.state.redeem("U2", replacement.code, at)).ok).toBe(true);
  expect(await h.state.binding()).toMatchObject({ openid: "U2" });
  await expect(h.state.createChallenge({ workspaceId: "other", replace: true })).rejects.toThrow("bound workspace");
  const expired = await h.state.createChallenge({ workspaceId: "ws", replace: true, now: at, ttlMinutes: 1 });
  expect(await h.state.redeem("U1", expired.code, new Date(at.getTime() + 60000))).toMatchObject({ reason: "expired" });
});
test("active delivery allowlist, local rate limit and no passive message id", async () => {
  const sent: Record<string, unknown>[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    if (url.includes("getAppAccessToken")) return Response.json({ access_token: "fake", expires_in: 7200 });
    sent.push(JSON.parse(String(init!.body))); return Response.json({ id: "receipt" });
  };
  const tokens = createQqTokenSource({ appId: APP, readSecret: async () => "fake", fetch });
  const delivery = createChronaQqDelivery({ tokens, fetch, allowedRecipients: () => new Set(["chrona_qq:U1"]), perMinute: 1 });
  const message = { idempotencyKey: "k", title: "title", body: "body", link: null, recipient: "chrona_qq:U1" };
  expect(await delivery.send(message)).toMatchObject({ outcome: "accepted" }); expect(sent[0]!.msg_id).toBeUndefined();
  expect(await delivery.send(message)).toMatchObject({ outcome: "rejected", retryable: true });
  expect(await delivery.send({ ...message, recipient: "chrona_qq:U2" })).toMatchObject({ outcome: "rejected", retryable: false });
});
