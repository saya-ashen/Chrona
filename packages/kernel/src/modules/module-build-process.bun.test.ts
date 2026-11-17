import { expect, test } from "bun:test";
import { connectLoopbackChannel } from "chrona/transport";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { checkBuildStartup } from "./module-build-process";
import type { ModuleContext } from "./module-context";
import type { StewardPorts } from "../ports";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture({ call = false, exitOnPing = false }: { call?: boolean; exitOnPing?: boolean } = {}) {
  const ping = deferred<void>(), reply = deferred<unknown>();
  const messages: unknown[] = [];
  let peer!: ReturnType<typeof connectLoopbackChannel>, killed = false;
  const startModule: NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]> = input => {
    const exit = deferred<{ code: number | null; signal: string | null }>();
    peer = connectLoopbackChannel({ endpoint: input.ipcEndpoint, token: input.ipcToken,
      onDisconnect() { exit.resolve({ code: 0, signal: null }); },
      onMessage(value) {
        const message = value as { id: string; ping?: boolean };
        messages.push(value);
        if (message.ping) {
          ping.resolve();
          if (exitOnPing) { void peer.close(); return; }
          peer.send({ id: message.id, result: {} });
          if (call) peer.send({ id: "startup-call", method: "call", params: { target: "modules.list", args: {}, mode: "sync" } });
        } else reply.resolve(value);
      },
    });
    return { pid: 1, exited: exit.promise, stderr: () => "", kill() { killed = true; void peer.close(); } };
  };
  const context = { ports: { sandbox: { available: true, startModule } } } as unknown as ModuleContext;
  const manifest = (listen = false) => moduleManifestSchema.parse({ name: "startup", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], ...(listen ? { listen: "/api/startup" } : {}) });
  return { context, manifest, messages, ping: ping.promise, reply: reply.promise, killed: () => killed,
    report(endpoint = "http://127.0.0.1:32123") { peer.send({ type: "http-ready", endpoint }); } };
}

test("build startup authenticates and pings without business events", async () => {
  const f = fixture();
  await checkBuildStartup(f.context, "/unused-code", "/unused-data", f.manifest());
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toMatchObject({ ping: true });
  expect(f.killed()).toBe(true);
});

test("declared HTTP build startup waits for authenticated readiness", async () => {
  const f = fixture();
  let settled = false;
  const startup = checkBuildStartup(f.context, "/unused-code", "/unused-data", f.manifest(true)).then(() => { settled = true; });
  await f.ping;
  await Bun.sleep(10);
  expect(settled).toBe(false);
  f.report();
  await startup;
  expect(f.killed()).toBe(true);
});

test("startup calls receive unavailable and cannot execute effects", async () => {
  const f = fixture({ call: true });
  const startup = checkBuildStartup(f.context, "/unused-code", "/unused-data", f.manifest(true));
  expect(await f.reply).toEqual({ id: "startup-call", error: { code: "unavailable", message: "Calls unavailable during startup check" } });
  f.report();
  await startup;
  expect(f.killed()).toBe(true);
});

test("invalid authenticated HTTP readiness rejects build and cleans up", async () => {
  const f = fixture();
  const startup = checkBuildStartup(f.context, "/unused-code", "/unused-data", f.manifest(true));
  void startup.catch(() => {});
  await f.ping;
  f.report("http://localhost:32123");
  await expect(startup).rejects.toThrow();
  expect(f.killed()).toBe(true);
});

test("exit before HTTP readiness settles and cleans up", async () => {
  const f = fixture({ exitOnPing: true });
  await expect(checkBuildStartup(f.context, "/unused-code", "/unused-data", f.manifest(true))).rejects.toThrow();
  expect(f.killed()).toBe(true);
});
