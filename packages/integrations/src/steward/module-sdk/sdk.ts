import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import type { ChronaCalls } from "./calls";

/** Who called a tool, as Chrona recorded it. */
export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string } | { kind: "owner"; via: string | null } | { kind: "kernel" };
/** `scheduleId` and `payload` are set for timers the module arranged itself (`schedules.create`) and for reminders. */
export type Trigger = { kind: "schedule"; id: string; firedAt: string; scheduleId?: string; payload?: Record<string, unknown> }
  | { kind: "tool"; id: string; firedAt: string; args: Record<string, unknown>; caller?: Caller; call?: { id: string; key: string | null; attempt: number; chain: string[] } }
  | { kind: "content_edit"; id: "content"; firedAt: string; paths: string[]; by: "user" | "provider" }
  | { kind: "call_result"; id: "call"; firedAt: string; callId: string; target: string; key: string; status: "succeeded" | "failed" | "unknown"; output?: unknown; error?: string }
  /** Once per active version, and again when a module this one `uses` changes version: register with it here (e.g. web.page-set). */
  | { kind: "activated"; id: "activated"; firedAt: string };
type EventResult = { result?: unknown };
type CallResult = { status: "executed" | "duplicate" };
export type CallState = { callId: string; status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "unknown"; duplicate?: boolean; output?: unknown; error?: string };
export type CallOptions = { mode?: "sync" | "async"; key?: string; reply?: boolean; timeoutMs?: number; expectedTarget?: { moduleId: string; contractHash: string } };
// v2-25: targets with a declared contract (calls.d.ts, generated per build) take typed arguments and give a typed result.
type Contract = keyof ChronaCalls & string;
type ArgsOf<K extends Contract> = ChronaCalls[K] extends { args: infer A } ? A : never;
type OutputOf<K extends Contract> = ChronaCalls[K] extends { output: infer O } ? O : never;
type SyncOptions = CallOptions & { mode?: "sync" };
type Call = {
  <K extends Contract>(target: K, ...rest: object extends ArgsOf<K> ? [args?: ArgsOf<K>, options?: SyncOptions] : [args: ArgsOf<K>, options?: SyncOptions]): Promise<OutputOf<K>>;
  <K extends Contract>(target: K, args: ArgsOf<K>, options: CallOptions & { mode: "async" }): Promise<CallState>;
  /** A target without a declared contract: the result is unknown unless the caller states what it expects. */
  <T = unknown, S extends string = string>(target: S & (S extends Contract ? never : unknown), args?: Record<string, unknown>, options?: CallOptions): Promise<T>;
};
type Handler = (event: Trigger & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>;
const handlers = new Map<Trigger["kind"], Handler>();
export type ModelResult = { text: string; inputTokens: number | null; outputTokens: number | null };
export class ModelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ModelError"; }
}
const pending = new Map<string, { resolve(result: unknown): void; reject(error: Error): void }>();
const socket = createConnection(process.env.CHRONA_SOCKET ?? "/chrona/chrona.sock");
let stopped = false, queue = Promise.resolve();
function fail() {
  stopped = true;
  for (const call of pending.values()) call.reject(new Error("Chrona disconnected"));
  pending.clear();
}
socket.on("error", fail);
socket.on("close", fail);
function send(message: unknown) { socket.write(JSON.stringify(message) + "\n"); }
// Events run one at a time; the shorthands below scope their keys to the event being handled, so a redelivered event
// repeats them and another event does not (routed calls keep the caller's key as given).
let current: string | null = null;
const scoped = (key: string) => (current ? `${current}:${key}` : key);
async function event(message: { id: string; event: { trigger: Trigger; now: string; params: Record<string, string | number | boolean> } }) {
  try {
    const handler = handlers.get(message.event.trigger.kind);
    // Results of async calls are optional to handle (callStatus reads them too), and so is `activated`.
    if (!handler && (message.event.trigger.kind === "call_result" || message.event.trigger.kind === "activated")) { send({ id: message.id, result: {} }); return; }
    if (!handler) throw new Error("No handler for " + message.event.trigger.kind);
    current = `${message.event.trigger.id}:${message.event.trigger.firedAt}`;
    const result = await handler({ ...message.event.trigger, now: message.event.now, params: message.event.params });
    send({ id: message.id, result: result ?? {} });
  } catch (error) { send({ id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000), ...(error instanceof ModelError ? { errorCode: error.code } : {}) }); }
  finally { current = null; }
}
// Lines may carry attachments (up to 32 MiB); collect chunks instead of re-copying the buffer.
const MAX_LINE = 32 * 1024 * 1024;
let parts: Buffer[] = [], size = 0;
socket.on("data", (chunk: Buffer) => {
  let start = 0, end: number;
  while ((end = chunk.indexOf(10, start)) !== -1) {
    if (size + end - start > MAX_LINE) { socket.destroy(); return; }
    const text = Buffer.concat([...parts, chunk.subarray(start, end)]).toString("utf8");
    parts = []; size = 0; start = end + 1;
    try {
      const message = JSON.parse(text);
      if (message.event) queue = queue.then(() => event(message)).catch(() => { socket.destroy(); });
      else {
        const call = pending.get(message.id);
        if (!call) continue;
        pending.delete(message.id);
        if (message.error) call.reject(new ModelError(message.error.code, message.error.message ?? message.error.code));
        else call.resolve(message.result);
      }
    } catch { socket.destroy(); return; }
  }
  if (start < chunk.length) { parts.push(chunk.subarray(start)); size += chunk.length - start; }
  if (size > MAX_LINE) socket.destroy();
});
export function on<K extends Trigger["kind"]>(kind: K, handler: (event: Extract<Trigger, { kind: K }> & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>) {
  handlers.set(kind, handler as Handler);
}
function call<T = CallResult>(method: string, params: unknown): Promise<T> {
  if (stopped) return Promise.reject(new Error("Chrona disconnected"));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: result => resolve(result as T), reject });
    try { send({ id, method, params }); } catch (error) { pending.delete(id); reject(error); }
  });
}
/** Where this module's directories are; set by Chrona with or without a sandbox. */
export const paths = {
  module: process.env.CHRONA_MODULE ?? process.cwd(),
  data: process.env.CHRONA_DATA ?? "/data",
  /** Only for modules declaring `content`. */
  content: process.env.CHRONA_CONTENT ?? "/content",
};
export const chrona = {
  paths,
  /**
   * Calls another module's tool through Chrona (`target` = "<module>.<tool>"); `uses` declares its contract, not runtime admission.
   * sync (default): resolves to the tool's result; a timeout or crash after delivery rejects with code "unknown".
   * async: needs a `key` (a repeat returns the same call) and resolves at once to { callId, status };
   * `reply: true` delivers a `call_result` event later. Rejections are ModelError with a code
   * (forbidden, not_found, cycle, unknown, failed, unavailable, invalid).
   */
  call: ((target: string, args: Record<string, unknown> = {}, { mode = "sync", ...options }: CallOptions = {}) =>
    call<{ output?: unknown } & CallState>("call", { target, args, mode, ...options }).then(result => (mode === "sync" ? result.output : result))) as Call,
  /** State of an async call this module made. */
  callStatus: (callId: string) => call<CallState>("callStatus", { callId }),
  /**
   * A credential listed in the manifest's `secrets` (v2-16: any module; the user saves it in Settings): a routed call to
   * `secrets.get`, `unavailable` until saved. Never log, store or return it.
   */
  secret: (params: { name: string }) => chrona.call<{ value: Record<string, string> }>("secrets.get", params),
  /** v2-30 §4: a short-lived OAuth access token the kernel refreshes; `reauthorize` means the user must consent again (`secrets.authorize`). */
  token: (params: { name: string; provider: "google" | "microsoft"; account?: string }) => chrona.call<{ accessToken: string; expiresAt: string }>("secrets.token", params),
  /** Runs a tool without a shell, passing credentials only to the child and redacting its output. */
  // eslint-disable-next-line complexity -- Keep credential lifetime, child cleanup and redaction in one audited scope.
  exec: async (command: string, args: string[] = [], options: {
    secretEnv?: Record<string, { secret: string; field: string }>; secretFiles?: Record<string, { secret: string; field: string }>;
    tokenEnv?: Record<string, { secret: string; provider: "google" | "microsoft"; account?: string }>;
    env?: Record<string, string>; cwd?: string; stdin?: string; timeoutMs?: number; maxOutputBytes?: number;
  } = {}): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }> => {
    const secrets = new Map<string, Record<string, string>>(), env = { ...process.env, ...options.env };
    for (const { secret, field } of [...Object.values(options.secretEnv ?? {}), ...Object.values(options.secretFiles ?? {})]) {
      if (!secrets.has(secret)) secrets.set(secret, (await chrona.secret({ name: secret })).value);
      if (!Object.hasOwn(secrets.get(secret)!, field)) throw new Error(`Missing secret field: ${secret}.${field}`);
    }
    const tokens: Record<string, string> = {};
    for (const [name, { secret, provider, account }] of Object.entries(options.tokenEnv ?? {})) tokens[name] = (await chrona.token({ name: secret, provider, ...(account ? { account } : {}) })).accessToken;
    // Only the fields handed to the child are redacted: other fields (a username, a host) may legitimately appear in output.
    const values = [...new Set([...[...Object.values(options.secretEnv ?? {}), ...Object.values(options.secretFiles ?? {})].map(({ secret, field }) => secrets.get(secret)![field]!), ...Object.values(tokens)])]
      .filter(Boolean).sort((a, b) => b.length - a.length);
    const cap = options.maxOutputBytes ?? 1_048_576, slack = Buffer.byteLength(values[0] ?? "");
    // Output is kept up to cap + the longest value, redacted, then cut to cap, so a value split by the cap cannot leak a prefix.
    // Replacements can shorten the text below cap, so when the kept bytes were cut, a trailing partial value is dropped too.
    const redact = (bytes: Buffer, cut: boolean) => {
      let text = bytes.toString("utf8");
      for (const value of values) text = text.split(value).join("[redacted]");
      if (cut) for (const value of values) for (let k = value.length - 1; k > 0; k--) if (text.endsWith(value.slice(0, k))) { text = text.slice(0, -k); break; }
      const out = Buffer.from(text);
      return out.length > cap ? out.subarray(0, cap).toString("utf8") : text;
    };
    for (const [name, { secret, field }] of Object.entries(options.secretEnv ?? {})) env[name] = secrets.get(secret)![field];
    Object.assign(env, tokens);
    let dir: string | undefined;
    try {
      const files = Object.entries(options.secretFiles ?? {});
      if (files.length) {
        dir = await fs.mkdtemp(join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "chrona-exec-"));
        await fs.chmod(dir, 0o700);
        if (((await fs.stat(dir)).mode & 0o777) !== 0o700) throw new Error("Invalid secret directory permissions");
        for (const [index, [name, { secret, field }]] of files.entries()) {
          const path = join(dir, String(index));
          await fs.writeFile(path, secrets.get(secret)![field]!, { mode: 0o600 });
          if (((await fs.stat(path)).mode & 0o777) !== 0o600) throw new Error("Invalid secret file permissions");
          env[name] = path;
        }
      }
      return await new Promise((resolve, reject) => {
        let child: ReturnType<typeof spawn>;
        try { child = spawn(command, args, { env, cwd: options.cwd, detached: true, stdio: "pipe" }); }
        catch { reject(new Error("Command failed to start")); return; }
        const output: Buffer[][] = [[], []], sizes = [0, 0], cut = [false, false];
        let timedOut = false, truncated = false, failed = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Child may already have exited. */ }
        }, options.timeoutMs ?? 60_000);
        for (const [index, stream] of [child.stdout, child.stderr].entries()) stream!.on("data", (chunk: Buffer) => {
          const remaining = Math.max(0, cap + slack - sizes[index]!);
          if (sizes[index]! + chunk.length > cap) truncated = true;
          if (chunk.length > remaining) cut[index] = true;
          if (remaining) { output[index]!.push(chunk.subarray(0, remaining)); sizes[index]! += Math.min(chunk.length, remaining); }
        });
        child.once("error", () => { failed = true; });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (failed) { reject(new Error("Command failed to start")); return; }
          resolve({ code, signal, stdout: redact(Buffer.concat(output[0]!), cut[0]!), stderr: redact(Buffer.concat(output[1]!), cut[1]!), timedOut, truncated });
        });
        child.stdin!.on("error", () => {});
        child.stdin!.end(options.stdin ?? "");
      });
    } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
  },
  /** Serves the manifest's `listen` path. Long-poll entries use { idleTimeout: 30 }; omitted keeps Bun's default. */
  // @ts-expect-error Installed bun-types rejects Unix idleTimeout; the real SDK 15s proxy probe verifies runtime support.
  serve: (fetch: (request: Request) => Response | Promise<Response>, options: { idleTimeout?: number } = {}) => Bun.serve({ unix: process.env.CHRONA_HTTP_SOCKET ?? "/chrona/http/s", fetch, ...options }),
  /**
   * One completion: a routed call to `provider.complete` (uses ["provider.complete"] and the manifest's `model` tier and limits).
   * Rejects with ModelError code unconfigured, budget_exceeded, provider_error, timeout or undeclared.
   */
  model: (params: { system?: string; prompt: string; maxOutputTokens: number }) => chrona.call<ModelResult>("provider.complete", params).catch((error: ModelError) => {
    throw new ModelError(/^(undeclared|unconfigured|budget_exceeded|provider_error|timeout):/.exec(error.message)?.[1] ?? error.code, error.message);
  }),
  /** Shorthand for an async call to `notify.send` (uses ["notify.send"]); `key` is the idempotency key. */
  notify: (params: { key: string; level: "now" | "digest"; title: string; body: string }) => chrona.call<CallState>("notify.send", { ...params, key: scoped(params.key) }, { mode: "async", key: scoped(params.key) })
    .then(result => ({ status: result.duplicate ? "duplicate" as const : "executed" as const })),
  /** Shorthand for an async call to `provider.wake` (uses ["provider.wake"]): the Provider runs with `prompt` as untrusted data. */
  wakeProvider: (params: { key: string; prompt: string }) => chrona.call<CallState>("provider.wake", { prompt: params.prompt }, { mode: "async", key: scoped(params.key) })
    .then(result => ({ status: result.duplicate ? "duplicate" as const : "executed" as const })),
  /**
   * Emit an event this module declares in `contributes.events.emits` (v2-14): a sync call to `events.emit` (uses ["events.emit"]).
   * `name` is the event's own name (the module name is added); `key` is the idempotency key, derived from the triggering event.
   */
  emit: (name: string, payload: Record<string, unknown>, options: { key: string }) =>
    chrona.call<{ delivered: number }>("events.emit", { event: name, payload: JSON.stringify(payload), key: scoped(options.key) }),
};
