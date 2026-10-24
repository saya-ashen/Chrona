import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

/** Who called a tool, as Chrona recorded it. */
export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string } | { kind: "owner"; via: string | null } | { kind: "kernel" };
export type Trigger = { kind: "schedule"; id: string; firedAt: string }
  | { kind: "inbound"; id: string; firedAt: string; item: { externalId: string; from: string; subject: string; receivedAt: string; body: string } }
  | { kind: "tool"; id: string; firedAt: string; args: Record<string, unknown>; caller?: Caller; call?: { id: string; key: string | null; attempt: number; chain: string[] } }
  | { kind: "content_edit"; id: "content"; firedAt: string; paths: string[]; by: "user" | "provider" }
  | { kind: "call_result"; id: "call"; firedAt: string; callId: string; target: string; key: string; status: "succeeded" | "failed" | "unknown"; output?: unknown; error?: string };
type EventResult = { handled?: boolean; result?: unknown };
type CallResult = { status: "executed" | "duplicate" };
export type CallState = { callId: string; status: "queued" | "running" | "succeeded" | "failed" | "unknown"; duplicate?: boolean; output?: unknown; error?: string };
export type CallOptions = { mode?: "sync" | "async"; key?: string; reply?: boolean; timeoutMs?: number };
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
async function event(message: { id: string; event: { trigger: Trigger; now: string; params: Record<string, string | number | boolean> } }) {
  try {
    const handler = handlers.get(message.event.trigger.kind);
    // Results of async calls are optional to handle: callStatus reads them too.
    if (!handler && message.event.trigger.kind === "call_result") { send({ id: message.id, result: {} }); return; }
    if (!handler) throw new Error("No handler for " + message.event.trigger.kind);
    const result = await handler({ ...message.event.trigger, now: message.event.now, params: message.event.params });
    send({ id: message.id, result: result ?? {} });
  } catch (error) { send({ id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }); }
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
export type OwnerResult = { status: number; body: unknown };
/** Where this module's directories are; set by Chrona with or without a sandbox. */
export const paths = {
  module: process.env.CHRONA_MODULE ?? process.cwd(),
  data: process.env.CHRONA_DATA ?? "/data",
  /** Only for modules declaring `content`. */
  content: process.env.CHRONA_CONTENT ?? "/content",
};
export const chrona = {
  paths,
  /** Owner API (`owner` capability): one request of Chrona's /api/steward HTTP map, as the user. */
  owner: (params: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown }) => call<OwnerResult>("owner", params),
  /**
   * Calls another module's tool through Chrona (`target` = "<module>.<tool>", listed in the manifest's `uses`).
   * sync (default): resolves to the tool's result; a timeout or crash after delivery rejects with code "unknown".
   * async: needs a `key` (a repeat returns the same call) and resolves at once to { callId, status };
   * `reply: true` delivers a `call_result` event later. Rejections are ModelError with a code
   * (undeclared, forbidden, not_found, cycle, unknown, failed, unavailable, invalid).
   */
  call: <T = unknown>(target: string, args: Record<string, unknown> = {}, { mode = "sync", ...options }: CallOptions = {}): Promise<T> =>
    call<{ output?: unknown } & CallState>("call", { target, args, mode, ...options }).then(result => (mode === "sync" ? result.output : result) as T),
  /** State of an async call this module made. */
  callStatus: (callId: string) => call<CallState>("callStatus", { callId }),
  /** A credential listed in the manifest's `secrets` (`owner`). Never log or store it. */
  secret: (params: { name: string }) => call<{ value: Record<string, string> }>("secret", params),
  /** Serves the manifest's `listen` path; Chrona proxies authenticated requests here. */
  serve: (fetch: (request: Request) => Response | Promise<Response>) => Bun.serve({ unix: process.env.CHRONA_HTTP_SOCKET ?? "/chrona/http/s", fetch }),
  model: (params: { system?: string; prompt: string; maxOutputTokens: number }) => call<ModelResult>("model", params),
  /**
   * Deprecated compatibility shorthand for modules written before routing: Chrona turns it into an async call to
   * notify.send (`notify_user` capability). New modules declare `uses: ["notify.send"]` and use `call`.
   */
  notify: (params: { key: string; level: "now" | "digest"; title: string; body: string }) => call("notify", params),
  wakeProvider: (params: { key: string; prompt: string }) => call("wakeProvider", params),
};
