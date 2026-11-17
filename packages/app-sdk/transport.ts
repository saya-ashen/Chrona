import { randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";

const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_AUTH_BYTES = 1024;
const AUTH_TIMEOUT_MS = 5000;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type LoopbackHttpEndpoint = { endpoint: string; token: string };
export type LoopbackChannelOptions = {
  onMessage(value: unknown): void;
  onDisconnect?(error: Error): void;
  authTimeoutMs?: number;
  maxPendingConnections?: number;
};
export type LoopbackChannel = {
  endpoint: string;
  token: string;
  ready: Promise<void>;
  closedWithError: Promise<Error>;
  httpReady: Promise<LoopbackHttpEndpoint>;
  connected(): boolean;
  send(value: unknown): void;
  close(): Promise<void>;
};
export type LoopbackConnection = { ready: Promise<void>; send(value: unknown): void; close(): Promise<void> };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Readiness is optional for callers which only use messages or closedWithError.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function portOf(endpoint: string, protocol: "tcp" | "http"): number {
  const match = new RegExp(`^${protocol}://127\\.0\\.0\\.1:([1-9][0-9]{0,4})$`).exec(endpoint);
  if (!match || Number(match[1]) > 65535) throw new Error("Invalid loopback endpoint");
  return Number(match[1]);
}
function encode(value: unknown): Buffer {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > MAX_FRAME_BYTES) throw new Error("Invalid or oversized channel message");
  return Buffer.from(json + "\n");
}

/** Byte-bounded newline framing, shared by both sides. A rejected frame ends parsing immediately. */
function readFrames(socket: Socket, limit: () => number, onValue: (value: unknown) => void, fail: () => void) {
  let parts: Buffer[] = [], size = 0, stopped = false;
  socket.on("data", (chunk: Buffer) => {
    let start = 0;
    while (start < chunk.length && !stopped && !socket.destroyed) {
      const end = chunk.indexOf(10, start), stop = end === -1 ? chunk.length : end;
      const bytes = stop - start;
      if (size + bytes > limit()) {
        stopped = true; parts = []; fail(); return;
      }
      if (bytes) { parts.push(chunk.subarray(start, stop)); size += bytes; }
      if (end === -1) return;
      const text = Buffer.concat(parts, size).toString("utf8");
      parts = []; size = 0; start = end + 1;
      try { onValue(JSON.parse(text)); }
      catch { stopped = true; fail(); return; }
    }
  });
}

/** A single authenticated module connection; unauthenticated peers cannot claim its identity. */
export async function createLoopbackChannel({ onMessage, onDisconnect, authTimeoutMs = AUTH_TIMEOUT_MS, maxPendingConnections = 16 }: LoopbackChannelOptions): Promise<LoopbackChannel> {
  if (!Number.isFinite(authTimeoutMs) || authTimeoutMs <= 0 || !Number.isInteger(maxPendingConnections) || maxPendingConnections < 1) throw new Error("Invalid channel limits");
  const token = randomBytes(32).toString("hex");
  const ready = deferred<void>(), httpReady = deferred<LoopbackHttpEndpoint>(), closedWithError = deferred<Error>();
  const peers = new Set<Socket>(), unauthenticated = new Set<Socket>();
  let active: Socket | undefined, ended = false, httpReported = false, closing: Promise<void> | undefined;
  function fail(error: Error) {
    if (ended) return;
    ended = true;
    ready.reject(error); httpReady.reject(error); closedWithError.resolve(error);
    for (const peer of peers) peer.destroy();
    server.close();
    onDisconnect?.(error);
  }
  const server = createServer(peer => {
    if (ended || active || unauthenticated.size >= maxPendingConnections) { peer.destroy(); return; }
    peers.add(peer); unauthenticated.add(peer);
    const timer = setTimeout(() => peer.destroy(), authTimeoutMs);
    const protocolFailure = () => {
      if (active === peer) fail(new Error("Invalid channel message"));
      else peer.destroy();
    };
    peer.on("error", () => { if (active === peer) fail(new Error("Module disconnected")); });
    peer.on("close", () => {
      clearTimeout(timer); peers.delete(peer); unauthenticated.delete(peer);
      if (active === peer) fail(new Error("Module disconnected"));
    });
    readFrames(peer, () => active === peer ? MAX_FRAME_BYTES : MAX_AUTH_BYTES, value => {
      if (active !== peer) {
        if (ended || active || !record(value) || value.type !== "auth" || Object.keys(value).length !== 3 || value.version !== 1 || typeof value.token !== "string" || !TOKEN_PATTERN.test(value.token) || !timingSafeEqual(Buffer.from(value.token, "hex"), Buffer.from(token, "hex"))) {
          peer.destroy(); return;
        }
        active = peer; unauthenticated.delete(peer); clearTimeout(timer);
        peer.write(encode({ type: "ready", version: 1 }));
        ready.resolve();
        return;
      }
      if (record(value) && value.type === "http-ready") {
        if (httpReported || Object.keys(value).length !== 2 || typeof value.endpoint !== "string") throw new Error("Invalid HTTP readiness");
        portOf(value.endpoint, "http");
        httpReported = true;
        httpReady.resolve({ endpoint: value.endpoint, token });
      } else {
        if (record(value) && (value.type === "auth" || value.type === "ready")) throw new Error("Unexpected handshake");
        onMessage(value);
      }
    }, protocolFailure);
  });
  server.on("error", () => fail(new Error("Module channel listener failed")));
  await new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error("Module channel listener failed"));
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => { server.off("error", failed); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Module channel listener failed");
  return {
    endpoint: `tcp://127.0.0.1:${address.port}`, token,
    ready: ready.promise, httpReady: httpReady.promise, closedWithError: closedWithError.promise,
    connected: () => !ended && !!active && !active.destroyed,
    send(value) {
      if (ended || !active || active.destroyed) throw new Error("Module disconnected");
      active.write(encode(value));
    },
    close() {
      if (!closing) closing = new Promise<void>(resolve => {
        server.close(() => resolve());
        fail(new Error("Module channel closed"));
      });
      return closing;
    },
  };
}

/** SDK side of the identical protocol. Application sends wait for the server's ready ACK. */
export function connectLoopbackChannel({ endpoint, token, onMessage, onDisconnect }: {
  endpoint: string;
  token: string;
  onMessage(value: unknown): void;
  onDisconnect?(error: Error): void;
}): LoopbackConnection {
  const port = portOf(endpoint, "tcp");
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid channel token");
  const ready = deferred<void>();
  const socket = createConnection({ host: "127.0.0.1", port });
  let authenticated = false, ended = false, pending: Buffer[] = [], pendingBytes = 0, closing: Promise<void> | undefined;
  const timer = setTimeout(() => fail(new Error("Module channel handshake timed out")), AUTH_TIMEOUT_MS);
  function fail(error: Error) {
    if (ended) return;
    ended = true; clearTimeout(timer); pending = []; pendingBytes = 0;
    socket.destroy(); ready.reject(error); onDisconnect?.(error);
  }
  socket.on("connect", () => { if (!ended) socket.write(encode({ type: "auth", version: 1, token })); });
  socket.on("error", () => fail(new Error("Module disconnected")));
  socket.on("close", () => fail(new Error("Module disconnected")));
  readFrames(socket, () => authenticated ? MAX_FRAME_BYTES : MAX_AUTH_BYTES, value => {
    if (!authenticated) {
      if (!record(value) || value.type !== "ready" || Object.keys(value).length !== 2 || value.version !== 1) throw new Error("Invalid ready ACK");
      authenticated = true; clearTimeout(timer);
      for (const frame of pending) socket.write(frame);
      pending = []; pendingBytes = 0; ready.resolve();
    } else {
      if (record(value) && (value.type === "auth" || value.type === "ready" || value.type === "http-ready")) throw new Error("Unexpected handshake");
      onMessage(value);
    }
  }, () => fail(new Error("Invalid channel message")));
  return {
    ready: ready.promise,
    send(value) {
      if (ended) throw new Error("Module disconnected");
      const frame = encode(value);
      if (authenticated) socket.write(frame);
      else {
        if (pendingBytes + frame.length > MAX_FRAME_BYTES + 1) throw new Error("Channel send queue exceeded");
        pending.push(frame); pendingBytes += frame.length;
      }
    },
    close() {
      if (!closing) closing = new Promise<void>(resolve => {
        if (socket.closed) { resolve(); return; }
        socket.once("close", () => resolve());
        fail(new Error("Module channel closed"));
      });
      return closing;
    },
  };
}
