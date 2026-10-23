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
const pending = new Map<string, { resolve(result: CallResult): void; reject(error: Error): void }>();
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
    if (end > 64 * 1024) { socket.destroy(); return; }
    const text = buffer.subarray(0, end).toString("utf8");
    buffer = buffer.subarray(end + 1);
    try {
      const message = JSON.parse(text);
      if (message.event) queue = queue.then(() => event(message)).catch(() => { socket.destroy(); });
      else {
        const call = pending.get(message.id);
        if (!call) continue;
        pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error.message ?? message.error.code));
        else call.resolve(message.result);
      }
    } catch { socket.destroy(); return; }
  }
  if (buffer.length > 64 * 1024) socket.destroy();
});
export function on<K extends Trigger["kind"]>(kind: K, handler: (event: Extract<Trigger, { kind: K }> & { now: string; params: Record<string, string | number | boolean> }) => EventResult | void | Promise<EventResult | void>) {
  handlers.set(kind, handler as Handler);
}
function call(method: string, params: unknown): Promise<CallResult> {
  if (stopped) return Promise.reject(new Error("Chrona disconnected"));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { send({ id, method, params }); } catch (error) { pending.delete(id); reject(error); }
  });
}
export const chrona = {
  notify: (params: { key: string; level: "now" | "digest"; title: string; body: string }) => call("notify", params),
  wakeProvider: (params: { key: string; prompt: string }) => call("wakeProvider", params),
};
