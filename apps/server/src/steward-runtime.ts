import type { PrismaClient } from "@chrona/db";
import { createStewardService, type StewardPorts, type StewardService } from "@chrona/engine";
import { RUN_LIMITS, type DeliveryAdapter } from "@chrona/contracts/steward";
import { createScriptSandbox, createChinoServiceHealthSource, createInAppDelivery, createPiAssessor, createRuleAssessor, createTestDelivery, createPiAgentRunner, resolvePiAgentExtension } from "@chrona/integrations/steward";
import { createScopedTestSource } from "./steward-test-source";
import { createStewardTestAgent } from "./steward-test-agent";
import { createStewardQqBot } from "./steward-qq-bot";
import { createAgentSlot, createStewardAgentLoop, type AffairAgent } from "./steward-agent-loop";

type RuntimeAgent = AffairAgent & Pick<NonNullable<StewardPorts["agent"]>, "runConcierge">;
/** E6c attaches transport to this service, never constructs another engine. */
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
function piAgent(port: number | undefined, isStopping: () => boolean): RuntimeAgent | null {
  if (process.env.CHRONA_STEWARD_AGENT !== "pi") return null;
  const extensionPath = resolvePiAgentExtension();
  if (!extensionPath || !port) return null;
  const runner = createPiAgentRunner({ extensionPath, agentUrl: `http://127.0.0.1:${port}/api/steward-agent`,
    command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
    webExtensionPath: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION, timeoutMs: RUN_LIMITS.affairTimeoutMs });
  return {
    runAffair: input => runner.run({ role: "affair", token: input.token, deadlineAt: input.deadline, shouldStop: input.shouldStop }),
    async runConcierge(input) {
      const result = await runner.run({ role: "concierge", token: input.token, deadlineAt: input.deadline, shouldStop: async () => isStopping() });
      if (result.outcome !== "exited") throw new Error("Agent unavailable");
    },
  };
}

function testRoutesEnabledFromEnv() {
  return ["1", "true"].includes(process.env.CHRONA_E2E_TEST_ROUTES?.trim().toLowerCase() ?? "");
}

function runtimeSources(testRoutesEnabled: boolean, localSource: ReturnType<typeof createScopedTestSource> | undefined) {
  return [...(localSource ? [localSource.adapter] : []), ...(!testRoutesEnabled && process.env.CHRONA_STEWARD_CHINO_DASHBOARD_URL ? [createChinoServiceHealthSource({ url: process.env.CHRONA_STEWARD_CHINO_DASHBOARD_URL })] : [])];
}

function runtimeAssessor(testRoutesEnabled: boolean, available: () => boolean) {
  return !testRoutesEnabled && process.env.CHRONA_STEWARD_ASSESSOR === "pi"
    ? createPiAssessor({ command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL })
    : createRuleAssessor({ available });
}

function runtimeTransport(db: PrismaClient, testRoutesEnabled: boolean, now: (() => Date) | undefined, transport: StewardChatTransport | undefined) {
  return transport ?? (testRoutesEnabled ? undefined : createStewardQqBot({ db, publicUrl: publicOrigin(), now }) ?? undefined);
}

function runtimeAgent(override: RuntimeAgent | null | undefined, testRoutesEnabled: boolean, scripted: RuntimeAgent, port: number | undefined, isStopping: () => boolean) {
  return override === undefined ? (testRoutesEnabled ? scripted : piAgent(port, isStopping)) : override;
}

/** One service owns all capability state; routes, workers and chat share it. */
export function createStewardRuntime(db: PrismaClient, options: {
  now?: () => Date; onError?: () => void; port?: number; agent?: RuntimeAgent | null;
  chatTransport?: StewardChatTransport; tickSeconds?: number;
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
} = {}) {
  const testRoutesEnabled = testRoutesEnabledFromEnv();
  const localSource = testRoutesEnabled ? createScopedTestSource(db) : undefined;
  const delivery = testRoutesEnabled ? createTestDelivery() : undefined;
  const transport = runtimeTransport(db, testRoutesEnabled, options.now, options.chatTransport);
  let available = true, stopping = false;
  let testAgentInstalled = false;
  const scripted = createStewardTestAgent(() => service);
  const active = runtimeAgent(options.agent, testRoutesEnabled, {
    async runConcierge(input: Parameters<typeof scripted.runConcierge>[0]) { if (!testAgentInstalled) throw new Error("Test agent not installed"); await scripted.runConcierge(input); },
    async runAffair(input: Parameters<typeof scripted.runAffair>[0]) { if (!testAgentInstalled) throw new Error("Test agent not installed"); await scripted.runAffair(input); },
  }, options.port, () => stopping);
  // Each role has its own single-process lane; chat never waits for affair work.
  const slot = createAgentSlot();
  const conciergeRuns = new Set<Promise<void>>();
  const ports: StewardPorts = {
    sandbox: createScriptSandbox({ bwrapPath: process.env.CHRONA_STEWARD_SANDBOX_BWRAP }),
    db, now: options.now ?? (() => new Date()), publicUrl: publicOrigin(),
    sources: runtimeSources(testRoutesEnabled, localSource),
    assessor: runtimeAssessor(testRoutesEnabled, () => available),
    deliveries: [delivery?.adapter ?? createInAppDelivery(), ...(transport ? [transport.delivery] : [])],
    chat: transport ? { channel: "chrona_qqbot", bound: () => transport.bound() } : null,
    agentHealth: () => !active && process.env.CHRONA_STEWARD_AGENT !== "pi"
      ? { available: false, name: "none", lastError: "Agent 未启用" }
      : { available: !!active && !stopping, name: "pi", lastError: agent.status().lastError },
    agent: active ? {
      async runAffair(input) { await slot("affair", () => active.runAffair({ ...input, shouldStop: async () => stopping || service.runs.shouldStop(input.runId) })); },
      runConcierge: input => {
        const pending = slot("concierge", async () => {
          if (stopping || input.deadline <= ports.now()) throw new Error("Agent unavailable");
          await active.runConcierge(input);
        });
        conciergeRuns.add(pending);
        return pending.finally(() => { conciergeRuns.delete(pending); });
      },
    } : null,
  };
  const service = createStewardService(ports);
  const agent = createStewardAgentLoop({ service, agent: active, slot, onError: options.onError });
  const timers = options.timers ?? globalThis;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  function tickOnce(): Promise<void> {
    if (running) return running;
    running = service.tick().then(result => {
      if (result.failures.length) options.onError?.();
      void agent.runAgentOnce();
    }).catch(() => options.onError?.()).finally(() => { running = undefined; });
    return running;
  }
  return {
    ports, service, agent, localSource, delivery, tickOnce,
    installTestAgent() { if (!testRoutesEnabled) throw new Error("Test seam disabled"); testAgentInstalled = true; },
    async driveTestTick() { const result = await service.tick(); await agent.runAgentOnce(); await service.tick(); return result; },
    setAvailable(value: boolean) { available = value; },
    start() {
      if (timer || (!options.timers && (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" || process.argv.includes("test")))) return;
      stopping = false;
      agent.start();
      void transport?.start(service, () => { void agent.runAgentOnce(); }).catch(() => options.onError?.());
      const seconds = options.tickSeconds ?? Number(process.env.CHRONA_STEWARD_TICK_SECONDS ?? 60);
      if (Number.isFinite(seconds) && seconds > 0) timer = timers.setInterval(() => { void tickOnce(); }, seconds * 1000);
    },
    async stop() { stopping = true; if (timer) timers.clearInterval(timer); timer = undefined; await Promise.all([running, agent.stop(), transport?.stop(), ...[...conciergeRuns].map(run => run.catch(() => undefined))]); },
  };
}
export type StewardRuntime = ReturnType<typeof createStewardRuntime>;
