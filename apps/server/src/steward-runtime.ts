import { startRescueListener } from "./rescue";
import { migrateQqState } from "./qq-state-migration";
import { readProtectedSecret } from "../../../packages/integrations/src/steward/protected-secret";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@chrona/db";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { moduleSupervisor, createStewardService, type StewardPorts } from "@chrona/engine";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createStewardE2eProvider } from "./steward-e2e-provider";
import { createPiProvider } from "../../../packages/integrations/src/steward/pi-provider";
import { createScriptSandbox } from "../../../packages/integrations/src/steward/script-sandbox";
import { createModulePackages } from "../../../packages/integrations/src/steward/module-packages";
import { createBrowsers } from "../../../packages/integrations/src/steward/browser";
import { createLogger } from "@chrona/logging";

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
  now?: () => Date; onError?: (error: unknown) => void; port?: number; provider?: ProviderAdapter | null;
  dataDir?: string; tickSeconds?: number; chatTimeoutMs?: number;
  sandbox?: StewardPorts["sandbox"];
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
};
/** Where the Provider's browser comes from (v2-12). */
function providerBrowsers(options: RuntimeOptions) {
  return createBrowsers({
    configured: process.env.CHRONA_STEWARD_BROWSER?.trim() || undefined, dir: resolve(options.dataDir ?? stewardDataDir(), "providers/browser"),
    nix: Bun.which("nix"), nixpkgs: process.env.CHRONA_NIXPKGS?.trim() || undefined,
    onError: error => createLogger("steward.browser").warn("browser.unavailable", { error }),
  });
}
type ExecutionMode = "legacy" | "trusted-local" | "required-isolation";
function executionMode(env = process.env): ExecutionMode {
  const configured = env.CHRONA_STEWARD_EXECUTION_MODE?.trim();
  if (!configured) return "legacy";
  if (configured === "trusted-local" || configured === "required-isolation") return configured;
  throw new Error("Invalid CHRONA_STEWARD_EXECUTION_MODE; use trusted-local or required-isolation");
}
function autoRollback(env = process.env): boolean {
  const configured = env.CHRONA_STEWARD_AUTO_ROLLBACK?.trim();
  if (!configured || configured === "false") return false;
  if (configured === "true") return true;
  throw new Error("Invalid CHRONA_STEWARD_AUTO_ROLLBACK; use true or false");
}
function configuredProvider(options: RuntimeOptions, bwrap: string | undefined, mode: ExecutionMode) {
  if (options.provider === undefined && process.env.CHRONA_E2E_TEST_ROUTES === "1" && process.env.CHRONA_STEWARD_AGENT === "e2e" && options.port) return createStewardE2eProvider(options.port);
  return options.provider === undefined ? (process.env.CHRONA_STEWARD_AGENT === "pi" && options.port ? createPiProvider({
    agentUrl: `http://127.0.0.1:${options.port}/api/steward-agent`,
    chronaExtension: resourcePath(join("external-plugins", "pi-steward-agent", "chrona-tools.ts")),
    command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
    agentDir: process.env.CHRONA_STEWARD_PI_AGENT_DIR ?? resolve(options.dataDir ?? stewardDataDir(), "providers/pi"),
    expectedVersion: process.env.CHRONA_STEWARD_PI_VERSION,
    resourcesFile: process.env.CHRONA_STEWARD_PI_RESOURCES_FILE,
    webExtension: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION, bwrap, executionMode: mode,
    browserExtension: resourcePath(join("external-plugins", "pi-steward-agent", "browser-tools.ts")),
    browsers: providerBrowsers(options),
    workspaceRoot: resolve(options.dataDir ?? stewardDataDir(), "sessions"),
    dataDir: resolve(options.dataDir ?? stewardDataDir()),
  }) : null) : options.provider;
}
/** Kernel-held module credentials (manifest `secrets`); read from protected files only when asked. */
async function configuredSecret(name: string) {
  const appId = process.env.CHRONA_QQ_APP_ID?.trim(), file = process.env.CHRONA_QQ_SECRET_FILE?.trim();
  return name === "qq_bot" && appId && file ? { appId, clientSecret: await readProtectedSecret(file) } : null;
}
export function createStewardRuntime(db: PrismaClient, options: RuntimeOptions = {}) {
  const bwrap = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  const mode = executionMode(), moduleAutoRollback = autoRollback();
  const configured = configuredProvider(options, bwrap, mode);
  const handles = new Set<ReturnType<ProviderAdapter["start"]>>();
  let stopping = false, pending = false;
  const provider: ProviderAdapter | undefined = configured ? { name: configured.name, supportsRunModel: configured.supportsRunModel, health: () => configured.health(), ...(configured.complete ? { complete: configured.complete } : {}), start(input) {
    if (stopping) throw new Error("Runtime stopping");
    const handle = configured.start(input); handles.add(handle);
    void handle.done.finally(() => handles.delete(handle)).catch(() => {});
    return handle;
  } } : undefined;
  const moduleSdk = resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk");
  const moduleTypecheck = resourcePath("module-typecheck", "packages/integrations/src/steward/module-typecheck");
  const scriptSandbox = createScriptSandbox({ bwrapPath: bwrap, executionMode: mode, dataDir: resolve(options.dataDir ?? stewardDataDir()), moduleSdk });
  const sandbox: StewardPorts["sandbox"] = {
    ...scriptSandbox.health, executionMode: mode,
    runModule: input => scriptSandbox.runModule(input),
    startModule: input => scriptSandbox.startModule(input),
  };
  const ports: StewardPorts = {
    db, now: options.now ?? (() => new Date()), dataDir: options.dataDir ?? stewardDataDir(), publicUrl: publicOrigin(), provider,
    secrets: configuredSecret, packages: createModulePackages(),
    sandbox: options.sandbox ?? sandbox, moduleAutoRollback, moduleSdk, moduleTypecheck,
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
        try { for (const failure of (await service.tick()).failures) options.onError?.(failure.error); }
        catch (error) { options.onError?.(error); }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  function wake() { void tickOnce(); }
  return {
    ports, service, tickOnce, wake,
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
      void moduleSupervisor(ports).start().then(() => migrateQqState(db, ports.dataDir)).catch(error => options.onError?.(error));
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
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
