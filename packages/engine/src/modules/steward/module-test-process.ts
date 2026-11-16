import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { MODULE_CALL_ERRORS, RUN_LIMITS, type ModuleCall, type ModuleEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { z } from "zod";

const moduleOutputSchema = z.object({
  effects: z.array(z.object({ type: z.literal("notify_user"), key: z.string().min(1).max(200), level: z.enum(["now", "digest"]), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000) }).strict()).max(20).default([]),
  handled: z.boolean().optional(),
  result: z.json().optional().refine(value => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16_384, "result must serialize to at most 16 KiB"),
}).strict();

/** Adapts existing test result controls to a wire peer, not a production compatibility path. */
export function testModuleSandbox(runModule: NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>) {
  const peer = testModuleProcess(async (event, call, input) => {
    // This adapter emulates legacy offline script results; explicit processes need the wire-peer fixture.
    if (typeof input.entry !== "string") throw new Error("Explicit entries require testModuleProcess or a real process runtime");
    let result;
    try { result = await runModule({ codeDir: input.codeDir, dataDir: input.dataDir, entry: input.entry, network: input.network, input: event, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes }); }
    catch { throw new Error("Module sandbox run failed"); }
    if (result.status !== "succeeded" || result.exitCode !== 0) throw new Error([result.error, result.output].filter(Boolean).join("\n") || `Module ${result.status}; exit ${result.exitCode}`);
    let output;
    try { output = moduleOutputSchema.parse(JSON.parse(result.output)); }
    catch { throw new Error(`invalid module output: ${result.output}`); }
    for (const effect of output.effects) {
      // As the SDK shorthands do: keys scoped to the event.
      const { type: _type, ...args } = effect, key = `${event.trigger.id}:${event.trigger.firedAt}:${effect.key}`;
      await call("call", { target: "notify.send", args: { ...args, key }, mode: "async", key } as unknown as ModuleCall["params"]);
    }
    return { ...(output.handled === undefined ? {} : { handled: output.handled }), ...(output.result === undefined ? {} : { result: output.result }) };
  });
  return { available: true, isolated: true, runModule, startModule: peer.startModule };
}

type Start = NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>;
/** In-process wire peer for engine tests. Production SDK/bwrap coverage lives in supervisor tests. */
export function testModuleProcess(handler: (event: ModuleEvent, call: (method: ModuleCall["method"], params: ModuleCall["params"]) => Promise<unknown>, input: Parameters<Start>[0]) => Promise<unknown>) {
  const processes: { socket: Socket; httpReady(endpoint: string): void; kill(): void; rejectExit(error: Error): void; input: Parameters<Start>[0] }[] = [];
  const startModule: Start = input => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(input.ipcEndpoint).port) });
    let finish!: (value: { code: number | null; signal: string | null }) => void;
    let rejectExit!: (error: Error) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { finish = resolve; rejectExit = reject; });
    const pending = new Map<string, (value: unknown) => void>();
    const call = (eventId: string, bindings: Record<string, string>) => (method: ModuleCall["method"], params: ModuleCall["params"]) => new Promise(resolve => {
      if (method === "call" && "target" in params && typeof params.target === "string") {
        const [module, tool] = params.target.split(".");
        if (module && tool && bindings[module]) params = { ...params, target: { moduleId: bindings[module], tool } };
      }
      const id = randomUUID(); pending.set(id, resolve); socket.write(JSON.stringify({ id, eventId, method, params }) + "\n");
    });
    socket.on("connect", () => socket.write(JSON.stringify({ type: "auth", version: 1, token: input.ipcToken }) + "\n"));
    let buffer = "";
    socket.on("error", () => {});
    socket.on("close", () => { finish({ code: 1, signal: null }); });
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message.type === "ready") continue;
        if (message.ping === true) { socket.write(JSON.stringify({ id: message.id, result: {} }) + "\n"); continue; }
        if (message.event) {
          void handler(message.event, call(message.id, message.event.bindings ?? {}), input).then(result => {
            if (!socket.destroyed) socket.write(JSON.stringify({ id: message.id, result: result ?? {} }) + "\n");
          }, error => { if (!socket.destroyed) socket.write(JSON.stringify({ id: message.id, error: String(error instanceof Error ? error.message : error).slice(0, 2000), ...(MODULE_CALL_ERRORS.includes(error?.code) ? { errorCode: error.code, ...(error.reason ? { errorReason: error.reason } : {}) } : {}) }) + "\n"); });
        } else { pending.get(message.id)?.(message); pending.delete(message.id); }
      }
    });
    const kill = () => socket.destroy();
    processes.push({ socket, kill, input, rejectExit(error) { rejectExit(error); socket.destroy(); }, httpReady(endpoint) { socket.write(JSON.stringify({ type: "http-ready", endpoint }) + "\n"); } });
    return { pid: processes.length, exited, stderr: () => "", kill };
  };
  return { startModule, processes };
}
