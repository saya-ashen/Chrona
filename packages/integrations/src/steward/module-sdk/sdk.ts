import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import type { ChronaCalls } from "./calls";

/** Who called a tool, as Chrona recorded it. */
export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string } | { kind: "owner"; via: string | null } | { kind: "kernel" };
/** `scheduleId` and `payload` are set for timers the module arranged itself (`schedules.create`) and for reminders. */
export type Trigger = { kind: "schedule"; id: string; firedAt: string; scheduleId?: string; payload?: Record<string, unknown> }
  | { kind: "tool"; id: string; firedAt: string; args: Record<string, unknown>; caller?: Caller; call?: { id: string; key: string | null; attempt: number; chain: string[] } }
  | { kind: "content_edit"; id: "content"; firedAt: string; paths: string[]; by: "user" | "provider" }
  | { kind: "call_result"; id: "call"; firedAt: string; callId: string; target: string; key: string; status: "succeeded" | "failed" | "unknown"; output?: unknown; error?: string };
type EventResult = { result?: unknown };
type CallResult = { status: "executed" | "duplicate" };
export type CallState = { callId: string; status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "unknown"; duplicate?: boolean; output?: unknown; error?: string };
export type CallOptions = { mode?: "sync" | "async"; key?: string; reply?: boolean; timeoutMs?: number };
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
    // Results of async calls are optional to handle: callStatus reads them too.
    if (!handler && message.event.trigger.kind === "call_result") { send({ id: message.id, result: {} }); return; }
    if (!handler) throw new Error("No handler for " + message.event.trigger.kind);
    current = `${message.event.trigger.id}:${message.event.trigger.firedAt}`;
    const result = await handler({ ...message.event.trigger, now: message.event.now, params: message.event.params });
    send({ id: message.id, result: result ?? {} });
  } catch (error) { send({ id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }); }
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
   * Calls another module's tool through Chrona (`target` = "<module>.<tool>", listed in the manifest's `uses`).
   * sync (default): resolves to the tool's result; a timeout or crash after delivery rejects with code "unknown".
   * async: needs a `key` (a repeat returns the same call) and resolves at once to { callId, status };
   * `reply: true` delivers a `call_result` event later. Rejections are ModelError with a code
   * (undeclared, forbidden, not_found, cycle, unknown, failed, unavailable, invalid).
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
  /** Serves the manifest's `listen` path; Chrona proxies authenticated requests here. */
  serve: (fetch: (request: Request) => Response | Promise<Response>) => Bun.serve({ unix: process.env.CHRONA_HTTP_SOCKET ?? "/chrona/http/s", fetch }),
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
