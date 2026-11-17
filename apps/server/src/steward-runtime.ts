import { createModuleRuntimePorts } from "@chrona/host";
import type { PrismaClient } from "@chrona/db";
import { registeredProviderHealth, stopAgentRuns, moduleSupervisor, createStewardService, createExternalModuleInstaller, type StewardPorts } from "@chrona/kernel";
import { redactSensitiveValue } from "@chrona/logging/redaction";

let gitAvailable: Promise<boolean> | undefined;
function probeGit() {
  return gitAvailable ??= (async () => {
    try { return await Bun.spawn(["git", "--version"], { stdout: "ignore", stderr: "ignore" }).exited === 0; }
    catch (error) {
      console.error(JSON.stringify({ component: "server", event: "git_probe_failed", error: redactSensitiveValue(error) }));
      return false;
    }
  })();
}

type RuntimeOptions = {
  dataDir?: string;
  port?: number;
  now?: () => Date;
  tickSeconds?: number;
  onError?: (error: unknown) => void;
  sandbox?: StewardPorts["sandbox"];
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
};
export function createStewardRuntime(db: PrismaClient, options: RuntimeOptions = {}) {
  let stopping = false, pending = false;
  const ports: StewardPorts = {
    ...createModuleRuntimePorts(db, options),
    kernelUrl: options.port ? `http://127.0.0.1:${options.port}` : undefined,
    onQueued: () => tickOnce(), onRunFinished: async () => { wake(); },
  };
  function reportError(error: unknown, event = "tick_failed") {
    console.error(JSON.stringify({ component: "runtime", event, error: redactSensitiveValue(error) }));
    options.onError?.(error);
  }
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  const service = createStewardService(ports), timers = options.timers ?? globalThis;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  const canTick = () => pending && !stopping;
  function tickOnce(): Promise<void> {
    if (stopping) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = (async () => {
      while (canTick()) {
        pending = false;
        try { for (const failure of (await service.tick()).failures) reportError(failure.error); }
        catch (error) { reportError(error); }
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
      let providerHealth = { name: "registered", available: false, sandboxed: false };
      try { providerHealth = await registeredProviderHealth(ports); }
      catch (error) { reportError(error, "provider_health_failed"); }
      const git = await probeGit();
      return { provider: providerHealth, git, moduleSandbox: ports.sandbox?.isolated ?? false };
    },
    start() {
      if (timer || (!options.timers && (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")))) return;
      stopping = false;
      starting = moduleSupervisor(ports).start().catch(error => reportError(error, "supervisor_start_failed"));
      const seconds = options.tickSeconds ?? Number(process.env.CHRONA_STEWARD_TICK_SECONDS ?? 30);
      if (Number.isFinite(seconds) && seconds > 0) timer = timers.setInterval(wake, seconds * 1000);
      wake();
    },
    async stop() {
      stopping = true;
      if (timer) timers.clearInterval(timer);
      timer = undefined;
      await running;
      await starting;
      await stopAgentRuns(ports);
      await service.tick.settled({ includeRuns: true });
      await moduleSupervisor(ports).stop();
      await service.tick.settled({ includeRuns: true });
    },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
