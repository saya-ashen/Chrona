import { drainTimers, timersSettled } from "./timers";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { StewardPorts } from "./ports";
import { drainSchedules, schedulesSettled } from "./schedule-delivery";
import { createModules } from "./modules";
import { registerBuiltins } from "./module-builtin";
import { reconcileAgentStops } from "./agent-recovery";
import { createRuns, liveRuns } from "./runs";
import { audit } from "./audit";
import { callsSettled, drainCalls } from "./module-calls";
import { createProviderChannel } from "./provider-channel";
import { providerStartGate } from "./provider-start";
import { startLocalProvider, runtimeCall } from "./local-runtime";
import { registerWorkspaceModule } from "./local-workspace";
import { BUILD_MODULE_TOOLS, BUILD_REFERENCE_PROMPT } from "./module-reference";
import { KERNEL_EXECUTION_LIMITS, type ProviderAdapter } from "@chrona/contracts/steward";
import { refreshInstallationReceipts } from "./module-install";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { executionRunInput } from "./execution-context";
import { pruneHistory } from "./retention";

import { contextRunTools } from "./agent-context-tools";
import { contextRunImages } from "./agent-context-read";
import { STEWARD_PROMPT } from "./run-instructions";

type ClaimedRun = NonNullable<Awaited<ReturnType<ReturnType<typeof createRuns>["claimNext"]>>>;
/** Build runs: their whole instruction was written when queued; they find app tools like a conversation. */
function closedInput(run: ClaimedRun, sessionId: string | null) {
  const base = { inbound: null, searchTools: false, sessionId, hostPaths: [], content: [] };
  if (run.session?.source === "build") return { ...base, searchTools: true, prompt: `${run.prompt}\n\n${BUILD_REFERENCE_PROMPT}`, extraTools: BUILD_MODULE_TOOLS };
  return null;
}
type PendingFinalization = { run: ClaimedRun; outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>; stopEvidence?: "provider_exited" };
async function finishProvider(ports: StewardPorts, pending: Map<string, PendingFinalization>, entry: PendingFinalization) {
  const { run, outcome, stopEvidence } = entry;
  try { await createRuns(ports, run.workspaceId).finish(run.id, outcome, { stopEvidence }); }
  catch {
    pending.set(run.id, entry);
    await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_finalize_failed", subjectId: run.id, details: {} }).catch(() => {});
  }
}
function finalizeProvider(ports: StewardPorts, run: ClaimedRun, channel: ReturnType<typeof createProviderChannel>, handle: ReturnType<ProviderAdapter["start"]>, { pending, execution }: { pending: Map<string, PendingFinalization>; execution: boolean }) {
  // Only the actual Provider handle proves process exit; the start gate may resolve before launch.
  return handle.done.then(async outcome => {
    try { await channel.close(); }
    catch { outcome = { ...outcome, outcome: "failed", error: "Execution interaction persistence failed" }; }
    if (execution) {
      try { registerWorkspaceModule(); await runtimeCall(ports, run.workspaceId, "workspace-local.capture", { runId: run.id }); }
      catch {
        // The Provider has exited even if the result sidecar could not be written.
        await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "execution_capture_failed", subjectId: run.id, details: {} }).catch(() => {});
      }
    }
    await finishProvider(ports, pending, { run, outcome, stopEvidence: "provider_exited" });
  }, async () => {
    try { await channel.close(); } finally { await finishProvider(ports, pending, { run, outcome: { outcome: "failed", sessionId: null, error: "Provider completion failed" } }); }
  }).catch(async () => {
    await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_finalize_failed", subjectId: run.id, details: {} }).catch(() => {});
  });
}
async function claimApplicationRuns(ports: StewardPorts, workspaceId: string, now: Date) {
  const runs = createRuns(ports, workspaceId);
  for (let i = 0; i < KERNEL_EXECUTION_LIMITS.codingGlobal; i++) if (!await runs.claimNext("background", now, { kind: "application" })) break;
}

function startBuild(ports: StewardPorts, builds: Map<string, Promise<void>>, buildFailures: Map<string, unknown>, workspaceId: string, now: Date) {
    if (builds.has(workspaceId)) return;
    builds.set(workspaceId, createModules(ports, workspaceId).buildPending(now).then(() => undefined, error => { buildFailures.set(workspaceId, error); }).finally(() => { builds.delete(workspaceId); }));
  }
export function createTick(ports: StewardPorts) {
  const builds = new Map<string, Promise<void>>(), buildFailures = new Map<string, unknown>();
  const finalizers = new Set<Promise<unknown>>();
  const pendingFinalizations = new Map<string, PendingFinalization>();
  async function tick(now = ports.now()) {
    const failures: { workspaceId: string; stage: string; error: unknown }[] = [...buildFailures].map(([workspaceId, error]) => ({ workspaceId, stage: "modules", error }));
    buildFailures.clear();
    // A backlog pass can take ~100 s on a large DB (measured); never hold up runs and timers for it.
    void pruneHistory(ports.db, now).catch(error => console.error(JSON.stringify({ component: "retention", event: "prune_failed", error: String(error).slice(0, 300) })));
    for (const workspace of await ports.db.workspace.findMany()) {
      const workspaceId = workspace.id, runs = createRuns(ports, workspaceId);
      async function runInput(run: NonNullable<Awaited<ReturnType<typeof runs.claimNext>>>) {
        const sessionId = run.session?.providerSessionId ?? null;
        const context = await genericInput(ports, run, sessionId);
        if (context) return context;
        const closed = closedInput(run, sessionId);
        if (closed) return { ...closed, systemPrompt: STEWARD_PROMPT, resources: "configured" as const, images: [] };
        throw new Error("Run requires an application-owned Agent context or authorized build session");
      }
      function providerInput(run: ClaimedRun, lane: "foreground" | "background" | "build", sessionDir: string, execution: Awaited<ReturnType<typeof executionRunInput>>, ordinary: Awaited<ReturnType<typeof runInput>> | null) {
        if (execution) return (({ onInteraction: _observer, ...input }) => input)(execution);
        return { runId: run.id, token: run.token, lane, cwd: run.cwd, sessionDir, sessionId: ordinary!.sessionId,
          prompt: ordinary!.prompt, systemPrompt: ordinary!.systemPrompt, resources: ordinary!.resources, images: ordinary!.images, deadline: run.deadlineAt,
          model: run.model, extraTools: ordinary!.extraTools, searchTools: ordinary!.searchTools, hostPaths: ordinary!.hostPaths, content: ordinary!.content };
      }
      async function launchLocal(run: ClaimedRun, lane: "foreground" | "background" | "build") {
          const gate = providerStartGate();
          liveRuns.set(run.id, gate.handle);
          try {
            const execution = await executionRunInput(ports, run);
            const ordinary = execution ? null : await runInput(run);
            const sessionDir = execution?.sessionDir ?? join(run.cwd, ".chrona", "sessions");
            await mkdir(sessionDir, { recursive: true });
            if (!ports.provider && !await ports.db.agentRunProvider.findUnique({ where: { runId: run.id } })) { gate.fail(); await runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: "Provider unconfigured" }, { stopEvidence: "never_started" }); return; }
            const channel = createProviderChannel(ports, run, execution?.onInteraction);
            let handle;
            try {
              await runs.authenticate(run.token);
              if (gate.stopped()) { await channel.close(); return; }
              const input = providerInput(run, lane, sessionDir, execution, ordinary);
              handle = await startLocalProvider(ports, workspaceId, { ...input, events: channel.events });
            } catch (error) { await channel.close(); throw error; }
            gate.attach(handle);
            const finalized = finalizeProvider(ports, run, channel, handle, { pending: pendingFinalizations, execution: !!execution });
            finalizers.add(finalized);
            void finalized.finally(() => finalizers.delete(finalized));
            if (gate.stopped()) await handle.abort();
          } catch (error) {
            gate.fail();
            const launched = await ports.db.providerLaunch.findUnique({ where: { runId: run.id } });
            await runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: `Provider could not start: ${String(error).slice(0, 300)}` }, launched ? {} : { stopEvidence: "never_started" });
          }
      }
      async function launch() {
        for (const lane of ["foreground", "background", "build"] as const) {
          const run = await runs.claimNext(lane, now, { kind: "ordinary" });
          if (run) await launchLocal(run, lane);
        }
        for (let index = 0; index < KERNEL_EXECUTION_LIMITS.codingEnvironment; index++) {
          const run = await runs.claimNext("background", now, { kind: "execution", executorId: "server" });
          if (!run) break;
          await launchLocal(run, "background");
        }
        await claimApplicationRuns(ports, workspaceId, now);
      }
      for (const [stage, action] of [
        ["builtins", async () => { await registerBuiltins(ports, workspaceId); }],
        // Keep unrelated startup stages running even if one shipped app fails registration.
        ["initialization", async () => { await refreshInstallationReceipts(ports, workspaceId); await ensureWorkspaceInitialized(ports, workspaceId); }],
        ["modules", async () => { await createModules(ports, workspaceId).recoverMigrations(now); startBuild(ports, builds, buildFailures, workspaceId, now); }],
        ["timers", async () => { void drainTimers(ports, workspaceId, now).catch(error => { buildFailures.set(workspaceId, error); }); }],
        ["schedules", async () => {
          void drainSchedules(ports, workspaceId, now).catch(error => { buildFailures.set(workspaceId, error); });
        }],
        ["finalize", async () => {
          // Retry only persistence, even for unlimited Runs; close/capture already ran once.
          for (const entry of [...pendingFinalizations.values()]) if (entry.run.workspaceId === workspaceId) {
            pendingFinalizations.delete(entry.run.id);
            await finishProvider(ports, pendingFinalizations, entry);
          }
        }],
        ["reconcile", async () => { await reconcileAgentStops(ports, workspaceId); }],
        ["launch", launch], ["expire", async () => { await runs.expireLeases(now); }],
        // Routed async calls (notifications among them) are delivered beside the tick.
        ["calls", async () => { void drainCalls(ports, workspaceId).catch(() => {}); }],
      ] as const) {
        try { await action(); } catch (error) { failures.push({ workspaceId, stage, error }); }
      }
      try { await ports.db.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, lastTickAt: now }, update: { lastTickAt: now } }); }
      catch (error) { failures.push({ workspaceId, stage: "lastTickAt", error }); }
    }
    return { failures };
  }
  return Object.assign(tick, { settled: async ({ includeRuns = false } = {}) => {
    await Promise.all([...builds.values(), ...(includeRuns ? finalizers : []), schedulesSettled(ports), timersSettled(ports)]);
    await callsSettled(ports);
  } });
}

async function genericInput(ports: StewardPorts, run: ClaimedRun, sessionId: string | null) {
  if (!run.sessionId || !await ports.db.agentContext.findUnique({ where: { sessionId: run.sessionId } })) return null;
  return { images: await contextRunImages(ports, run), prompt: run.prompt, inbound: null, extraTools: (await contextRunTools(ports, run))!.catalog.map(tool => tool.name), searchTools: false, sessionId, hostPaths: [], content: [], systemPrompt: "", resources: "configured" as const };
}
