import { expect, test } from "bun:test";
import { createConnection, type Socket } from "node:net";
import { createModuleChannel } from "./module-channel";

const now = "2026-10-22T09:00:00.000Z";
const event = { trigger: { kind: "schedule" as const, id: "daily", firedAt: now }, now, params: {} };
function lines(socket: Socket) {
  let buffer = "";
  const values: unknown[] = [], waiters: ((value: unknown) => void)[] = [];
  socket.on("data", chunk => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const value: unknown = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiter = waiters.shift(); if (waiter) waiter(value); else values.push(value);
    }
  });
  return () => values.length ? Promise.resolve(values.shift()) : new Promise<unknown>(resolve => waiters.push(resolve));
}
async function fixture(status: "queued" | "waiting" = "queued") {
  const calls: unknown[] = [];
  const channel = await createModuleChannel({ onCall: async call => { calls.push(call); return { id: call.id, result: { callId: "c1", status } }; } });
  const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(channel.endpoint).port) });
  const next = lines(socket);
  socket.write(JSON.stringify({ type: "auth", version: 1, token: channel.token }) + "\n");
  await next();
  await channel.ready;
  return { channel, socket, next, calls, endpoint: channel.endpoint, close: async () => { socket.destroy(); await channel.close(); } };
}
test("channel validates calls and event replies, then recovers", async () => {
  const f = await fixture();
  try {
    f.socket.write('{"id":"bad","method":"unknown","params":{}}\n');
    expect(await f.next()).toMatchObject({ id: "bad", error: { code: "invalid" } });
    f.socket.write(JSON.stringify({ id: "bad-params", method: "call", params: { target: "notify.send", mode: "async" } }) + "\n");
    expect(await f.next()).toMatchObject({ id: "bad-params", error: { code: "invalid" } });
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, result: { unexpected: true } }) + "\n");
    f.socket.write(JSON.stringify({ id: "call", method: "call", params: { target: "provider.wake", args: { prompt: "hello" }, mode: "async", key: "key" } }) + "\n");
    expect(await f.next()).toEqual({ id: "call", result: { callId: "c1", status: "queued" } });
    f.socket.write(JSON.stringify({ id: message.id, result: { handled: true, result: 42 } }) + "\n");
    expect(await result).toEqual({ id: message.id, result: { handled: true, result: 42 } });
    expect(f.calls).toHaveLength(1);
    expect(f.channel.diagnostics()).toEqual(["Invalid module call", "Invalid module call", "Invalid event reply"]);
  } finally { await f.close(); }
});
test.each([true, false])("SDK ping validates protocol without a business event; valid=%s", async valid => {
  const f = await fixture();
  try {
    const response = f.channel.ping(1000);
    const receipt = response.then(() => "connected", () => "invalid");
    const message = await f.next() as { id: string; ping: boolean; event?: unknown };
    expect(message.ping).toBe(true); expect(message.event).toBeUndefined();
    f.socket.write(JSON.stringify({ id: message.id, result: valid ? {} : { result: "unexpected" } }) + "\n");
    expect(await receipt).toBe(valid ? "connected" : "invalid");
    expect(f.calls).toEqual([]);
  } finally { await f.close(); }
});

test("channel preserves known typed handler errors and rejects unknown codes", async () => {
  const f = await fixture();
  try {
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, error: "Conflict", errorCode: "invented" }) + "\n");
    f.socket.write(JSON.stringify({ id: message.id, error: "Conflict", errorCode: "conflict" }) + "\n");
    expect(await result).toEqual({ id: message.id, error: "Conflict", errorCode: "conflict" });
    expect(f.channel.diagnostics()).toContain("Invalid event reply");
  } finally { await f.close(); }
});
test("waiting user decisions survive the routed call reply wire", async () => {
  const f = await fixture("waiting");
  try {
    f.socket.write(JSON.stringify({ id: "decision", method: "callStatus", params: { callId: "c1" } }) + "\n");
    expect(await f.next()).toEqual({ id: "decision", result: { callId: "c1", status: "waiting" } });
    expect(f.channel.diagnostics()).toEqual([]);
  } finally { await f.close(); }
});
test.each(["unconfigured", "budget_exceeded", "provider_error", "timeout"])("SDK model failure %s reaches the waiting caller without timing out", async errorCode => {
  const f = await fixture();
  try {
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, error: "Model request failed", errorCode }) + "\n");
    expect(await result).toEqual({ id: message.id, error: "Model request failed", errorCode });
    expect(f.channel.diagnostics()).toEqual([]);
  } finally { await f.close(); }
});
test("channel drops oversize lines and rejects in-flight event", async () => {
  const f = await fixture();
  try {
    const result = f.channel.send(event, 1000);
    const rejected = result.catch(error => error as Error);
    await f.next();
    f.socket.write("x".repeat(32 * 1024 * 1024 + 1));
    expect((await rejected as Error).message).toBe("Module disconnected");
    expect(f.channel.diagnostics()).toContain("Invalid channel message");
  } finally { await f.close(); }
});
test("event sends serialize; timeout does not close channel; late reply is ignored", async () => {
  const f = await fixture();
  try {
    const first = f.channel.send(event, 30);
    const rejected = first.catch(error => error as Error);
    const second = f.channel.send(event, 1000);
    const a = await f.next() as { id: string };
    expect((await rejected as Error).message).toBe("Module event timeout");
    const b = await f.next() as { id: string };
    expect(b.id).not.toBe(a.id);
    f.socket.write(JSON.stringify({ id: a.id, result: {} }) + "\n");
    f.socket.write(JSON.stringify({ id: b.id, error: "handler failed" }) + "\n");
    expect(await second).toEqual({ id: b.id, error: "handler failed" });
    expect(f.channel.diagnostics()).toContain("Unmatched event reply");
  } finally { await f.close(); }
});
test("channel accepts exactly one connection and rejects invalid outbound events", async () => {
  const f = await fixture();
  try {
    const extra = createConnection({ host: "127.0.0.1", port: Number(new URL(f.endpoint).port) });
    await new Promise<void>(resolve => { extra.on("error", () => {}); extra.on("close", () => resolve()); });
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
    expect(await result).toEqual({ id: message.id, result: {} });
    expect(() => f.channel.send({ ...event, now: "invalid" })).toThrow();
  } finally { await f.close(); }
});
test("drained waits for calls the module is still waiting on, and says whether it waited", async () => {
  let answer!: () => void;
  const held = new Promise<void>(resolve => { answer = resolve; });
  const channel = await createModuleChannel({ onCall: async call => { await held; return { id: call.id, result: { output: { ok: true } } }; } });
  const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(channel.endpoint).port) }), next = lines(socket);
  try {
    socket.write(JSON.stringify({ type: "auth", version: 1, token: channel.token }) + "\n");
    await next();
    await channel.ready;
    expect(await channel.drained()).toBe(false);
    socket.write(JSON.stringify({ id: "resolve", method: "call", params: { target: "approvals.resolve", args: {} } }) + "\n");
    await Bun.sleep(20);
    let done = false;
    const drained = channel.drained().then(waited => { done = true; return waited; });
    await Bun.sleep(20); expect(done).toBe(false);
    answer();
    expect(await drained).toBe(true);
    expect(await next()).toEqual({ id: "resolve", result: { output: { ok: true } } });
  } finally { socket.destroy(); await channel.close(); }
});
