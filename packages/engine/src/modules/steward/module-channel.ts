import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { moduleEventMessageSchema, moduleEventReplySchema, moduleCallSchema, moduleCallReplySchema, type ModuleCall, type ModuleEvent } from "@chrona/contracts/steward";

type EventReply = ReturnType<typeof moduleEventReplySchema.parse>;
type CallReply = ReturnType<typeof moduleCallReplySchema.parse>;
const maxLine = 64 * 1024;

export async function createModuleChannel(socketPath: string, { onCall }: { onCall(call: ModuleCall): Promise<CallReply> }) {
  let socket: Socket | undefined, accepted = false, closed = false;
  let pending: { id: string; resolve(reply: EventReply): void; reject(error: Error): void } | undefined;
  let connected!: () => void, disconnected!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { connected = resolve; disconnected = reject; });
  // A process can fail before the caller starts awaiting its connection.
  void ready.catch(() => {});
  const records: string[] = [];
  function record(message: string) { records.push(message); if (records.length > 32) records.shift(); }
  function fail(error: Error) { disconnected(error); pending?.reject(error); }
  function reply(message: CallReply) {
    const validated = moduleCallReplySchema.parse(message);
    if (socket && !socket.destroyed) socket.write(JSON.stringify(validated) + "\n");
  }
  async function line(text: string) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { record("Malformed JSON"); return; }
    if (value && typeof value === "object" && ("method" in value || "params" in value)) {
      const call = moduleCallSchema.safeParse(value);
      if (!call.success) {
        record("Invalid module call");
        if ("id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 64)
          reply({ id: value.id, error: { code: "invalid", message: "Invalid module call" } });
        return;
      }
      try {
        const result = moduleCallReplySchema.parse(await onCall(call.data));
        if (result.id !== call.data.id) throw new Error("Mismatched call reply");
        reply(result);
      } catch { reply({ id: call.data.id, error: { code: "internal", message: "Module call failed" } }); }
      return;
    }
    const result = moduleEventReplySchema.safeParse(value);
    if (!result.success) { record("Invalid event reply"); return; }
    if (pending?.id === result.data.id) pending.resolve(result.data);
    else record("Unmatched event reply");
  }
  const server = createServer(client => {
    if (accepted || closed) { client.destroy(); return; }
    accepted = true; socket = client;
    let buffer = Buffer.alloc(0);
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let end: number;
      while ((end = buffer.indexOf(10)) !== -1) {
        if (end > maxLine) { record("Module line overflow"); fail(new Error("Module disconnected")); client.destroy(); return; }
        const text = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 1);
        void line(text).catch(() => { record("Module line failed"); });
      }
      if (buffer.length > maxLine) { record("Module line overflow"); fail(new Error("Module disconnected")); client.destroy(); }
    });
    client.on("error", () => fail(new Error("Module connection failed")));
    client.on("close", () => fail(new Error("Module disconnected")));
    connected();
  });
  server.on("error", () => fail(new Error("Module channel failed")));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.removeListener("error", reject); resolve(); });
  });
  let queue: Promise<unknown> = Promise.resolve();
  return {
    ready,
    diagnostics: () => [...records],
    send(event: ModuleEvent, timeoutMs = 60_000): Promise<EventReply> {
      const message = moduleEventMessageSchema.parse({ id: randomUUID(), event });
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error("Invalid event timeout"));
      const run = queue.then(() => new Promise<EventReply>((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => { expired = true; pending = undefined; reject(new Error("Module event timeout")); }, timeoutMs);
        void ready.then(() => {
          if (expired) return;
          if (closed || !socket || socket.destroyed) throw new Error("Module channel closed");
          pending = { id: message.id,
            resolve: reply => { clearTimeout(timer); pending = undefined; resolve(reply); },
            reject: error => { clearTimeout(timer); pending = undefined; reject(error); } };
          socket.write(JSON.stringify(message) + "\n");
        }).catch(error => { clearTimeout(timer); pending = undefined; reject(error); });
      }));
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      closed = true; fail(new Error("Module channel closed")); socket?.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
