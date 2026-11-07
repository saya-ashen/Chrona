import { startRescueListener } from "./rescue";
import { join, resolve } from "node:path";
import { createModuleRuntimePorts, stewardDataDir, resourcePath, executionMode } from "../../../packages/integrations/src/steward/module-runtime";
import type { PrismaClient } from "@chrona/db";
import { moduleSupervisor, createExecutorAuth, resolveExecutionPrincipal, createStewardService, createExecutions, createExecutionV2Admission, createExecutionWorkspaceCleanup, createExecutionEventStore, createExternalModuleInstaller, enqueueCall, CallError, type StewardPorts } from "@chrona/engine";
import { loadExecutionProjects, loadExecutionPlacements } from "./config/execution-projects";
import { createServerWorkspacePreparer } from "./execution-server-workspace";
import { createExecutionWorkspaceCleanupHost } from "./execution-workspace-cleanup";
import { installDeviceExecution } from "./execution-device-runtime";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createStewardE2eProvider } from "./steward-e2e-provider";
import { createPiProvider } from "../../../packages/integrations/src/steward/pi-provider";
import { createBrowsers } from "../../../packages/integrations/src/steward/browser";
import { createLogger } from "@chrona/logging";

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
function configuredProvider(options: RuntimeOptions, bwrap: string | undefined, mode: ReturnType<typeof executionMode>) {
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
function executorOwnerPorts(ports: StewardPorts): NonNullable<StewardPorts["executorOwner"]> {
  const auth = createExecutorAuth(ports);
  const owner = async () => {
    if (!await ports.db.workspace.findUnique({ where: { id: "ws_default" }, select: { id: true } })) throw new CallError("unavailable", "Owner workspace unavailable");
    const principal = await resolveExecutionPrincipal(ports, "ws_default", { kind: "owner", via: null });
    return { workspaceId: principal.workspaceId, ownerId: principal.ownerId };
  };
  return {
    async createPairing(input) { return { ...await auth.createPairing(await owner()), label: input.label }; },
    async revoke(input) { return auth.revoke(await owner(), input); },
    async prepareIncarnation(input) { return auth.prepareIncarnation(await owner(), input); },
  };
}
function executionInitialization(ports: StewardPorts) {
  let initialized: Promise<void> | undefined;
  let placements: Awaited<ReturnType<typeof loadExecutionPlacements>>;
  ports.resolveExecutionPlacement = async (principal, placement) => {
    if (!placements) throw new CallError("unavailable", "Execution placements are not initialized or configured");
    return placements(principal, placement);
  };
  ports.executionLocations = async principal => {
    if (!placements) throw new CallError("unavailable", "Execution placements are not initialized or configured");
    return placements.list(principal);
  };
  ports.executionServerWorkspace = createServerWorkspacePreparer(ports.dataDir, ports.now);
  const cleanup = createExecutionWorkspaceCleanup(ports, createExecutionWorkspaceCleanupHost(ports.dataDir));
  ports.executionWorkspaces = { cleanup: cleanup.cleanup };
  ports.executionWorkspaceCleanupTransport = { poll: cleanup.poll, report: cleanup.report };
  return () => initialized ??= (async () => {
    // Configuration I/O precedes every writer transaction; placement resolution uses this host snapshot.
    placements = await loadExecutionPlacements(ports.dataDir);
    await ports.db.executionExecutor.updateMany({ data: { authorizedUntil: null, reconciledAt: null } });
  })();
}
export function createStewardRuntime(db: PrismaClient, options: RuntimeOptions = {}) {
  const bwrap = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  const mode = executionMode();
  const configured = configuredProvider(options, bwrap, mode);
  const handles = new Set<ReturnType<ProviderAdapter["start"]>>();
  let stopping = false, pending = false;
  const provider: ProviderAdapter | undefined = configured ? { name: configured.name, supportsRunModel: configured.supportsRunModel, health: () => configured.health(), ...(configured.complete ? { complete: configured.complete } : {}), ...(configured.transcript ? { transcript: configured.transcript } : {}), start(input) {
    if (stopping) throw new Error("Runtime stopping");
    const handle = configured.start(input); handles.add(handle);
    void handle.done.finally(() => handles.delete(handle)).catch(() => {});
    return handle;
  } } : undefined;
  const ports: StewardPorts = {
    ...createModuleRuntimePorts(db, options), provider,
    chatTimeoutMs: options.chatTimeoutMs,
    onQueued: () => tickOnce(), onRunFinished: async () => { wake(); },
  };
  // Factory closures must use the final runtime ports, including the selected Provider and wake callbacks.
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  ports.executorOwner = executorOwnerPorts(ports);
  const initialize = executionInitialization(ports);
  let projects: ReturnType<typeof loadExecutionProjects> | undefined;
  ports.resolveExecutionProject = async (principal, projectRef) => {
    const resolveProject = await (projects ??= loadExecutionProjects(ports.dataDir));
    if (!resolveProject) throw new CallError("forbidden", "Execution projects are not configured");
    return resolveProject(principal, projectRef);
  };
  ports.executionEvents = createExecutionEventStore(ports);
  ports.executions = createExecutions(ports);
  ports.executionV2Admission = createExecutionV2Admission(ports);
  installDeviceExecution(ports);
  ports.onExecutionFinishedIn = async (tx, workspaceId, runId) => {
    const attempt = await tx.executionAttempt.findUnique({ where: { runId } });
    if (attempt?.moduleId) {
      const module = await tx.module.findUnique({ where: { id: attempt.moduleId } });
      if (module?.name === "coding" && module.status === "active" && module.activeHash === attempt.callerHash) {
        // Queue with the final state; publication runs after commit and never waits behind cancel.
        await enqueueCall({ tx, ports, origin: { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, target: "coding.get", raw: { input: JSON.stringify({ workId: attempt.workId }) } }, { key: `execution-result:${attempt.id}:${attempt.stopConfirmedAt ? "stopped" : "unknown"}` });
      }
    }
  };
  ports.onRunFinished = async () => { wake(); };
  const service = createStewardService(ports), timers = options.timers ?? globalThis;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  let rescue: ReturnType<typeof startRescueListener>;
  let starting: Promise<void> | undefined;
  const canTick = () => pending && !stopping;
  function tickOnce(): Promise<void> {
    if (stopping) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = (async () => {
      await initialize();
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
    ports, service, tickOnce, wake, initialize,
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
      starting = moduleSupervisor(ports).start().catch(error => options.onError?.(error));
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
      await running;
      await starting;
      await Promise.all([...handles].map(async handle => { await handle.abort(); await handle.done; }));
      await service.tick.settled({ includeRuns: true });
      await moduleSupervisor(ports).stop();
      await service.tick.settled({ includeRuns: true });
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
