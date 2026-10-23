import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

export type Trigger = { kind: "schedule"; id: string; firedAt: string }
  | { kind: "inbound"; id: string; firedAt: string; item: { externalId: string; from: string; subject: string; receivedAt: string; body: string } }
  | { kind: "tool"; id: string; firedAt: string; args: Record<string, unknown> }
  | { kind: "content_edit"; id: "content"; firedAt: string; paths: string[]; by: "user" | "provider" };
type EventResult = { handled?: boolean; result?: unknown };
type CallResult = { status: "executed" | "duplicate" };
type Handler = (event: Trigger & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>;
const handlers = new Map<Trigger["kind"], Handler>();
export type ModelResult = { text: string; inputTokens: number | null; outputTokens: number | null };
export class ModelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ModelError"; }
}
const pending = new Map<string, { resolve(result: unknown): void; reject(error: Error): void }>();
const socket = createConnection(process.env.CHRONA_SOCKET ?? "/chrona/chrona.sock");
let stopped = false, buffer = Buffer.alloc(0), queue = Promise.resolve();
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
    if (!handler) throw new Error("No handler for " + message.event.trigger.kind);
    const result = await handler({ ...message.event.trigger, now: message.event.now, params: message.event.params });
    send({ id: message.id, result: result ?? {} });
  } catch (error) { send({ id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }); }
}
socket.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  let end: number;
  while ((end = buffer.indexOf(10)) !== -1) {
    if (end > 2 * 1024 * 1024) { socket.destroy(); return; }
    const text = buffer.subarray(0, end).toString("utf8");
    buffer = buffer.subarray(end + 1);
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
  if (buffer.length > 2 * 1024 * 1024) socket.destroy();
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
export const chrona = {
  /** Owner API (`owner` capability): one request of Chrona's /api/steward HTTP map, as the user. */
  owner: (params: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown }) => call<OwnerResult>("owner", params),
  /** Serves the manifest's `listen` path; Chrona proxies authenticated requests here. */
  serve: (fetch: (request: Request) => Response | Promise<Response>) => Bun.serve({ unix: process.env.CHRONA_HTTP_SOCKET ?? "/chrona/http/s", fetch }),
  model: (params: { system?: string; prompt: string; maxOutputTokens: number }) => call<ModelResult>("model", params),
  notify: (params: { key: string; level: "now" | "digest"; title: string; body: string }) => call("notify", params),
  wakeProvider: (params: { key: string; prompt: string }) => call("wakeProvider", params),
};
