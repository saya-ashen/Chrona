import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@chrona/db";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { createStewardService, type StewardPorts, type StewardService } from "@chrona/engine";
import type { DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
import { createPiProvider } from "../../../packages/integrations/src/steward/pi-provider";
import { createInAppDelivery } from "../../../packages/integrations/src/steward/in-app-delivery";
import { createScriptSandbox } from "../../../packages/integrations/src/steward/script-sandbox";
import { createEmailConnector } from "../../../packages/integrations/src/steward/email";
import { createLocalTestSource } from "../../../packages/integrations/src/steward/local-test-source";
import { createChinoServiceHealthSource } from "../../../packages/integrations/src/steward/chino-health-source";

export type StewardChatTransport = {
  delivery: DeliveryAdapter; bound(): Promise<boolean>;
  start(service: StewardService, wake: () => void): Promise<void>; stop(): Promise<void>;
};
function publicOrigin(): string | null {
  try {
    const url = new URL(process.env.CHRONA_PUBLIC_URL ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
export function stewardDataDir(env = process.env): string {
  if (env.CHRONA_DATA_DIR?.trim()) return resolve(env.CHRONA_DATA_DIR.trim());
  const file = sqlitePathFromFileUrl(env.DATABASE_URL ?? "file:./prisma/dev.db");
  if (!file || file === ":memory:") throw new Error("CHRONA_DATA_DIR required for an in-memory database");
  return dirname(resolve(file));
}
export function createStewardRuntime(db: PrismaClient, options: {
  now?: () => Date; onError?: () => void; port?: number; provider?: ProviderAdapter | null;
  dataDir?: string; chatTransport?: StewardChatTransport | null; tickSeconds?: number; chatTimeoutMs?: number;
  sandbox?: StewardPorts["sandbox"];
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
} = {}) {
  const bwrap = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  const configured = options.provider === undefined ? (process.env.CHRONA_STEWARD_AGENT === "pi" && options.port ? createPiProvider({
    agentUrl: `http://127.0.0.1:${options.port}/api/steward-agent`,
    chronaExtension: fileURLToPath(new URL("../../../external-plugins/pi-steward-agent/chrona-tools.ts", import.meta.url)),
    command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
    webExtension: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION, bwrap,
    workspaceRoot: resolve(options.dataDir ?? stewardDataDir(), "affairs"),
  }) : null) : options.provider;
  const handles = new Set<ReturnType<ProviderAdapter["start"]>>();
  let stopping = false, pending = false;
  const provider: ProviderAdapter | undefined = configured ? { name: configured.name, health: () => configured.health(), start(input) {
    if (stopping) throw new Error("Runtime stopping");
    const handle = configured.start(input); handles.add(handle);
    void handle.done.finally(() => handles.delete(handle)).catch(() => {});
    return handle;
  } } : undefined;
  let qq: Promise<StewardChatTransport | null> | undefined;
  const loadQq = () => qq ??= import("./steward-qq-bot").then(({ createStewardQqBot }) => createStewardQqBot({ db, publicUrl: publicOrigin(), now: options.now }));
  // Do not load optional QQ dependencies or inspect its state when unconfigured.
  const transport: StewardChatTransport | null = options.chatTransport !== undefined ? options.chatTransport :
    process.env.CHRONA_QQ_APP_ID && process.env.CHRONA_QQ_SECRET_FILE ? {
      delivery: { channel: "chrona_qqbot", async send(input) { const bot = await loadQq(); return bot ? bot.delivery.send(input) : { outcome: "rejected", retryable: false, error: "QQ unconfigured" }; } },
      bound: async () => Boolean(await (await loadQq())?.bound()),
      start: async (service, wake) => { await (await loadQq())?.start(service, wake); },
      stop: async () => { if (qq) await (await qq)?.stop(); },
    } : null;
  // The existing script sandbox has no affair-cwd mount API. Fail closed until that
  // adapter exposes the v3 job port; never run a job on the host or in the wrong cwd.
  const scriptSandbox = createScriptSandbox({ bwrapPath: bwrap });
  void scriptSandbox;
  const ports: StewardPorts = {
    db, now: options.now ?? (() => new Date()), dataDir: options.dataDir ?? stewardDataDir(), publicUrl: publicOrigin(), provider,
    connectors: [createEmailConnector(), createLocalTestSource().adapter, createChinoServiceHealthSource({ url: process.env.CHRONA_CHINO_DASHBOARD_URL })],
    deliveries: [createInAppDelivery(), ...(transport ? [transport.delivery] : [])],
    chat: transport ? { channel: "chrona_qqbot", bound: () => transport.bound() } : null,
    sandbox: options.sandbox ?? { available: false }, chatTimeoutMs: options.chatTimeoutMs,
    onQueued: () => tickOnce(), onRunFinished: async () => { wake(); },
  };
  const service = createStewardService(ports), timers = options.timers ?? globalThis;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  function tickOnce(): Promise<void> {
    if (stopping) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = (async () => {
      while (pending && !stopping) {
        pending = false;
        try { if ((await service.tick()).failures.length) options.onError?.(); }
        catch { options.onError?.(); }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  function wake() { void tickOnce(); }
  return {
    ports, service, tickOnce, wake,
    async health() {
      let providerHealth = { name: provider?.name ?? "unconfigured", available: false, sandboxed: false };
      try { if (provider) { const h = await provider.health(); providerHealth = { name: provider.name, available: h.available, sandboxed: h.sandboxed }; } } catch { /* Public health never exposes diagnostic secrets. */ }
      let git = false;
      try { git = await Bun.spawn(["git", "--version"], { stdout: "ignore", stderr: "ignore" }).exited === 0; } catch { /* Missing git. */ }
      return { provider: providerHealth, git, jobsSandbox: ports.sandbox?.available ?? false };
    },
    start() {
      if (timer || (!options.timers && (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")))) return;
      stopping = false;
      void transport?.start(service, wake).catch(() => options.onError?.());
      const seconds = options.tickSeconds ?? Number(process.env.CHRONA_STEWARD_TICK_SECONDS ?? 30);
      if (Number.isFinite(seconds) && seconds > 0) timer = timers.setInterval(wake, seconds * 1000);
      wake();
    },
    async stop() {
      stopping = true;
      if (timer) timers.clearInterval(timer);
      timer = undefined;
      await running;
      await Promise.all([...handles].map(async handle => { await handle.abort(); await handle.done; }));
      await transport?.stop();
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
