import { requireDescendantStop, spawnSupervised } from "./process";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { connectLoopbackChannel } from "./transport";
import type { ChronaCalls } from "./calls";
export type { ChronaCalls } from "./calls";

/** Who called a tool, as Chrona recorded it. */
export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string } | { kind: "owner"; via: string | null } | { kind: "kernel" };
/** Private wire shape used to settle retained timer receipts. */
type WireTrigger = { kind: "timer"; id: string; eventId: string; timerId: string; timerRevision: string; scheduledAt: string; firedAt: string; payload: unknown }
  | { kind: "schedule"; id: string; firedAt: string; scheduleId?: string; payload?: Record<string, unknown> }
  | { kind: "tool"; id: string; firedAt: string; args: Record<string, unknown>; caller?: Caller; call?: { id: string; key: string | null; attempt: number; chain: string[] } }
  | { kind: "call_result"; id: "call"; firedAt: string; callId: string; target: CallTarget; key: string; status: "succeeded" | "failed" | "unknown"; output?: unknown; error?: string }
  /** Once per active version, and again when a module this one `uses` changes version: register with it here (e.g. web.page-set). */
  | { kind: "activated"; id: "activated"; firedAt: string };
export type Trigger = Exclude<WireTrigger, { kind: "schedule" }>;
type EventResult = { result?: unknown };
export type CallState = { callId: string; status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "unknown"; duplicate?: boolean; output?: unknown; error?: string };
export type CallOptions = { mode?: "sync" | "async"; key?: string; reply?: boolean; timeoutMs?: number; expectedTarget?: { moduleId: string; contractHash: string } };
// v2-25: targets with a declared contract (calls.d.ts, generated per build) take typed arguments and give a typed result.
export type KernelTarget = `${"modules" | "approvals" | "settings" | "secrets" | "activity" | "timers" | "agent" | "runtime-callback" | "workspace-local"}.${string}`;
export type CallTarget = KernelTarget | { moduleId: string; tool: string };
const initialBindings: unknown = JSON.parse(process.env.CHRONA_MODULE_BINDINGS ?? "{}");
if (!initialBindings || typeof initialBindings !== "object" || Array.isArray(initialBindings) || Object.values(initialBindings).some(id => typeof id !== "string" || !id.length || id.length > 128)) throw new Error("Invalid module bindings");
const dependencies: Record<string, string> = Object.assign(Object.create(null), initialBindings);
type Contract = keyof ChronaCalls & KernelTarget;
type ArgsOf<K extends Contract> = ChronaCalls[K] extends { args: infer A } ? A : never;
type OutputOf<K extends Contract> = ChronaCalls[K] extends { output: infer O } ? O : never;
type SyncOptions = CallOptions & { mode?: "sync" };
type Call = {
  <K extends Contract>(target: K, ...rest: object extends ArgsOf<K> ? [args?: ArgsOf<K>, options?: SyncOptions] : [args: ArgsOf<K>, options?: SyncOptions]): Promise<OutputOf<K>>;
  <K extends Contract>(target: K, args: ArgsOf<K>, options: CallOptions & { mode: "async" }): Promise<CallState>;
  <S extends CallTarget>(target: S & (S extends Contract ? never : unknown), args: Record<string, unknown>, options: CallOptions & { mode: "async" }): Promise<CallState>;
  /** A target without a declared contract: the result is unknown unless the caller states what it expects. */
  <T = unknown, S extends CallTarget = CallTarget>(target: S & (S extends Contract ? never : unknown), args?: Record<string, unknown>, options?: CallOptions): Promise<T>;
};
type Handler = (event: WireTrigger & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>;
const handlers = new Map<WireTrigger["kind"], Handler>();
export class ModelError extends Error {
  constructor(public readonly code: string, message: string, public readonly reason?: string) { super(message); this.name = "ModelError"; }
}
const pending = new Map<string, { resolve(result: unknown): void; reject(error: Error): void }>();
let stopped = false, queue = Promise.resolve();
const disconnectHandlers = new Set<() => void>();
/** Release module-owned resources when the kernel connection is lost; this does not prove cleanup to the kernel. */
export function onDisconnect(handler: () => void) { disconnectHandlers.add(handler); }
function fail() {
  if (stopped) return;
  stopped = true;
  for (const call of pending.values()) call.reject(new Error("Chrona disconnected"));
  pending.clear();
  for (const handler of disconnectHandlers) handler();
}
const endpoint = process.env.CHRONA_IPC_ENDPOINT, token = process.env.CHRONA_IPC_TOKEN;
if (!endpoint || !token) throw new Error("CHRONA_IPC_ENDPOINT and CHRONA_IPC_TOKEN are required");
const channel = connectLoopbackChannel({ endpoint, token, onMessage: receive, onDisconnect: fail });
function send(message: unknown) { channel.send(message); }
async function event(message: { id: string; event: { trigger: WireTrigger; now: string; bindings?: Record<string, string>; params: Record<string, string | number | boolean> } }) {
  try {
    for (const key of Object.keys(dependencies)) delete dependencies[key];
    Object.assign(dependencies, message.event.bindings ?? {});
    const handler = handlers.get(message.event.trigger.kind);
    // Results of async calls are optional to handle (callStatus reads them too), and so is `activated`.
    if (!handler && (message.event.trigger.kind === "call_result" || message.event.trigger.kind === "activated")) { send({ id: message.id, result: {} }); return; }
    if (!handler) throw new Error("No handler for " + message.event.trigger.kind);
    const result = await handler({ ...message.event.trigger, now: message.event.now, params: message.event.params });
    send({ id: message.id, result: result ?? {} });
  } catch (error) { send({ id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000), ...(error instanceof ModelError ? { errorCode: error.code, ...(error.reason ? { errorReason: error.reason } : {}) } : {}) }); }
}
function receive(value: unknown) {
  if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") throw new Error("Invalid Chrona message");
  const message = value as { id: string; ping?: boolean; event?: Parameters<typeof event>[0]["event"]; error?: { code: string; reason?: string; message?: string }; result?: unknown };
  if (message.ping === true) send({ id: message.id, result: {} });
  else if (message.event) queue = queue.then(() => event({ id: message.id, event: message.event! })).catch(() => { void channel.close(); });
  else {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new ModelError(message.error.code, message.error.message ?? message.error.code, message.error.reason));
    else call.resolve(message.result);
  }
}
export function on<K extends Trigger["kind"]>(kind: K, handler: (event: Extract<Trigger, { kind: K }> & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>) {
  handlers.set(kind, handler as Handler);
}
function call<T = unknown>(method: string, params: unknown): Promise<T> {
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
  /** Symbolic build dependencies bind to actual application IDs supplied with each event. */
  dependencies,
  /**
   * Calls an application tool through Chrona (`target` = {moduleId, tool}); `uses` declares its contract, not runtime admission.
   * sync (default): resolves to the tool's result; a timeout or crash after delivery rejects with code "unknown".
   * async: needs a `key` (a repeat returns the same call) and resolves at once to { callId, status };
   * `reply: true` delivers a `call_result` event later. Rejections are ModelError with a code
   * (forbidden, not_found, cycle, unknown, failed, unavailable, invalid).
   */
  call: ((target: CallTarget, args: Record<string, unknown> = {}, { mode = "sync", ...options }: CallOptions = {}) =>
    call<{ output?: unknown } & CallState>("call", { target, args, mode, ...options }).then(result => (mode === "sync" ? result.output : result))) as Call,
  /** State of an async call this module made. */
  callStatus: (selector: string | { callId: string } | { target: CallTarget; key: string }) => call<CallState>("callStatus", typeof selector === "string" ? { callId: selector } : selector),
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
    env?: Record<string, string>; cwd?: string; stdin?: string; timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal;
  } = {}): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }> => {
    if (stopped) throw new Error("Chrona disconnected");
    options.signal?.throwIfAborted();
    const helperPath = process.env.CHRONA_PROCESS_HELPER;
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
      // Control credentials belong to this SDK process, even if an env/secret mapping tries to replace them.
      for (const name of Object.keys(env)) if (name.startsWith("CHRONA_IPC_") || name.startsWith("CHRONA_HTTP_") || name === "CHRONA_SOCKET" || name === "CHRONA_PROCESS_HELPER") delete env[name];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- IPC disconnect can change this state while credentials/files are awaited.
      if (stopped) throw new Error("Chrona disconnected");
      options.signal?.throwIfAborted();
      // The guardian reports execvp failure as 126/127, also valid command exit codes.
      if (!Bun.which(command, { cwd: options.cwd, PATH: env.PATH })) throw new Error("Command failed to start");
      const task = spawnSupervised(command, args, { env, cwd: options.cwd, helperPath, signal: options.signal });
      const child = task.process;
      const output: Buffer[][] = [[], []], sizes = [0, 0], cut = [false, false];
      let timedOut = false, truncated = false;
      const timer = setTimeout(() => { timedOut = true; task.stop(); }, options.timeoutMs ?? 60_000);
      disconnectHandlers.add(task.stop);
      try {
        for (const [index, stream] of [child.stdout, child.stderr].entries()) stream.on("data", (chunk: Buffer) => {
          const remaining = Math.max(0, cap + slack - sizes[index]!);
          if (sizes[index]! + chunk.length > cap) truncated = true;
          if (chunk.length > remaining) cut[index] = true;
          if (remaining) { output[index]!.push(chunk.subarray(0, remaining)); sizes[index]! += Math.min(chunk.length, remaining); }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(options.stdin ?? "");
        const exit = await task.exited.catch(() => { throw new Error("Command failed to start"); });
        const { code, signal } = requireDescendantStop(exit);
        options.signal?.throwIfAborted();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- IPC disconnect can change this state while native stop evidence is awaited.
        if (stopped) throw new Error("Chrona disconnected");
        return { code, signal, stdout: redact(Buffer.concat(output[0]!), cut[0]!), stderr: redact(Buffer.concat(output[1]!), cut[1]!), timedOut, truncated };
      } finally {
        clearTimeout(timer);
        disconnectHandlers.delete(task.stop);
      }
    } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
  },
  /** Serves the manifest's `listen` path through the authenticated kernel proxy. */
  serve: (fetch: (request: Request) => Response | Promise<Response>, options: { idleTimeout?: number } = {}) => {
    if (stopped) throw new Error("Chrona disconnected");
    const expected = Buffer.from(token);
    const server = Bun.serve({ ...options, hostname: "127.0.0.1", port: 0, fetch(request) {
      const supplied = Buffer.from(request.headers.get("x-chrona-module-token") ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response("Unauthorized", { status: 401 });
      const headers = new Headers(request.headers);
      headers.delete("x-chrona-module-token");
      return fetch(new Request(request, { headers }));
    } });
    onDisconnect(() => { void server.stop(true); });
    send({ type: "http-ready", endpoint: `http://127.0.0.1:${server.port}` });
    return server;
  },
};
