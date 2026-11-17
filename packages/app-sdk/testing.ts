import { requireDescendantStop, spawnSupervised } from "./process";
import { existsSync } from "node:fs";
import { explicitModuleCommand, type ExplicitModuleEntry } from "./module-entry";
import { readFile } from "node:fs/promises";
import { createLoopbackChannel } from "./transport";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Trigger, CallOptions, CallState } from "./sdk";

type Call = { id: string; method: string; params: Record<string, unknown> };
type Event = { trigger: Trigger; now: string; params: Record<string, string | number | boolean> };
type Reply = { id: string; result?: { result?: unknown }; error?: string };
/** The directories the module under test sees (same variables as `chrona.paths`). */
export const paths = { module: process.env.CHRONA_MODULE ?? process.cwd(), data: process.env.CHRONA_DATA ?? "/data", content: process.env.CHRONA_CONTENT ?? "/content" };
type Stub = (params: Record<string, unknown>, options: CallOptions) => unknown | Promise<unknown>;
function findStub(stubs: Record<string, Stub>, target: string) {
  return Object.hasOwn(stubs, target) ? stubs[target] : undefined;
}
// eslint-disable-next-line complexity -- Keep fake-kernel credential authorization and stub fallbacks together to preserve test protocol behavior.
async function effectReply(target: string, args: Record<string, unknown>, stubs: Record<string, Stub>, manifest: { secrets?: (string | { name: string })[] }, options: CallOptions): Promise<unknown> {
  if (target === "secrets.get" || target === "secrets.authorize" || target === "secrets.token") {
    // Entry modules (the page) may authorize any credential; the kernel enforces who.
    const listed = target === "secrets.authorize" || (manifest.secrets ?? []).some(secret => (typeof secret === "string" ? secret : secret.name) === String(args.name)), stub = findStub(stubs, target) ?? (target === "secrets.get" ? findStub(stubs, "secret") : undefined);
    return listed && stub ? { result: { output: await stub(args, options) } } : { error: { code: listed ? "unavailable" : "forbidden", message: "No secret in tests" } };
  }
  const stub = findStub(stubs, target);
  return { result: { output: stub ? await stub(args, options) ?? null : null } };
}
type TestState = { stubs: Record<string, Stub>; manifest: { secrets?: (string | { name: string })[] }; receipts: Map<string, CallState>; completions: Map<string, unknown>; bindings: Record<string, string> };
function updateBindings(target: string, reply: unknown, bindings: Record<string, string>) {
  if (target !== "modules.list" && target !== "modules.describe") return;
  const output = (reply as { result: { output: { items: { id: string; name: string; moduleId?: string; target?: unknown }[] } | null } }).result.output;
  if (!Array.isArray(output?.items)) return;
  for (const row of output.items) {
    if (target === "modules.list") bindings[row.name] = row.id;
    else if (row.moduleId && typeof row.target === "string") bindings[row.target.split(".")[0]!] = row.moduleId;
  }
}
function initialBindings(uses: string[] = [], names: string[], ownName?: string) {
  return Object.fromEntries([...uses, ...names, ...(ownName ? [ownName] : [])].map(target => target.split(".")[0]!).filter(name => name !== "*").map(name => [name, name]));
}
function receiptKey(target: string, key: unknown): string {
  return JSON.stringify([target, key]);
}
function boundTarget(address: string | { moduleId: string; tool: string }, bindings: Record<string, string>): string {
  return typeof address === "string" ? address : `${Object.entries(bindings).find(([, id]) => id === address.moduleId)?.[0] ?? address.moduleId}.${address.tool}`;
}
async function callReply(call: Call, { stubs, manifest, receipts, completions, bindings }: TestState): Promise<unknown> {
  if (call.method === "callStatus") {
    const receipt = call.params.callId ? [...receipts.values()].find(row => row.callId === call.params.callId)
      : receipts.get(receiptKey(boundTarget(call.params.target as string | { moduleId: string; tool: string }, bindings), call.params.key));
    return receipt ? { result: receipt } : { error: { code: "not_found", message: "Call not found in test fixture" } };
  }
  const address = call.params.target as string | { moduleId: string; tool: string };
  const target = boundTarget(address, bindings), args = (call.params.args ?? {}) as Record<string, unknown>;
  // Match the host before either Agent fixtures or caller stubs can hide an invalid mode.
  if (call.params.mode === "async" && ["agent.register", "agent.providers", "agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"].some(name => name === address)) return { error: { code: "invalid", message: `${address} is called synchronously (its arguments are never stored)` } };
  if (typeof address === "string" && target.startsWith("agent.") && !findStub(stubs, target)) {
    const result = await agentReply(target, args, completions, call.params.key);
    if (result) return result;
  }
  if (call.params.mode === "async") {
    const key = receiptKey(target, call.params.key), receipt = receipts.get(key);
    if (receipt) return { result: { ...receipt, duplicate: true } };
    const queued: CallState = { callId: call.id, status: "queued" };
    receipts.set(key, queued);
    return { result: { ...queued, duplicate: false } };
  }
  const reply = await effectReply(target, args, stubs, manifest, { key: call.params.key as string | undefined, mode: call.params.mode as CallOptions["mode"] });
  updateBindings(target, reply, bindings);
  return reply;
}
/**
 * Fake kernel for author tests. No call ever executes a real external effect. Routed calls answer from
 * `stubs["<module>.<tool>"]` (sync: its value is the output), kernel Agent fixtures, or a queued call.
 * `stubs.secret` also supplies secrets.get.
 */
export async function startModule(entry: string | ExplicitModuleEntry, { stubs = {} }: { stubs?: Record<string, Stub> } = {}) {
  const manifest = JSON.parse(await readFile(join(process.env.CHRONA_MODULE ?? process.cwd(), "module.json"), "utf8")) as { name?: string; effects: string[]; uses?: string[]; secrets?: (string | { name: string })[] };
  const bindings = initialBindings(manifest.uses, Object.keys(stubs), manifest.name);
  const calls: Call[] = [], receipts = new Map<string, CallState>(), completions = new Map<string, unknown>();
  const state = { stubs, manifest, receipts, completions, bindings };
  let closed = false;
  const pending = new Map<string, { resolve(reply: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function fail(error = new Error("Module disconnected")) {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  async function message(value: unknown) {
    if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") throw new Error("Invalid module message");
    if ("method" in value && typeof value.method === "string") {
      const call = value as Call;
      calls.push(call);
      try {
        const reply = await callReply(call, state);
        channel.send({ id: call.id, ...reply as object });
      } catch (error) { channel.send({ id: call.id, error: { code: "failed", message: error instanceof Error ? error.message : String(error) } }); }
      return;
    }
    const request = pending.get(value.id);
    if (request) { pending.delete(value.id); clearTimeout(request.timer); request.resolve(value as Reply); }
  }
  const channel = await createLoopbackChannel({
    onMessage(value) { void message(value).catch(error => {
      console.error(JSON.stringify({ component: "sdk-testing", event: "message.failed", error: error instanceof SyntaxError ? "invalid_json" : error instanceof TypeError ? "invalid_message_type" : "message_dispatch_failed" }));
      void channel.close();
    }); },
    onDisconnect: fail,
  });
  // The release ships this static loader with the SDK. A trusted launcher may
  // supply its own preload path; a child never inherits Bun's preload flags.
  const loader = process.env.CHRONA_SDK_LOADER ?? join(import.meta.dirname, "chrona-sdk-loader.ts");
  let task: ReturnType<typeof spawnSupervised>;
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, CHRONA_SDK: process.env.CHRONA_SDK ?? import.meta.dirname, CHRONA_IPC_ENDPOINT: channel.endpoint, CHRONA_IPC_TOKEN: channel.token, CHRONA_MODULE_BINDINGS: JSON.stringify(bindings) };
    delete env.CHRONA_SOCKET; delete env.CHRONA_HTTP_SOCKET;
    const command = typeof entry === "string"
      ? { program: process.execPath, argv: ["--no-install", ...(process.env.CHRONA_SDK_LOADER || existsSync(loader) ? ["--preload", loader] : []), entry] }
      : explicitModuleCommand(env.CHRONA_MODULE ?? process.cwd(), entry);
    task = spawnSupervised(command.program, command.argv, { env, cwd: env.CHRONA_MODULE ?? process.cwd() });
    task.process.stdin.end();
    task.process.stdout.resume(); task.process.stderr.resume();
  } catch (error) { await channel.close(); throw error; }
  const exited = task.exited.then(requireDescendantStop).then(async () => {
    fail(); await channel.close();
  }).catch(error => { fail(error); throw error; });
  // Tests may only use send()/stop(). Keep a natural unknown exit observable by
  // those methods without an unhandled rejection or releasing its resources.
  void exited.catch(error => {
    console.error(JSON.stringify({ component: "sdk-testing", event: "process.failed", error: error instanceof Error && error.name === "ProcessStopUnknownError" ? "descendant_stop_unknown" : "process_supervision_failed" }));
  });
  return {
    calls,
    /** Rejects if descendant shutdown cannot be confirmed. */
    exited,
    /** Resolves only after the authenticated module reports its private HTTP listener. */
    httpReady: channel.httpReady,
    /** Fetch a path at the module's listener, with its private transport credential. Redirects stay manual. */
    async fetch(path: string, options: RequestInit = {}): Promise<Response> {
      const { endpoint, token } = await channel.httpReady;
      const url = new URL(path, endpoint);
      if (!path.startsWith("/") || url.origin !== endpoint) throw new Error("Module fetch requires a local path");
      const headers = new Headers(options.headers);
      headers.set("x-chrona-module-token", token);
      return globalThis.fetch(url, { ...options, headers, redirect: "manual" });
    },
    send(event: Event): Promise<Reply> {
      if (event.trigger.kind === "call_result") {
        const trigger = event.trigger;
        const receipt = [...receipts.values()].find(row => row.callId === trigger.callId);
        if (receipt) Object.assign(receipt, { status: trigger.status, output: trigger.output, error: trigger.error });
      }
      return new Promise<Reply>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Module event timeout")); }, 5000);
        pending.set(id, { resolve, reject, timer });
        void channel.ready.then(() => {
          if (closed) throw new Error("Module disconnected");
          if (pending.has(id)) {
            channel.send({ id, event: { ...event, bindings } });
          }
        }).catch(error => { pending.delete(id); clearTimeout(timer); reject(error); });
      });
    },
    async stop() {
      fail(); task.stop();
      await exited;
    },
  };
}

async function agentReply(target: string, args: Record<string, unknown>, completions: Map<string, unknown>, key: unknown) {
  if (target === "agent.run") {
    const runId = `agent.run:${String(key)}`, contextId = String(args.contextId ?? `agent.context:${String(key)}`);
    const run = { runId, contextId, status: "finished", active: false };
    if (!completions.has(runId)) completions.set(runId, { run, items: [{ sequence: 0, at: new Date(0).toISOString(), kind: args.kind === "completion" ? "completion" : "text", payload: args.kind === "completion" ? { text: "Chrona test model response", inputTokens: 0, outputTokens: 0 } : { text: "Chrona test model response" } }], nextCursor: null, ended: true, interactions: [] });
    return { result: { output: run } };
  }
  if (target === "agent.read") {
    const result = completions.get(String(args.runId));
    return result ? { result: { output: result } } : { error: { code: "not_found", message: "Run not found in test fixture" } };
  }
  return null;
}
