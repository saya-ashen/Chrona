import { drainTimers, timersSettled } from "../timers/timers";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { StewardPorts } from "../ports";
import { createModules } from "../modules/modules";
import { reconcileAgentStops } from "../agent/agent-recovery";
import { createRuns, liveRuns } from "../execution/runs";
import { audit } from "../audit";
import { diagnosticText } from "../modules/module-diagnostics";
import { callsSettled, drainCalls } from "../modules/module-calls";
import { createProviderChannel } from "../agent/provider-channel";
import { providerStartGate } from "../agent/provider-start";
import { startLocalProvider } from "../execution/local-runtime";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { refreshInstallationReceipts } from "../modules/module-install";
import { pruneHistory } from "../retention";
import { collectStore } from "../store-gc";

import { contextRunTools } from "../agent/agent-context-tools";
import { contextRunImages } from "../agent/agent-context-read";

type ClaimedRun = NonNullable<Awaited<ReturnType<ReturnType<typeof createRuns>["claimNext"]>>>;
type PendingFinalization = { run: ClaimedRun; outcome: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>; stopEvidence?: "provider_exited" };
async function finishProvider(ports: StewardPorts, pending: Map<string, PendingFinalization>, entry: PendingFinalization) {
  const { run, outcome, stopEvidence } = entry;
  try { await createRuns(ports, run.workspaceId).finish(run.id, outcome, { stopEvidence }); }
  catch (error) {
    pending.set(run.id, entry);
    console.error(JSON.stringify({ component: "tick", event: "run_finalize_failed", runId: run.id,
      error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
    await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_finalize_failed", subjectId: run.id, details: {} }).catch(error => {
      console.error(JSON.stringify({ component: "tick", event: "finalization_audit.failed", runId: run.id,
        error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
    });
  }
}
function finalizeProvider(ports: StewardPorts, run: ClaimedRun, channel: ReturnType<typeof createProviderChannel>,
  handle: ReturnType<ProviderAdapter["start"]>, pending: Map<string, PendingFinalization>) {
  // Only the actual Provider handle proves process exit; the start gate may resolve before launch.
  return handle.done.then(async outcome => {
    try { await channel.close(); }
    catch (error) {
      console.error(JSON.stringify({ component: "tick", event: "interaction_persistence.failed", runId: run.id,
        error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
      outcome = { ...outcome, outcome: "failed", error: "Execution interaction persistence failed" };
    }
    await finishProvider(ports, pending, { run, outcome, stopEvidence: "provider_exited" });
  }, async error => {
    console.error(JSON.stringify({ component: "tick", event: "provider_completion.failed", runId: run.id,
      error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
    try { await channel.close(); } finally { await finishProvider(ports, pending, { run, outcome: { outcome: "failed", sessionId: null,
      error: "Provider completion failed" } }); }
  }).catch(async error => {
    console.error(JSON.stringify({ component: "tick", event: "run_finalize_failed", runId: run.id,
      error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
    await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_finalize_failed", subjectId: run.id, details: {} }).catch(error => {
      console.error(JSON.stringify({ component: "tick", event: "finalization_audit.failed", runId: run.id,
        error: diagnosticText(String(error).replaceAll(run.token, "[Redacted]"), 2000) }));
    });
  });
}
function startInstallCheck(ports: StewardPorts, installChecks: Map<string, Promise<void>>, checkFailures: Map<string, unknown>,
  workspaceId: string, now: Date) {
    if (installChecks.has(workspaceId)) return;
    installChecks.set(workspaceId, createModules(ports, workspaceId).buildPending(now).then(() => undefined, error => {
      checkFailures.set(workspaceId, error); }).finally(() => { installChecks.delete(workspaceId); }));
  }
export function createTick(ports: StewardPorts) {
  const installChecks = new Map<string, Promise<void>>(), checkFailures = new Map<string, unknown>();
  const finalizers = new Set<Promise<unknown>>();
  const pendingFinalizations = new Map<string, PendingFinalization>();
  async function tick(now = ports.now()) {
    const failures: { workspaceId: string; stage: string; error: unknown }[] = [...checkFailures].map(([workspaceId, error]) => ({
      workspaceId, stage: "modules", error }));
    checkFailures.clear();
    // A backlog pass can take ~100 s on a large DB (measured); never hold up runs and timers for it.
    void pruneHistory(ports.db, now).catch(error => console.error(JSON.stringify({ component: "retention", event: "prune_failed",
      error: String(error).slice(0, 300) })));
    void collectStore(ports, now).catch(function (error) {
      console.error(JSON.stringify({ component: "store-gc", event: "collect_failed", error: String(error).slice(0, 300) }));
    });
    for (const workspace of await ports.db.workspace.findMany()) {
      const workspaceId = workspace.id, runs = createRuns(ports, workspaceId);
      async function runInput(run: NonNullable<Awaited<ReturnType<typeof runs.claimNext>>>) {
        const sessionId = run.session?.providerSessionId ?? null;
        const context = await genericInput(ports, run, sessionId);
        if (context) return context;
        throw new Error("Run requires an application-owned Agent context");
      }
      function providerInput(run: ClaimedRun, lane: "foreground" | "background", sessionDir: string, ordinary: Awaited<ReturnType<typeof runInput>>) {
        return { runId: run.id, token: run.token, lane, cwd: run.cwd, sessionDir, sessionId: ordinary.sessionId,
          prompt: ordinary.prompt, systemPrompt: ordinary.systemPrompt, resources: ordinary.resources, images: ordinary.images, deadline: run.deadlineAt,
          hostPaths: ordinary.hostPaths, content: ordinary.content };
      }
      async function launchLocal(run: ClaimedRun, lane: "foreground" | "background") {
          const gate = providerStartGate();
          liveRuns.set(run.id, gate.handle);
          try {
            const ordinary = await runInput(run);
            const sessionDir = join(ports.dataDir, "sessions", run.sessionId!, ".chrona", "sessions");
            await mkdir(sessionDir, { recursive: true });
            if (!await ports.db.agentRunProvider.findUnique({ where: { runId: run.id } })) { gate.fail(); await runs.finish(run.id, {
              outcome: "unavailable", sessionId: null, error: "Provider unconfigured" }, { stopEvidence: "never_started" }); return; }
            const channel = createProviderChannel(ports, run);
            let handle;
            try {
              await runs.authenticate(run.token);
              if (gate.stopped()) {
                await channel.close();
                await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Provider launch cancelled" }, { stopEvidence: "never_started" });
                return;
              }
              const input = providerInput(run, lane, sessionDir, ordinary);
              handle = await startLocalProvider(ports, workspaceId, { ...input, events: channel.events });
            } catch (error) { await channel.close(); throw error; }
            gate.attach(handle);
            const finalized = finalizeProvider(ports, run, channel, handle, pendingFinalizations);
            finalizers.add(finalized);
            void finalized.finally(() => finalizers.delete(finalized));
            if (gate.stopped()) await handle.abort();
          } catch (error) {
            gate.fail();
            const launched = await ports.db.providerLaunch.findUnique({ where: { runId: run.id } });
            if (!launched) liveRuns.delete(run.id);
            await runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: `Provider could not start: ${String(error).slice(0,
              300)}` }, launched ? {} : { stopEvidence: "never_started" });
          }
      }
      async function launch() {
        for (const lane of ["foreground", "background"] as const) {
          const run = await runs.claimNext(lane, now);
          if (run) await launchLocal(run, lane);
        }
      }
      for (const [stage, action] of [
        // Keep unrelated startup stages running even if one shipped app fails registration.
        ["installations", async () => { await refreshInstallationReceipts(ports, workspaceId); }],
        ["modules", async () => { await createModules(ports, workspaceId).recoverMigrations(now); startInstallCheck(ports, installChecks,
          checkFailures, workspaceId, now); }],
        ["timers", async () => { void drainTimers(ports, workspaceId, now).catch(error => { checkFailures.set(workspaceId, error); }); }],
        ["finalize", async () => {
          for (const entry of [...pendingFinalizations.values()]) if (entry.run.workspaceId === workspaceId) {
            pendingFinalizations.delete(entry.run.id);
            await finishProvider(ports, pendingFinalizations, entry);
          }
        }],
        ["reconcile", async () => { await reconcileAgentStops(ports, workspaceId); }],
        ["launch", launch], ["expire", async () => { await runs.expireLeases(now); }],
        // Routed async calls (notifications among them) are delivered beside the tick.
        ["calls", async () => { void drainCalls(ports, workspaceId).catch(error => console.error(JSON.stringify({ component: "tick",
          event: "drain_calls.failed", workspaceId: workspaceId, error: String(error).slice(0, 2000) }))); }],
      ] as const) {
        try { await action(); } catch (error) { failures.push({ workspaceId, stage, error }); }
      }
      try { await ports.db.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, lastTickAt: now }, update: { lastTickAt: now } }); }
      catch (error) { failures.push({ workspaceId, stage: "lastTickAt", error }); }
    }
    return { failures };
  }
  return Object.assign(tick, { settled: async ({ includeRuns = false } = {}) => {
    await Promise.all([...installChecks.values(), ...(includeRuns ? finalizers : []), timersSettled(ports)]);
    await callsSettled(ports);
  } });
}

async function genericInput(ports: StewardPorts, run: ClaimedRun, sessionId: string | null) {
  const tools = await contextRunTools(ports, run);
  if (!tools) return null;
  return { images: await contextRunImages(ports, run), prompt: run.prompt, inbound: null,
    sessionId, hostPaths: [], content: [], systemPrompt: "", resources: "configured" as const };
}
