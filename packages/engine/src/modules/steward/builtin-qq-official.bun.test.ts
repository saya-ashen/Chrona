import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQqGateway, createQqTokenSource, sendQqC2c, QQ_TOKEN_URL, type QqC2cMessage } from "./builtin/qq/official";

const SECRET = "test-secret-value";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return { calls, fetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return routes(url, init); } };
}
function tokenRoute(counter: { n: number }, expires: unknown = "7200") {
  return () => { counter.n++; return json(200, { access_token: `tok${counter.n}`, expires_in: expires }); };
}


test("token: cached until a minute before expiry, single-flight, string expires_in, secret and token never logged", async () => {
  const counter = { n: 0 }, logs: string[] = [];
  let clock = 0;
  const { fetch, calls } = fakeFetch(tokenRoute(counter));
  const tokens = createQqTokenSource({ appId: "1905797537", readSecret: async () => SECRET, fetch, now: () => clock, log: (e, f) => logs.push(JSON.stringify([e, f])) });
  expect(await Promise.all([tokens.get(), tokens.get()])).toEqual(["tok1", "tok1"]);
  expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ appId: "1905797537", clientSecret: SECRET });
  expect(calls[0]!.url).toBe(QQ_TOKEN_URL);
  clock = (7200 - 61) * 1000; expect(await tokens.get()).toBe("tok1");
  clock = (7200 - 59) * 1000; expect(await tokens.get()).toBe("tok2");
  tokens.invalidate(); expect(await tokens.get()).toBe("tok3");
  expect(logs.join("\n")).not.toContain(SECRET); expect(logs.join("\n")).not.toMatch(/tok\d/);
});

test("token failure surfaces a fixed error without echoing the response", async () => {
  const logs: string[] = [];
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch: async () => json(400, { message: `bad ${SECRET}` }), log: (e, f) => logs.push(JSON.stringify([e, f])) });
  await expect(tokens.get()).rejects.toThrow("QQ token request failed");
  expect(logs.join()).not.toContain(SECRET);
});

test("send: passive reply carries msg_id; outcomes map to accepted / retryable / uncertain; 401 refreshes once", async () => {
  const counter = { n: 0 };
  let next: Response[] = [];
  const { fetch, calls } = fakeFetch((url) => url === QQ_TOKEN_URL ? tokenRoute(counter)() : next.shift()!);
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch });
  next = [json(200, { id: "MID1" })];
  expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "hi", replyTo: "IN1" })).toEqual({ outcome: "accepted", messageId: "MID1" });
  const sendCall = calls.find(c => c.url.endsWith("/v2/users/OPEN/messages"))!;
  expect(JSON.parse(String(sendCall.init!.body))).toEqual({ content: "hi", msg_type: 0, msg_seq: 1, msg_id: "IN1" });
  expect((sendCall.init!.headers as Record<string, string>).authorization).toBe("QQBot tok1");
  next = [json(401, {}), json(200, { id: "MID2" })];
  expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "x" })).toEqual({ outcome: "accepted", messageId: "MID2" });
  expect(counter.n).toBe(2);
  next = [json(400, { code: 40034100 })]; expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "x" })).toMatchObject({ outcome: "rejected", retryable: true });
  next = [json(400, { code: 40054013 })]; expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "x" })).toMatchObject({ outcome: "rejected", retryable: false });
  next = [json(502, {})]; expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "x" })).toMatchObject({ outcome: "uncertain" });
  next = [json(200, {})]; expect(await sendQqC2c({ tokens, fetch, openid: "OPEN", content: "x" })).toMatchObject({ outcome: "uncertain" });
  const broken = async (url: string) => { if (url === QQ_TOKEN_URL) return json(200, { access_token: "t", expires_in: 7200 }); throw new Error("reset"); };
  expect(await sendQqC2c({ tokens: createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch: broken }), fetch: broken, openid: "OPEN", content: "x" })).toMatchObject({ outcome: "uncertain" });
  expect(await sendQqC2c({ tokens, fetch, openid: "../x", content: "x" })).toMatchObject({ outcome: "rejected", retryable: false });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 1; sent: any[] = []; listeners: Record<string, ((e: any) => void)[]> = {};
  constructor(public url: string) { FakeSocket.all.push(this); }
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ??= []).push(fn); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.emit("close", { code }); }
  emit(type: string, event: any) { for (const fn of this.listeners[type] ?? []) fn(event); }
  server(payload: unknown) { this.emit("message", { data: JSON.stringify(payload) }); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check: () => boolean) { for (let i = 0; i < 200 && !check(); i++) await tick(); expect(check()).toBe(true); }

test("gateway: identify with C2C intent, dispatch DMs only, resume after reconnect, re-identify after invalid session, stop on fatal close", async () => {
  FakeSocket.all = [];
  const counter = { n: 0 };
  const { fetch } = fakeFetch(url => url === QQ_TOKEN_URL ? tokenRoute(counter)() : json(200, { url: "wss://gateway.test" }));
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch });
  const messages: QqC2cMessage[] = [], sleeps: number[] = [];
  const gateway = createQqGateway({ appId: "1", tokens, fetch, WebSocketImpl: FakeSocket as never, onMessage: m => messages.push(m), sleep: async ms => { sleeps.push(ms); }, log: () => {} });
  gateway.start();
  await until(() => FakeSocket.all.length === 1);
  const first = FakeSocket.all[0]!;
  first.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => first.sent.length === 1);
  expect(first.sent[0]).toMatchObject({ op: 2, d: { token: "QQBot tok1", intents: 1 << 25, shard: [0, 1] } });
  first.server({ op: 0, s: 1, t: "READY", d: { session_id: "S1" } });
  expect(gateway.status()).toMatchObject({ state: "ready", resumable: true });
  first.server({ op: 0, s: 2, t: "C2C_MESSAGE_CREATE", d: { id: "M1", content: " 你好 ", author: { user_openid: "U1" }, timestamp: "t" } });
  first.server({ op: 0, s: 3, t: "GROUP_AT_MESSAGE_CREATE", d: { id: "G1", content: "x", author: { member_openid: "U2" } } });
  first.server({ op: 0, s: 4, t: "C2C_MESSAGE_CREATE", d: { id: "M2", content: "暂后", message_type: 103, msg_elements: [{ content: "【Chrona】x\n回复：ABCD 收到" }], author: { user_openid: "U1" } } });
  expect(messages).toEqual([{ id: "M1", openid: "U1", content: " 你好 ", quoted: "", timestamp: "t" }, { id: "M2", openid: "U1", content: "暂后", quoted: "【Chrona】x\n回复：ABCD 收到", timestamp: "" }]);

  first.server({ op: 7 }); // server asks to reconnect → resume with the last seq
  await until(() => FakeSocket.all.length === 2);
  const second = FakeSocket.all[1]!;
  second.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => second.sent.length === 1);
  expect(second.sent[0]).toEqual({ op: 6, d: { token: "QQBot tok1", session_id: "S1", seq: 4 } });
  second.server({ op: 9, d: false }); // not resumable → identify from scratch
  await until(() => FakeSocket.all.length === 3);
  const third = FakeSocket.all[2]!;
  third.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => third.sent.length === 1);
  expect(third.sent[0]).toMatchObject({ op: 2 });

  third.close(4004); // token invalid → refreshed before the next connection
  await until(() => FakeSocket.all.length === 4);
  const fourth = FakeSocket.all[3]!;
  fourth.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => fourth.sent.length === 1);
  expect(fourth.sent[0].d.token).toBe("QQBot tok2");
  fourth.close(4914); // offline / sandbox-only: stop, do not hammer
  await until(() => gateway.status().state === "fatal");
  expect(FakeSocket.all).toHaveLength(4);
  expect(sleeps.every(ms => ms >= 2000)).toBe(true);
  await gateway.stop();
});

test("gateway: a missed heartbeat ACK forces a reconnect; stop() interrupts the backoff", async () => {
  FakeSocket.all = [];
  const { fetch } = fakeFetch(url => url === QQ_TOKEN_URL ? json(200, { access_token: "t", expires_in: 7200 }) : json(200, { url: "wss://gateway.test" }));
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch });
  const gateway = createQqGateway({ appId: "1", tokens, fetch, WebSocketImpl: FakeSocket as never, onMessage: () => {}, sleep: () => new Promise(() => {}), log: () => {} });
  const realSetInterval = globalThis.setInterval;
  let beat: (() => void) | undefined;
  globalThis.setInterval = ((fn: () => void) => { beat = fn; return 1; }) as never;
  try {
    gateway.start();
    await until(() => FakeSocket.all.length === 1);
    FakeSocket.all[0]!.server({ op: 10, d: { heartbeat_interval: 30000 } });
    beat!(); expect(FakeSocket.all[0]!.sent.at(-1)).toEqual({ op: 1, d: null });
    beat!(); // no op 11 in between
    await until(() => gateway.status().state === "backoff");
  } finally { globalThis.setInterval = realSetInterval; }
  await gateway.stop();
  expect(gateway.status().state).toBe("stopped");
});

test("gateway: stop() during the gateway lookup never opens a socket; a missing Hello times out", async () => {
  FakeSocket.all = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch = async (url: string) => { if (url === QQ_TOKEN_URL) return json(200, { access_token: "t", expires_in: 7200 }); await gate; return json(200, { url: "wss://gateway.test" }); };
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch });
  const gateway = createQqGateway({ appId: "1", tokens, fetch, WebSocketImpl: FakeSocket as never, onMessage: () => {}, log: () => {} });
  gateway.start();
  const stopped = gateway.stop();
  release(); await stopped;
  expect(FakeSocket.all).toHaveLength(0);
  expect(gateway.status().state).toBe("stopped");

  const logs: string[] = [];
  const silent = createQqGateway({ appId: "1", tokens: createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch: async (url: string) => url === QQ_TOKEN_URL ? json(200, { access_token: "t", expires_in: 7200 }) : json(200, { url: "wss://gateway.test" }) }), fetch: async (url: string) => url === QQ_TOKEN_URL ? json(200, { access_token: "t", expires_in: 7200 }) : json(200, { url: "wss://gateway.test" }), WebSocketImpl: FakeSocket as never, onMessage: () => {}, log: e => logs.push(e), helloTimeoutMs: 20, sleep: () => new Promise(() => {}) });
  silent.start();
  await until(() => logs.includes("qq.handshake_timeout"));
  expect(silent.status().state).toBe("backoff");
  await silent.stop();
});

test("gateway: button interactions are subscribed and dispatched; a bot refused them (4014) reconnects with DMs only", async () => {
  FakeSocket.all = [];
  const { fetch } = fakeFetch(url => url === QQ_TOKEN_URL ? tokenRoute({ n: 0 })() : json(200, { url: "wss://gateway.test" }));
  const tokens = createQqTokenSource({ appId: "1", readSecret: async () => SECRET, fetch });
  const clicks: unknown[] = [];
  const gateway = createQqGateway({ appId: "1", tokens, fetch, WebSocketImpl: FakeSocket as never, onMessage: () => {}, onInteraction: i => clicks.push(i), sleep: async () => {}, log: () => {} });
  gateway.start();
  await until(() => FakeSocket.all.length === 1);
  const first = FakeSocket.all[0]!;
  first.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => first.sent.length === 1);
  expect(first.sent[0].d.intents).toBe((1 << 25) | (1 << 26));
  first.server({ op: 0, s: 1, t: "READY", d: { session_id: "S1" } });
  first.server({ op: 0, s: 2, t: "INTERACTION_CREATE", d: { id: "I1", user_openid: "U1", data: { resolved: { button_data: "approval:x:once" } } } });
  expect(clicks).toEqual([{ id: "I1", openid: "U1", data: "approval:x:once" }]);
  first.close(4014);
  await until(() => FakeSocket.all.length === 2);
  const second = FakeSocket.all[1]!;
  second.server({ op: 10, d: { heartbeat_interval: 41250 } });
  await until(() => second.sent.length === 1);
  expect(second.sent[0]).toMatchObject({ op: 2, d: { intents: 1 << 25 } });
  expect(gateway.status().state).not.toBe("fatal");
  await gateway.stop();
});
