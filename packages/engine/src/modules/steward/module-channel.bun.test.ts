import { expect, test } from "bun:test";
import { createConnection, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-channel-"));
  const calls: unknown[] = [];
  const channel = await createModuleChannel(join(root, "channel.sock"), { onCall: async call => { calls.push(call); return { id: call.id, result: { status: "executed" } }; } });
  const socket = createConnection(join(root, "channel.sock"));
  const next = lines(socket);
  await channel.ready;
  return { channel, socket, next, calls, path: join(root, "channel.sock"), close: async () => { socket.destroy(); await channel.close(); await rm(root, { recursive: true, force: true }); } };
}
test("channel drops malformed lines, validates calls and event replies, then recovers", async () => {
  const f = await fixture();
  try {
    f.socket.write('not-json\n{"id":"bad","method":"unknown","params":{}}\n');
    expect(await f.next()).toMatchObject({ id: "bad", error: { code: "invalid" } });
    f.socket.write(JSON.stringify({ id: "bad-params", method: "notify", params: {} }) + "\n");
    expect(await f.next()).toMatchObject({ id: "bad-params", error: { code: "invalid" } });
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, result: { unexpected: true } }) + "\n");
    f.socket.write(JSON.stringify({ id: "call", method: "wakeProvider", params: { key: "key", prompt: "hello" } }) + "\n");
    expect(await f.next()).toEqual({ id: "call", result: { status: "executed" } });
    f.socket.write(JSON.stringify({ id: message.id, result: { handled: true, result: 42 } }) + "\n");
    expect(await result).toEqual({ id: message.id, result: { handled: true, result: 42 } });
    expect(f.calls).toHaveLength(1);
    expect(f.channel.diagnostics()).toEqual(["Malformed JSON", "Invalid module call", "Invalid module call", "Invalid event reply"]);
  } finally { await f.close(); }
});
test("channel drops oversize lines and rejects in-flight event", async () => {
  const f = await fixture();
  try {
    const result = f.channel.send(event, 1000);
    const rejected = result.catch(error => error as Error);
    await f.next();
    f.socket.write("x".repeat(2 * 1024 * 1024 + 1));
    expect((await rejected as Error).message).toBe("Module disconnected");
    expect(f.channel.diagnostics()).toContain("Module line overflow");
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
    const extra = createConnection(f.path);
    await new Promise<void>(resolve => { extra.on("error", () => {}); extra.on("close", () => resolve()); });
    const result = f.channel.send(event, 1000);
    const message = await f.next() as { id: string };
    f.socket.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
    expect(await result).toEqual({ id: message.id, result: {} });
    expect(() => f.channel.send({ ...event, now: "invalid" })).toThrow();
  } finally { await f.close(); }
});
