import { afterEach, expect, test } from "bun:test";
import { createConnection, createServer, type Socket } from "node:net";
import { connectLoopbackChannel, createLoopbackChannel, type LoopbackChannel } from "./module-sdk/transport";

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function channel(options: Partial<Parameters<typeof createLoopbackChannel>[0]> = {}) {
  const value = await createLoopbackChannel({ onMessage() {}, ...options });
  cleanups.push(() => value.close());
  return value;
}
async function peer(endpoint: string) {
  const socket = createConnection({ host: "127.0.0.1", port: Number(endpoint.split(":").at(-1)) });
  cleanups.push(() => { socket.destroy(); });
  socket.on("error", () => {});
  await new Promise<void>(resolve => socket.once("connect", resolve));
  return socket;
}
function closed(socket: Socket) {
  return new Promise<void>(resolve => { if (socket.closed) resolve(); else socket.once("close", () => resolve()); });
}
function nextValue(socket: Socket) {
  return new Promise<unknown>(resolve => {
    let text = "";
    const read = (chunk: Buffer) => {
      text += chunk.toString();
      if (!text.includes("\n")) return;
      socket.off("data", read); resolve(JSON.parse(text.split("\n")[0]!));
    };
    socket.on("data", read);
  });
}
async function authenticate(value: LoopbackChannel) {
  const socket = await peer(value.endpoint);
  const ack = nextValue(socket);
  socket.write(JSON.stringify({ type: "auth", version: 1, token: value.token }) + "\n");
  expect(await ack).toEqual({ type: "ready", version: 1 });
  await value.ready;
  return socket;
}

test("unauthenticated occupants and rejected auth cannot claim or fail the channel", async () => {
  const messages: unknown[] = [], failures: Error[] = [];
  const host = await channel({ onMessage: value => messages.push(value), onDisconnect: error => failures.push(error) });
  expect(host.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
  expect(host.token).toMatch(/^[0-9a-f]{64}$/);
  const idle = await peer(host.endpoint);
  for (const frame of [
    { type: "auth", version: 1, token: "0".repeat(64) },
    { type: "auth", version: 2, token: host.token },
    { id: "not-auth", method: "call" },
  ]) {
    const bad = await peer(host.endpoint), ended = closed(bad);
    bad.write(JSON.stringify(frame) + "\n"); await ended;
  }
  const malformed = await peer(host.endpoint), rejected = closed(malformed);
  malformed.write("{\n"); await rejected;
  expect(host.connected()).toBe(false);
  const client = connectLoopbackChannel({ endpoint: host.endpoint, token: host.token, onMessage: value => messages.push(value) });
  cleanups.push(() => client.close());
  client.send({ attachment: "你好", id: "queued" });
  await client.ready;
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(messages).toEqual([{ attachment: "你好", id: "queued" }]);
  expect(failures).toEqual([]);
  expect(host.connected()).toBe(true);
  const extra = await peer(host.endpoint); await closed(extra);
  const idleEnded = closed(idle);
  await host.close(); await idleEnded;
  expect(host.connected()).toBe(false);
});

test("auth lines are byte bounded and slow peers expire without failing the listener", async () => {
  const host = await channel({ authTimeoutMs: 80, maxPendingConnections: 2 });
  const first = await peer(host.endpoint), second = await peer(host.endpoint);
  const firstEnded = closed(first), secondEnded = closed(second);
  const excess = await peer(host.endpoint); await closed(excess);
  first.write(" ".repeat(1025)); await firstEnded;
  const oversized = await peer(host.endpoint), oversizedEnded = closed(oversized);
  oversized.write("é".repeat(513) + "\n"); await oversizedEnded;
  await secondEnded;
  expect(host.connected()).toBe(false);
  await authenticate(host);
  expect(host.connected()).toBe(true);
});

test("authenticated HTTP readiness accepts only an exact loopback origin and is intercepted", async () => {
  const messages: unknown[] = [];
  const host = await channel({ onMessage: value => messages.push(value) });
  const socket = await authenticate(host);
  socket.write(JSON.stringify({ type: "http-ready", endpoint: "http://127.0.0.1:34567" }) + "\n");
  expect(await host.httpReady).toEqual({ endpoint: "http://127.0.0.1:34567", token: host.token });
  expect(messages).toEqual([]);
  socket.write(JSON.stringify({ type: "http-ready", endpoint: "http://127.0.0.1:34567" }) + "\n");
  expect(await host.closedWithError).toBeInstanceOf(Error);
  expect(host.connected()).toBe(false);
});

for (const endpoint of ["http://localhost:3", "http://127.0.0.2:3", "https://127.0.0.1:3", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:3/", "http://127.0.0.1:3?x", "http://127.0.0.1:3#x", "http://a:b@127.0.0.1:3", "http://127.0.0.1:03"]) {
  test(`rejects HTTP readiness ${endpoint}`, async () => {
    const host = await channel();
    const socket = await authenticate(host);
    socket.write(JSON.stringify({ type: "http-ready", endpoint }) + "\n");
    await host.closedWithError;
    expect(host.connected()).toBe(false);
    await expect(host.httpReady).rejects.toThrow();
  });
}

test("shared framing preserves large attachments and rejects overflow before later frames", async () => {
  let received!: (value: unknown) => void;
  const message = new Promise<unknown>(resolve => { received = resolve; });
  const host = await channel({ onMessage: received });
  const socket = await authenticate(host);
  const attachment = "é".repeat(1024 * 1024);
  const frame = Buffer.from(JSON.stringify({ attachment }) + "\n");
  socket.write(frame.subarray(0, 101)); socket.write(frame.subarray(101));
  expect(await message).toEqual({ attachment });
  let delivered = 0;
  const other = await channel({ onMessage: () => { delivered++; } });
  const oversized = await authenticate(other);
  oversized.write(Buffer.concat([Buffer.alloc(32 * 1024 * 1024 + 1, 32), Buffer.from('\n{"late":true}\n')]));
  await other.closedWithError;
  expect(delivered).toBe(0);
  expect(() => host.send({ attachment: "a".repeat(32 * 1024 * 1024) })).toThrow("oversized");
});

test("authenticated disconnect settles readiness and notifies once", async () => {
  const failures: Error[] = [];
  const host = await channel({ onDisconnect: error => failures.push(error) });
  const socket = await authenticate(host);
  socket.destroy(); await host.closedWithError;
  expect(failures).toHaveLength(1);
  await expect(host.httpReady).rejects.toThrow("disconnected");
  expect(() => host.send({})).toThrow("disconnected");
  await host.close();
  expect(failures).toHaveLength(1);
});

test("client validates endpoint/token before connecting", () => {
  for (const endpoint of ["tcp://localhost:3", "tcp://127.0.0.1:3/", "tcp://127.0.0.1:0", "tcp://127.0.0.1:65536", "tcp://127.0.0.1:3?x", "/tmp/s"]) {
    expect(() => connectLoopbackChannel({ endpoint, token: "a".repeat(64), onMessage() {} })).toThrow("endpoint");
  }
  expect(() => connectLoopbackChannel({ endpoint: "tcp://127.0.0.1:3", token: "short", onMessage() {} })).toThrow("token");
});

test("client waits for ready ACK before flushing application sends", async () => {
  let accept!: (socket: Socket) => void;
  const accepted = new Promise<Socket>(resolve => { accept = resolve; });
  const server = createServer(accept);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const client = connectLoopbackChannel({ endpoint: `tcp://127.0.0.1:${address.port}`, token: "a".repeat(64), onMessage() {} });
  cleanups.push(() => client.close());
  client.send({ queued: true });
  const socket = await accepted;
  cleanups.push(() => { socket.destroy(); });
  const seen: unknown[] = [];
  socket.on("data", chunk => { for (const line of chunk.toString().trim().split("\n")) seen.push(JSON.parse(line)); });
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  expect(seen).toEqual([{ type: "auth", version: 1, token: "a".repeat(64) }]);
  socket.write('{"type":"ready","version":1}\n'); await client.ready;
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  expect(seen[1]).toEqual({ queued: true });
});

test("client bounds the ready ACK deadline", async () => {
  const server = createServer(socket => { socket.on("data", () => {}); cleanups.push(() => { socket.destroy(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const client = connectLoopbackChannel({ endpoint: `tcp://127.0.0.1:${address.port}`, token: "a".repeat(64), onMessage() {} });
  cleanups.push(() => client.close());
  await expect(client.ready).rejects.toThrow("timed out");
}, 7000);
