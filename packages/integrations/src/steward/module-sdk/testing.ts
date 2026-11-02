import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Trigger } from "./sdk";

type Call = { id: string; method: string; params: Record<string, unknown> };
type Event = { trigger: Trigger; now: string; params: Record<string, string | number | boolean> };
type Reply = { id: string; result?: { result?: unknown }; error?: string };
/** The directories the module under test sees (same variables as `chrona.paths`). */
export const paths = { module: process.env.CHRONA_MODULE ?? process.cwd(), data: process.env.CHRONA_DATA ?? "/data", content: process.env.CHRONA_CONTENT ?? "/content" };
/** What the manifest may call, as Chrona computes it: `uses` plus what deprecated declarations stand for. */
// v2-10 names of the provider tools; Chrona maps them the same way (currentTarget).
const legacy: Partial<Record<string, string>> = { "ai.complete": "provider.complete", "ai.wake": "provider.wake" };
const current = (target: string) => legacy[target] ?? target;
type Stub = (params: Record<string, unknown>) => unknown | Promise<unknown>;
function granted(manifest: { effects?: string[]; uses?: string[]; secrets?: (string | { name: string })[] }) {
  const implied: Record<string, string> = { model: "provider.complete", wake_provider: "provider.wake", notify_user: "notify.send" };
  return [...(manifest.uses ?? []).map(current), ...(manifest.effects ?? []).flatMap(effect => implied[effect] ? [implied[effect]] : []), ...(manifest.secrets?.length ? ["secrets.get", "secrets.authorize", "secrets.token"] : [])];
}
function findStub(stubs: Record<string, Stub>, target: string) {
  return Object.hasOwn(stubs, target) ? stubs[target] : undefined;
}
function allowed(target: string, uses: string[], grants: string[]) {
  return uses.includes(target) || uses.includes("*") || grants.includes(target);
}
// eslint-disable-next-line complexity -- Keep fake-kernel credential authorization and stub fallbacks together to preserve test protocol behavior.
async function effectReply(target: string, args: Record<string, unknown>, stubs: Record<string, Stub>, manifest: { secrets?: (string | { name: string })[] }): Promise<unknown> {
  if (target === "secrets.get" || target === "secrets.authorize" || target === "secrets.token") {
    // Entry modules (the page) may authorize any credential; the kernel enforces who.
    const listed = target === "secrets.authorize" || (manifest.secrets ?? []).some(secret => (typeof secret === "string" ? secret : secret.name) === String(args.name)), stub = findStub(stubs, target) ?? (target === "secrets.get" ? findStub(stubs, "secret") : undefined);
    return listed && stub ? { result: { output: await stub(args) } } : { error: { code: listed ? "unavailable" : "forbidden", message: "No secret in tests" } };
  }
  if (target === "provider.complete") {
    const stub = findStub(stubs, "provider.complete") ?? findStub(stubs, "model");
    return { result: { output: stub ? await stub(args) : { text: "Chrona test model response", inputTokens: 0, outputTokens: 0 } } };
  }
  const stub = findStub(stubs, target);
  return { result: { output: stub ? await stub(args) ?? null : null } };
}
async function callReply(call: Call, stubs: Record<string, Stub>, manifest: { effects: string[]; uses?: string[]; secrets?: (string | { name: string })[] }, grants: string[], seen: Set<string>): Promise<unknown> {
  if (call.method === "callStatus") return { result: { callId: String(call.params.callId), status: "queued" } };
  const target = current(String(call.params.target)), args = (call.params.args ?? {}) as Record<string, unknown>, uses = granted(manifest);
  if (!allowed(target, uses, grants)) return { error: { code: "undeclared", message: `${target} is not in uses` } };
  if (call.params.mode === "async") {
    // A repeated key returns the stored call, as Chrona does. The request id doubles as the call id (answer it with a call_result event).
    const key = `${target}:${String(call.params.key)}`, duplicate = seen.has(key);
    seen.add(key);
    return { result: { callId: call.id, status: "queued", duplicate } };
  }
  return effectReply(target, args, stubs, manifest);
}
/**
 * Fake kernel for author tests. No call ever executes a real external effect. Routed calls (`chrona.call`, and the SDK
 * shorthands notify, wakeProvider, model, secret) to a granted target answer from `stubs["<module>.<tool>"]` (sync: its
 * value is the output; `stubs.model` / `stubs.secret` also work) or with a queued call.
 */
/**
 * `grants`: targets whose tools name this module in `callers` (v2-14), so it may call them without listing them in `uses`
 * (e.g. the events module delivering to a subscriber).
 */
export async function startModule(entry: string, { stubs: given = {}, grants = [] }: { stubs?: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>; grants?: string[] } = {}) {
  const stubs = Object.fromEntries(Object.entries(given).map(([target, stub]) => [current(target), stub]));
  const manifest = JSON.parse(await readFile(join(process.env.CHRONA_MODULE ?? process.cwd(), "module.json"), "utf8")) as { effects: string[]; uses?: string[]; secrets?: (string | { name: string })[] };
  const dir = await mkdtemp("/tmp/ct-");
  await chmod(dir, 0o700);
  const path = join(dir, "s"), calls: Call[] = [], seen = new Set<string>();
  let socket: Socket | undefined, closed = false;
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
      const reply = await callReply(call, stubs, manifest, grants, seen);
      socket?.write(JSON.stringify({ id: call.id, ...reply as object }) + "\n");
      return;
    }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
  }
  const server = createServer(client => {
    if (socket || closed) { client.destroy(); return; }
    socket = client;
    let buffer = "";
    client.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        if (end > 32 * 1024 * 1024) { client.destroy(); return; }
        const text = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        void line(text).catch(() => client.destroy());
      }
      if (buffer.length > 32 * 1024 * 1024) client.destroy();
    });
    client.on("error", fail); client.on("close", fail); connect();
  });
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); }); }
  catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  const httpSocket = join(dir, "http");
  const child = spawn(process.execPath, ["--no-install", entry], { env: { ...process.env, CHRONA_SOCKET: path, CHRONA_HTTP_SOCKET: httpSocket }, stdio: "ignore" });
  const exited = new Promise<void>(resolve => { child.once("error", () => { fail(); resolve(); }); child.once("close", () => { fail(); resolve(); }); });
  let queue: Promise<unknown> = Promise.resolve();
  return {
    calls,
    /** Where `chrona.serve` listens: `fetch("http://module/...", { unix: httpSocket })`. */
    httpSocket,
    send(event: Event): Promise<Reply> {
      const run = queue.then(() => new Promise<Reply>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Module event timeout")); }, 5000);
        pending.set(id, { resolve, reject, timer });
        void ready.then(() => {
          if (closed) throw new Error("Module disconnected");
          if (pending.has(id)) {
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
