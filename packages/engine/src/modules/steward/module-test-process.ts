import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { moduleOutputSchema, RUN_LIMITS, type ModuleCall, type ModuleEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

/** Adapts existing test result controls to a wire peer, not a production compatibility path. */
export function testModuleSandbox(runModule: NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>) {
  const peer = testModuleProcess(async (event, call, input) => {
    const result = await runModule({ codeDir: input.codeDir, dataDir: input.dataDir, entry: input.entry, network: input.network, input: event, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
    if (result.status !== "succeeded" || result.exitCode !== 0) throw new Error(result.error || `Module ${result.status}; exit ${result.exitCode}`);
    const output = moduleOutputSchema.parse(JSON.parse(result.output));
    for (const effect of output.effects ?? []) {
      const { type, ...params } = effect;
      await call(type === "notify_user" ? "notify" : "wakeProvider", params);
    }
    return { ...(output.handled === undefined ? {} : { handled: output.handled }), ...(output.result === undefined ? {} : { result: output.result }) };
  });
  return { available: true, runModule, startModule: peer.startModule };
}

type Start = NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>;
/** In-process wire peer for engine tests. Production SDK/bwrap coverage lives in supervisor tests. */
export function testModuleProcess(handler: (event: ModuleEvent, call: (method: ModuleCall["method"], params: ModuleCall["params"]) => Promise<unknown>, input: Parameters<Start>[0]) => Promise<unknown>) {
  const processes: { socket: Socket; kill(): void; input: Parameters<Start>[0] }[] = [];
  const startModule: Start = input => {
    const socket = createConnection(input.socketPath);
    let finish!: (value: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => { finish = resolve; });
    const pending = new Map<string, (value: unknown) => void>();
    const call = (method: ModuleCall["method"], params: ModuleCall["params"]) => new Promise(resolve => {
      const id = randomUUID(); pending.set(id, resolve); socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
    let buffer = "";
    socket.on("error", () => {});
    socket.on("close", () => { finish({ code: 1, signal: null }); });
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message.event) {
          void handler(message.event, call, input).then(result => {
            if (!socket.destroyed) socket.write(JSON.stringify({ id: message.id, result: result ?? {} }) + "\n");
          }, error => { if (!socket.destroyed) socket.write(JSON.stringify({ id: message.id, error: String(error instanceof Error ? error.message : error).slice(0, 2000) }) + "\n"); });
        } else { pending.get(message.id)?.(message); pending.delete(message.id); }
      }
    });
    const kill = () => socket.destroy();
    processes.push({ socket, kill, input });
    return { pid: processes.length, exited, stderr: () => "", kill };
  };
  return { startModule, processes };
}
