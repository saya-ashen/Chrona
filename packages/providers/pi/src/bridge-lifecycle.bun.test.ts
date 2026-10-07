import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PI_BRIDGE_MAX_MESSAGE_BYTES, PI_BRIDGE_NAMESPACE, PI_BRIDGE_SOURCE, PI_BRIDGE_VERSION } from "./bridge-source";
import { PiRpc, type RecordValue } from "./rpc";

const NODE = process.env.CHRONA_NODE_BINARY ?? "node";
const bridge = (message: RecordValue) => ({ namespace: PI_BRIDGE_NAMESPACE, version: PI_BRIDGE_VERSION, message });
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function within<T>(promise: Promise<T>, message: string, timeout = 2_000) {
  return await Promise.race([promise, delay(timeout).then(() => { throw new Error(message); })]);
}

async function withBridgePeer<T>(work: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "chrona-pi-native-ipc-"));
  try {
    await writeFile(join(root, "bridge.mjs"), PI_BRIDGE_SOURCE);
    await writeFile(join(root, "peer.mjs"), `import bridge from "./bridge.mjs";
      const [order, sequence, callDelay] = process.argv.slice(2);
      let tool; let started = false; let called = false; let registrations = 0; const handlers = new Map();
      const executeTool = async () => {
        if (!tool || !started || called) return;
        called = true;
        try {
          const result = await tool.execute("bridge-call-" + sequence, { kind: "synthetic-request", sequence: Number(sequence) });
          process.stdout.write(JSON.stringify({ type: "bridge_result", sequence: Number(sequence), result }) + "\\n");
        } catch { process.stdout.write(JSON.stringify({ type: "bridge_failed", sequence: Number(sequence) }) + "\\n"); }
      };
      const startSession = () => {
        if (started) return;
        started = true;
        handlers.get("session_start")?.({}, { model: { provider: "fixture", id: "model" } });
        if (callDelay !== "controlled") setTimeout(executeTool, Number(callDelay));
      };
      // Test-owned control, separate from the production bridge namespace.
      process.on("message", (message) => {
        if (callDelay === "controlled" && message?.namespace === "chrona.pi.fixture" && message.type === "execute") void executeTool();
      });
      await bridge({
        registerTool(definition) {
          registrations++;
          tool = definition;
          process.stdout.write(JSON.stringify({ type: "bridge_registered", registrations }) + "\\n");
          if (order === "late") queueMicrotask(startSession);
        },
        on(name, handler) { handlers.set(name, handler); },
        getActiveTools() { return []; },
        setActiveTools() {},
      });
      if (order === "early") { startSession(); handlers.get("session_start")?.({}, { model: { provider: "fixture", id: "model" } }); }
    `);
    await writeFile(join(root, "size-peer.mjs"), `const NAMESPACE = ${JSON.stringify(PI_BRIDGE_NAMESPACE)};
      process.on("message", (envelope) => process.send?.({ namespace: NAMESPACE, version: ${PI_BRIDGE_VERSION}, message: { type: "received", bytes: Buffer.byteLength(JSON.stringify(envelope)) } }));
      setInterval(() => {}, 1_000);`);
    return await work(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

type Peer = {
  rpc: PiRpc;
  pid: number | undefined;
  bridgeEvents: RecordValue[];
  registered: number[];
  call: Promise<RecordValue>;
  result: Promise<RecordValue>;
  failures: Error[];
};

async function startPeer(root: string, order: "early" | "late", sequence: number, callDelay: number | "controlled" = 150): Promise<Peer> {
  let resolveCall!: (event: RecordValue) => void;
  let resolveResult!: (event: RecordValue) => void;
  const call = new Promise<RecordValue>((resolve) => { resolveCall = resolve; });
  const result = new Promise<RecordValue>((resolve) => { resolveResult = resolve; });
  const bridgeEvents: RecordValue[] = [];
  const registered: number[] = [];
  const failures: Error[] = [];
  const rpc = new PiRpc({
    // Pi 0.85.0 is a Node process. Do not use Bun's process.execPath here.
    command: NODE,
    args: [join(root, "peer.mjs"), order, String(sequence), String(callDelay)],
    cwd: root,
    env: process.env,
    timeoutMs: 2_000,
    onEvent: (event) => {
      if (event.type === "bridge_registered" && typeof event.registrations === "number") registered.push(event.registrations);
      if (event.type === "bridge_result") resolveResult(event);
    },
    onBridge: (event) => {
      bridgeEvents.push(event);
      if (event.type === "call") resolveCall(event);
    },
    onFailure: (error) => failures.push(error),
  });
  expect(await rpc.bridge({ type: "init", tools: [{ name: "chrona_fixture", inputSchema: { type: "object" } }], isolated: true, instructions: "fixture" })).toBe(true);
  await within(new Promise<void>((resolve) => {
    const check = () => bridgeEvents.some((event) => event.type === "initialized") && bridgeEvents.some((event) => event.type === "ready") ? resolve() : setTimeout(check, 1);
    check();
  }), "bridge initialization/readiness timed out");
  return { rpc, pid: rpc.child.pid, bridgeEvents, registered, call, result, failures };
}

function messageAtEnvelopeSize(bytes: number) {
  const base = bridge({ type: "size", padding: "" });
  const padding = bytes - Buffer.byteLength(JSON.stringify(base));
  const message = { type: "size", padding: "x".repeat(padding) };
  expect(Buffer.byteLength(JSON.stringify(bridge(message)))).toBe(bytes);
  return message;
}

function isAlive(pid: number | undefined) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe.skipIf(process.platform === "win32")("Pi bridge native JSON IPC lifecycle", () => {
  it("allows Node to exit while the parent keeps native IPC open", async () => {
    const root = await mkdtemp(join(tmpdir(), "chrona-pi-bridge-exit-"));
    await writeFile(join(root, "bridge.mjs"), PI_BRIDGE_SOURCE);
    await writeFile(join(root, "main.mjs"), `import bridge from "./bridge.mjs";
      await bridge({registerTool(){},on() {}});
      setTimeout(() => process.exit(0), 100);`);
    const child = spawn(NODE, [join(root, "main.mjs")], { stdio: ["pipe", "pipe", "pipe", "ipc"], serialization: "json" });
    const exited = new Promise<number | null>((resolve) => { child.once("exit", resolve); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      child.send(bridge({ type: "init", tools: [], isolated: true, instructions: "fixture" }));
      const code = await Promise.race([exited, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("exit blocked by native IPC"), 2000); })]);
      expect(code).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      child.kill("SIGKILL");
      for (const stream of child.stdio) stream?.destroy();
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("acknowledges complete initialization before one readiness in both session/init orders", async () => {
    await withBridgePeer(async (root) => {
      for (const [index, order] of ["early", "late"].entries()) {
        const peer = await startPeer(root, order as "early" | "late", index, 1_000);
        try {
          await delay(25);
          expect(peer.registered).toEqual([1]);
          expect(peer.bridgeEvents.filter((event) => event.type === "initialized")).toHaveLength(1);
          expect(peer.bridgeEvents.filter((event) => event.type === "ready")).toHaveLength(1);
          expect(peer.bridgeEvents.map((event) => event.type)).toEqual(["initialized", "ready"]);
          expect(peer.failures).toEqual([]);
        } finally { await peer.rpc.close(); }
      }
    });
  });

  it("does not acknowledge malformed partial init", async () => {
    await withBridgePeer(async (root) => {
      const bridgeEvents: RecordValue[] = [];
      const registrations: number[] = [];
      const rpc = new PiRpc({
        command: NODE, args: [join(root, "peer.mjs"), "none", "0", "1_000"], cwd: root, env: process.env, timeoutMs: 2_000,
        onEvent: (event) => { if (event.type === "bridge_registered" && typeof event.registrations === "number") registrations.push(event.registrations); },
        onBridge: (event) => bridgeEvents.push(event), onFailure: () => {},
      });
      try {
        expect(await rpc.bridge({ type: "init", tools: [{ name: "valid", inputSchema: { type: "object" } }, { name: "", inputSchema: { type: "object" } }], isolated: true, instructions: "fixture" })).toBe(true);
        await delay(100);
        expect(registrations).toEqual([]);
        expect(bridgeEvents).toEqual([]);
      } finally { await rpc.close(); }
    });
  });

  it("bounds the complete IPC envelope before sending", async () => {
    await withBridgePeer(async (root) => {
      const received: number[] = [];
      const rpc = new PiRpc({
        command: NODE, args: [join(root, "size-peer.mjs")], cwd: root, env: process.env, timeoutMs: 2_000,
        onEvent: () => {}, onFailure: () => {},
        onBridge: (event) => { if (event.type === "received" && typeof event.bytes === "number") received.push(event.bytes); },
      });
      try {
        expect(await rpc.bridge(messageAtEnvelopeSize(PI_BRIDGE_MAX_MESSAGE_BYTES - 1))).toBe(true);
        expect(await rpc.bridge(messageAtEnvelopeSize(PI_BRIDGE_MAX_MESSAGE_BYTES))).toBe(true);
        await within(new Promise<void>((resolve) => {
          const check = () => received.length === 2 ? resolve() : setTimeout(check, 1);
          check();
        }), "limit envelopes were not sent");
        expect(received).toEqual([PI_BRIDGE_MAX_MESSAGE_BYTES - 1, PI_BRIDGE_MAX_MESSAGE_BYTES]);
        expect(await rpc.bridge(messageAtEnvelopeSize(PI_BRIDGE_MAX_MESSAGE_BYTES + 1))).toBe(false);
        await delay(50);
      } finally { await rpc.close(); }
    });
  }, 20_000);

  it("keeps a new Node Pi bridge alive while Bun GCs unreachable prior children", async () => {
    await withBridgePeer(async (root) => {
      const fdBefore = process.platform === "linux" ? (await readdir("/proc/self/fd")).length : undefined;
      const closedPids: number[] = [];
      await (async () => {
        const prior = await startPeer(root, "late", 0, 20);
        try {
          const call = await within(prior.call, "ordinary bridge call timed out");
          expect(call).toMatchObject({ id: "bridge-call-0", name: "chrona_fixture", input: { kind: "synthetic-request", sequence: 0 } });
          expect(await prior.rpc.bridge({ type: "result", id: call.id, result: { kind: "synthetic-reply", sequence: 0 } })).toBe(true);
          expect(await within(prior.result, "ordinary bridge reply timed out")).toMatchObject({ sequence: 0, result: { kind: "synthetic-reply", sequence: 0 } });
        } finally {
          await prior.rpc.close();
          if (prior.pid) closedPids.push(prior.pid);
        }
      })(); // Returns before the next child; prior wrappers are unreachable.

      for (let sequence = 1; sequence <= 11; sequence++) {
        const current = await startPeer(root, sequence === 1 ? "early" : "late", sequence, "controlled");
        try {
          expect(current.rpc.child.stdio).toHaveLength(4);
          expect(current.rpc.child.stdio[3]).toBeNull();
          // The new Node child is initialized and ready before forced GC starts.
          // Its bridge call waits for explicit release, not a racing child timer.
          let callSeen = false;
          void current.call.then(() => { callSeen = true; });
          let gcCount = 0;
          const gcTimer = setInterval(() => { Bun.gc(true); gcCount++; }, 10);
          try { await delay(100); } finally { clearInterval(gcTimer); }
          expect(gcCount).toBeGreaterThanOrEqual(3);
          expect(callSeen).toBe(false);
          await within(new Promise<void>((resolve, reject) => {
            current.rpc.child.send({ namespace: "chrona.pi.fixture", type: "execute" }, (error) => error ? reject(error) : resolve());
          }), "fixture call release timed out");
          const call = await within(current.call, "forced-GC bridge call timed out");
          expect(call).toMatchObject({ id: `bridge-call-${sequence}`, name: "chrona_fixture", input: { kind: "synthetic-request", sequence } });
          expect(await current.rpc.bridge({ type: "result", id: call.id, result: { kind: "synthetic-reply", sequence } })).toBe(true);
          expect(await within(current.result, "forced-GC bridge reply timed out")).toMatchObject({ sequence, result: { kind: "synthetic-reply", sequence } });
          expect(current.failures).toEqual([]);
        } finally {
          await current.rpc.close();
          if (current.pid) closedPids.push(current.pid);
        }
      }
      Bun.gc(true);
      await delay(50);
      for (const pid of closedPids) expect(isAlive(pid)).toBe(false);
      if (fdBefore !== undefined) expect((await readdir("/proc/self/fd")).length).toBeLessThanOrEqual(fdBefore + 2);
    });
  }, 60_000);
});
