import { startRescueListener } from "./rescue";
import { createModuleRuntimePorts, resourcePath } from "../../../packages/integrations/src/steward/module-runtime";
import type { PrismaClient } from "@chrona/db";
import { createAgentClient, stopAgentRuns, moduleSupervisor, createExecutorAuth, resolveExecutionPrincipal, createStewardService, createExecutions, createExecutionV2Admission, createExecutionWorkspaceCleanup, createExecutionEventStore, createExternalModuleInstaller, CallError, type StewardPorts } from "@chrona/engine";
import { loadExecutionProjects, loadExecutionPlacements } from "./config/execution-projects";
import { createExecutionProjectRegistry } from "./config/execution-project-registry";
import { createServerWorkspacePreparer } from "./execution-server-workspace";
import { createExecutionWorkspaceCleanupHost } from "./execution-workspace-cleanup";
import { installDeviceExecution } from "./execution-device-runtime";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createAgentApplicationHost } from "../../../packages/integrations/src/steward/agent-application-host";

type RuntimeOptions = {
  now?: () => Date; onError?: (error: unknown) => void; port?: number; provider?: ProviderAdapter | null;
  dataDir?: string; tickSeconds?: number; chatTimeoutMs?: number;
  sandbox?: StewardPorts["sandbox"];
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
};
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
  const injected = options.provider;
  const agentApplication = injected === undefined && options.port ? createAgentApplicationHost({ port: options.port, dataDir: options.dataDir }) : undefined;
  const configured = injected ?? (injected === undefined && agentApplication && process.env.CHRONA_STEWARD_AGENT === "pi" ? createAgentClient(() => ports, "pi") : null);
  const handles = new Set<ReturnType<ProviderAdapter["start"]>>();
  let stopping = false, pending = false;
  const provider: ProviderAdapter | undefined = configured ? { name: configured.name, supportsRunModel: configured.supportsRunModel, health: () => configured.health(), ...(configured.complete ? { complete: configured.complete } : {}), ...(configured.transcript ? { transcript: configured.transcript } : {}), start(input) {
    if (stopping) throw new Error("Runtime stopping");
    const handle = configured.start(input); handles.add(handle);
    void handle.done.finally(() => handles.delete(handle)).catch(() => {});
    return handle;
  } } : undefined;
  const ports: StewardPorts = {
    ...createModuleRuntimePorts(db, options), provider, agentApplication,
    chatTimeoutMs: options.chatTimeoutMs,
    onQueued: () => tickOnce(), onRunFinished: async () => { wake(); },
  };
  // Factory closures must use the final runtime ports, including the selected Provider and wake callbacks.
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  ports.executorOwner = executorOwnerPorts(ports);
  const initialize = executionInitialization(ports);
  let projects: ReturnType<typeof loadExecutionProjects> | undefined;
  const registry = createExecutionProjectRegistry(ports.dataDir);
  ports.executionProjects = registry;
  ports.resolveExecutionProject = async (principal, projectRef) => {
    const registered = await registry.resolve(principal, projectRef);
    if (registered) return registered;
    const resolveProject = await (projects ??= loadExecutionProjects(ports.dataDir));
    if (!resolveProject) throw new CallError("forbidden", "Execution projects are not configured");
    return resolveProject(principal, projectRef);
  };
  ports.executionEvents = createExecutionEventStore(ports);
  ports.executions = createExecutions(ports);
  ports.executionV2Admission = createExecutionV2Admission(ports);
  installDeviceExecution(ports);
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
      rescue ??= startRescueListener(service, resourcePath("rescue.html", "apps/server/src/static/rescue.html"));
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
      await stopAgentRuns(ports);
      await Promise.all([...handles].map(async handle => { await handle.abort(); await handle.done; }));
      await service.tick.settled({ includeRuns: true });
      await moduleSupervisor(ports).stop();
      await service.tick.settled({ includeRuns: true });
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
