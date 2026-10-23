import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Trigger } from "./sdk";

type Call = { id: string; method: string; params: Record<string, unknown> };
type Event = { trigger: Trigger; now: string; params: Record<string, string | number | boolean> };
type Reply = { id: string; result?: { handled?: boolean; result?: unknown }; error?: string };
/** Fake kernel for author tests. No call ever executes a real external effect. */
export async function startModule(entry: string, { stubs = {} }: { stubs?: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> } = {}) {
  const manifest = JSON.parse(await readFile("/module/module.json", "utf8")) as { effects: string[] };
  const dir = await mkdtemp("/tmp/ct-");
  await chmod(dir, 0o700);
  const path = join(dir, "s"), calls: Call[] = [], seen = new Set<string>();
  let socket: Socket | undefined, closed = false, eventKey = "";
  const pending = new Map<string, { resolve(reply: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let connect!: () => void, disconnect!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { connect = resolve; disconnect = reject; });
  void ready.catch(() => {});
  function fail() {
    closed = true;
    const error = new Error("Module disconnected");
    disconnect(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  async function line(text: string) {
    const message = JSON.parse(text);
    if (typeof message.method === "string") {
      const call = message as Call;
      calls.push(call);
      const capability = ({ notify: "notify_user", wakeProvider: "wake_provider", model: "model" } as Record<string, string>)[call.method];
      let reply: unknown;
      if (!capability || !manifest.effects.includes(capability)) reply = { error: { code: "undeclared", message: "Undeclared capability" } };
      else {
        const key = `${eventKey}:${call.method}:${String(call.params.key)}`;
        const duplicate = call.params.key !== undefined && seen.has(key);
        if (call.params.key !== undefined) seen.add(key);
        if (duplicate) reply = { result: { status: "duplicate" } };
        else if (call.method === "notify" || call.method === "wakeProvider") reply = { result: { status: "executed" } };
        else reply = { result: stubs[call.method] ? await stubs[call.method]!(call.params) : { text: "Chrona test model response", inputTokens: 0, outputTokens: 0 } };
      }
      socket?.write(JSON.stringify({ id: call.id, ...reply as object }) + "\n");
    } else {
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
    }
  }
  const server = createServer(client => {
    if (socket || closed) { client.destroy(); return; }
    socket = client;
    let buffer = "";
    client.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        if (end > 2 * 1024 * 1024) { client.destroy(); return; }
        const text = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        void line(text).catch(() => client.destroy());
      }
      if (buffer.length > 2 * 1024 * 1024) client.destroy();
    });
    client.on("error", fail); client.on("close", fail); connect();
  });
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); }); }
  catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  const child = spawn(process.execPath, [entry], { env: { ...process.env, CHRONA_SOCKET: path }, stdio: "ignore" });
  const exited = new Promise<void>(resolve => { child.once("error", () => { fail(); resolve(); }); child.once("close", () => { fail(); resolve(); }); });
  let queue: Promise<unknown> = Promise.resolve();
  return {
    calls,
    send(event: Event): Promise<Reply> {
      const run = queue.then(() => new Promise<Reply>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Module event timeout")); }, 5000);
        pending.set(id, { resolve, reject, timer });
        void ready.then(() => {
          if (closed) throw new Error("Module disconnected");
          if (pending.has(id)) {
            eventKey = `${event.trigger.id}:${event.trigger.firedAt}`;
            socket!.write(JSON.stringify({ id, event }) + "\n");
          }
        }).catch(error => { pending.delete(id); clearTimeout(timer); reject(error); });
      }));
      queue = run.catch(() => {});
      return run;
    },
    async stop() {
      fail(); child.kill("SIGKILL"); socket?.destroy();
      await exited;
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
