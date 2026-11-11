import { createLoopbackChannel } from "@chrona/integrations/steward/module-sdk/transport";
import { randomUUID } from "node:crypto";
import { moduleEventMessageSchema, moduleEventReplySchema, moduleCallSchema, moduleCallReplySchema, type ModuleCall, type ModuleEvent } from "@chrona/contracts/steward";

type EventReply = ReturnType<typeof moduleEventReplySchema.parse>;
type CallReply = ReturnType<typeof moduleCallReplySchema.parse>;
export async function createModuleChannel({ onCall, timers = globalThis }: { onCall(call: ModuleCall): Promise<CallReply>; timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> }) {
  let closed = false;
  let pending: { id: string; resolve(reply: EventReply): void; reject(error: Error): void } | undefined;
  const records: string[] = [];
  // Calls the module is still waiting on; a replaced version is closed only after they are answered.
  const inflight = new Set<Promise<unknown>>();
  function record(message: string) { records.push(message); if (records.length > 32) records.shift(); }
  function fail(error: Error) { pending?.reject(error); }
  function reply(message: CallReply) {
    const validated = moduleCallReplySchema.parse(message);
    if (transport.connected()) transport.send(validated);
  }
  async function handleCall(value: unknown) {
    if (!value || typeof value !== "object" || !("method" in value || "params" in value)) return false;
    const call = moduleCallSchema.safeParse(value);
    if (!call.success) {
      record("Invalid module call");
      if ("id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 64)
        reply({ id: value.id, error: { code: "invalid", message: "Invalid module call" } });
      return true;
    }
    const work = onCall(call.data);
    inflight.add(work);
    try {
      const result = moduleCallReplySchema.parse(await work);
      if (result.id !== call.data.id) throw new Error("Mismatched call reply");
      reply(result);
    } catch { reply({ id: call.data.id, error: { code: "unknown", message: "Module call failed" } }); }
    finally { inflight.delete(work); }
    return true;
  }
  async function message(value: unknown) {
    if (await handleCall(value)) return;
    const result = moduleEventReplySchema.safeParse(value);
    if (!result.success) { record("Invalid event reply"); return; }
    if (pending?.id === result.data.id) pending.resolve(result.data);
    else record("Unmatched event reply");
  }
  const transport = await createLoopbackChannel({
    onMessage(value) { void message(value).catch(() => { record("Module line failed"); }); },
    onDisconnect(error) { record(error.message); fail(new Error("Module disconnected")); },
  });
  const { ready, closedWithError } = transport;
  let queue: Promise<unknown> = Promise.resolve();
  function exchange(message: { id: string; event?: ModuleEvent; ping?: true }, timeoutMs: number, dispatch?: (send: () => void) => Promise<void>): Promise<EventReply> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error("Invalid event timeout"));
    const run = queue.then(() => new Promise<EventReply>((resolve, reject) => {
      let expired = false, written = false;
      let dispatched: Promise<void> = Promise.resolve();
      const fail = (error: Error) => reject(Object.assign(error, { written }));
      const timer = timers.setTimeout(() => { expired = true; pending = undefined; fail(new Error("Module event timeout")); }, timeoutMs);
      const send = () => {
        if (expired) throw new Error("Module event timeout");
        if (closed || !transport.connected()) throw new Error("Module channel closed");
        pending = { id: message.id,
          resolve: reply => { void dispatched.then(() => { timers.clearTimeout(timer); pending = undefined; resolve(reply); }, fail); },
          reject: error => { timers.clearTimeout(timer); pending = undefined; fail(error); } };
        written = true;
        transport.send(message);
      };
      void ready.then(async () => {
        if (expired) return;
        dispatched = dispatch ? dispatch(send) : Promise.resolve().then(send);
        await dispatched;
      }).catch(error => { timers.clearTimeout(timer); pending = undefined; fail(error); });
    }));
    queue = run.catch(() => {});
    return run;
  }
  return {
    endpoint: transport.endpoint, token: transport.token, httpReady: transport.httpReady, ready, closedWithError,
    async ping(timeoutMs = 10_000) {
      const reply = await exchange({ id: randomUUID(), ping: true }, timeoutMs);
      if ("error" in reply || Object.keys(reply.result).length) throw new Error("Invalid SDK ping reply");
    },
    connected: () => !closed && transport.connected(),
    diagnostics: () => [...records],
    /** Resolves true when it had to wait for calls the module was still waiting on. */
    drained: async () => { const waiting = [...inflight]; await Promise.allSettled(waiting); return waiting.length > 0; },
    send(event: ModuleEvent, timeoutMs = 60_000, dispatch?: (send: () => void) => Promise<void>): Promise<EventReply> {
      return exchange(moduleEventMessageSchema.parse({ id: randomUUID(), event }), timeoutMs, dispatch);
    },
    async close() {
      closed = true; fail(new Error("Module channel closed"));
      await transport.close();
    },
  };
}
