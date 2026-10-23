import { startRescueListener } from "./rescue";
import { createStewardRoutes } from "./routes/steward.routes";
import { readEnv } from "./config/env";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@chrona/db";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { moduleSupervisor, createStewardService, type StewardPorts, type StewardService } from "@chrona/engine";
import type { DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
import { createStewardE2eProvider } from "./steward-e2e-provider";
import { createPiModelGateway } from "../../../packages/integrations/src/steward/pi-model-gateway";
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
// Packaged binaries ship these files under resources/; source runs use the repo copy.
function resourcePath(relative: string, source = relative): string {
  const packaged = [process.env.CHRONA_RESOURCE_DIR, join(dirname(process.execPath), "resources")]
    .filter((dir): dir is string => Boolean(dir)).map((dir) => join(dir, relative));
  return packaged.find((path) => existsSync(path)) ?? fileURLToPath(new URL(`../../../${source}`, import.meta.url));
}
type RuntimeOptions = {
  now?: () => Date; onError?: () => void; port?: number; provider?: ProviderAdapter | null;
  dataDir?: string; chatTransport?: StewardChatTransport | null; tickSeconds?: number; chatTimeoutMs?: number;
  sandbox?: StewardPorts["sandbox"];
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
};
function configuredProvider(options: RuntimeOptions, bwrap: string | undefined) {
  if (options.provider === undefined && process.env.CHRONA_E2E_TEST_ROUTES === "1" && process.env.CHRONA_STEWARD_AGENT === "e2e" && options.port) return createStewardE2eProvider(options.port);
  return options.provider === undefined ? (process.env.CHRONA_STEWARD_AGENT === "pi" && options.port ? createPiProvider({
    agentUrl: `http://127.0.0.1:${options.port}/api/steward-agent`,
    chronaExtension: resourcePath(join("external-plugins", "pi-steward-agent", "chrona-tools.ts")),
    command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
    agentDir: process.env.CHRONA_STEWARD_PI_AGENT_DIR ?? resolve(options.dataDir ?? stewardDataDir(), "providers/pi"),
    expectedVersion: process.env.CHRONA_STEWARD_PI_VERSION,
    resourcesFile: process.env.CHRONA_STEWARD_PI_RESOURCES_FILE,
    webExtension: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION, bwrap,
    workspaceRoot: resolve(options.dataDir ?? stewardDataDir(), "sessions"),
    dataDir: resolve(options.dataDir ?? stewardDataDir()),
  }) : null) : options.provider;
}
function configuredTransport(db: PrismaClient, options: RuntimeOptions): StewardChatTransport | null {
  let qq: Promise<StewardChatTransport | null> | undefined;
  const loadQq = () => qq ??= import("./steward-qq-bot").then(({ createStewardQqBot }) => createStewardQqBot({ db, publicUrl: publicOrigin(), now: options.now }));
  // Do not load optional QQ dependencies or inspect its state when unconfigured.
  if (options.chatTransport !== undefined) return options.chatTransport;
  if (!process.env.CHRONA_QQ_APP_ID || !process.env.CHRONA_QQ_SECRET_FILE) return null;
  return {
    delivery: { channel: "chrona_qqbot", async send(input) { const bot = await loadQq(); return bot ? bot.delivery.send(input) : { outcome: "rejected", retryable: false, error: "QQ unconfigured" }; } },
    bound: async () => Boolean(await (await loadQq())?.bound()),
    start: async (service, wake) => { await (await loadQq())?.start(service, wake); },
    stop: async () => { if (qq) await (await qq)?.stop(); },
  };
}
export function createStewardRuntime(db: PrismaClient, options: RuntimeOptions = {}) {
  const bwrap = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  const configured = configuredProvider(options, bwrap);
  const handles = new Set<ReturnType<ProviderAdapter["start"]>>();
  let stopping = false, pending = false;
  const provider: ProviderAdapter | undefined = configured ? { name: configured.name, health: () => configured.health(), start(input) {
    if (stopping) throw new Error("Runtime stopping");
    const handle = configured.start(input); handles.add(handle);
    void handle.done.finally(() => handles.delete(handle)).catch(() => {});
    return handle;
  } } : undefined;
  const transport = configuredTransport(db, options);
  const moduleSdk = resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk");
  const scriptSandbox = createScriptSandbox({ bwrapPath: bwrap, dataDir: resolve(options.dataDir ?? stewardDataDir()), moduleSdk });
  const sandbox: StewardPorts["sandbox"] = {
    ...scriptSandbox.health,
    runModule: input => scriptSandbox.runModule(input),
    startModule: input => scriptSandbox.startModule(input),
  };
  const localTest = createLocalTestSource();
  const ports: StewardPorts = {
    db, now: options.now ?? (() => new Date()), dataDir: options.dataDir ?? stewardDataDir(), publicUrl: publicOrigin(), provider,
    modelGateway: createPiModelGateway({
      command: process.env.CHRONA_STEWARD_PI_COMMAND,
      agentDir: process.env.CHRONA_STEWARD_PI_AGENT_DIR ?? resolve(options.dataDir ?? stewardDataDir(), "providers/pi"),
      expectedVersion: process.env.CHRONA_STEWARD_PI_VERSION,
      chronaExtension: resourcePath(join("external-plugins", "pi-steward-agent", "chrona-tools.ts")),
      agentUrl: "", workspaceRoot: resolve(options.dataDir ?? stewardDataDir(), "sessions"),
    }),
    connectors: [createEmailConnector(), localTest.adapter,createChinoServiceHealthSource({ url: process.env.CHRONA_CHINO_DASHBOARD_URL })],
    deliveries: [createInAppDelivery(), ...(transport ? [transport.delivery] : [])],
    chat: transport ? { channel: "chrona_qqbot", bound: () => transport.bound() } : null,
    sandbox: options.sandbox ?? sandbox, moduleSdk,
    moduleBuiltinResources: resourcePath("builtin", "packages/engine/src/modules/steward/builtin"),
    chatTimeoutMs: options.chatTimeoutMs,
    onQueued: () => tickOnce(), onRunFinished: async () => { wake(); },
  };
  const service = createStewardService(ports), timers = options.timers ?? globalThis;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  let rescue: ReturnType<typeof startRescueListener>;
  const canTick = () => pending && !stopping;
  function tickOnce(): Promise<void> {
    if (stopping) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = (async () => {
      while (canTick()) {
        pending = false;
        try { if ((await service.tick()).failures.length) options.onError?.(); }
        catch { options.onError?.(); }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  function wake() { void tickOnce(); }
  let ownerRoutes: ReturnType<typeof createStewardRoutes> | undefined;
  ports.owner = async (workspaceId, { method, path, body }) => {
    ownerRoutes ??= createStewardRoutes(ports, service, wake);
    const url = new URL(path, "http://owner");
    url.searchParams.set("workspaceId", workspaceId);
    const key = readEnv().API_KEY, headers = new Headers(key ? { authorization: `Bearer ${key}` } : {});
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await ownerRoutes.request(url.pathname + url.search, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    // The module's channel drops lines over 2 MiB.
    if (text.length > 1_000_000) return { status: 413, body: { code: "TOO_LARGE" } };
    try { return { status: response.status, body: text ? JSON.parse(text) : null }; }
    catch { return { status: response.status, body: null }; }
  };
  return {
    ports, service, tickOnce, wake, localTest,
    /** HTTP socket of the module declaring `listen: path`, or null. */
    listener: (path: string) => moduleSupervisor(ports).listener(path),
    async health() {
      let providerHealth = { name: provider?.name ?? "unconfigured", available: false, sandboxed: false };
      try { if (provider) { const h = await provider.health(); providerHealth = { name: provider.name, available: h.available, sandboxed: h.sandboxed }; } } catch { /* Public health never exposes diagnostic secrets. */ }
      let git = false;
      try { git = await Bun.spawn(["git", "--version"], { stdout: "ignore", stderr: "ignore" }).exited === 0; } catch { /* Missing git. */ }
      return { provider: providerHealth, git, moduleSandbox: ports.sandbox?.isolated ?? false };
    },
    start() {
      if (timer || (!options.timers && (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")))) return;
      stopping = false;
      rescue ??= startRescueListener(ports, service, resourcePath("rescue.html", "apps/server/src/static/rescue.html"));
      void moduleSupervisor(ports).start().catch(() => options.onError?.());
      void transport?.start(service, wake).catch(() => options.onError?.());
      const seconds = options.tickSeconds ?? Number(process.env.CHRONA_STEWARD_TICK_SECONDS ?? 30);
      if (Number.isFinite(seconds) && seconds > 0) timer = timers.setInterval(wake, seconds * 1000);
      wake();
    },
    async stop() {
      stopping = true;
      rescue?.stop(true);
      rescue = undefined;
      if (timer) timers.clearInterval(timer);
      timer = undefined;
      await moduleSupervisor(ports).stop();
      await running;
      await Promise.all([...handles].map(async handle => { await handle.abort(); await handle.done; }));
      await transport?.stop();
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
