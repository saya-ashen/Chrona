import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import type { StewardPorts } from "./ports";
import { createSchedules } from "./schedules";
import { drainSchedules, schedulesSettled } from "./schedule-delivery";
import { createModules } from "./modules";
import { registerBuiltins } from "./module-builtin";
import { createRuns, liveRuns } from "./runs";
import { notificationSettings } from "./settings";
import { audit } from "./audit";
import { hostPathsFor } from "./grants";
import { chatFilesDir, chatImages } from "./chat";
import { announceApprovals, forwardSettings } from "./notify-user";
import { autoRetain, memoryInput } from "./memory";
import { callsSettled, drainCalls } from "./module-calls";
import { z } from "zod";
import { createProviderChannel } from "./provider-channel";
import { providerStartGate } from "./provider-start";
import { moduleToolCatalog, moduleToolsets } from "./module-tools";
import { BUILD_MODULE_TOOLS, BUILD_REFERENCE_PROMPT } from "./module-reference";
import { EXECUTOR_LIMITS, isEntryModule, moduleManifestSchema, type ProviderAdapter } from "@chrona/contracts/steward";
import { storedAttachments } from "./store";
import { retireReflection } from "./reflection-retirement";
import { moduleIdentity } from "./module-identity";
import { refreshInstallationReceipts } from "./module-install";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { executionRunInput } from "./execution-context";
import { captureExecutionChanges } from "./execution-result";

import { STEWARD_PROMPT } from "./run-instructions";

type ClaimedRun = NonNullable<Awaited<ReturnType<ReturnType<typeof createRuns>["claimNext"]>>>;
async function focusedHostPaths(ports: StewardPorts, workspaceId: string, focus: unknown, now: Date) {
  const names = Array.isArray(focus) ? focus.filter((name): name is string => typeof name === "string") : [];
  const modules = await ports.db.module.findMany({ where: { workspaceId, name: { in: names } }, select: { id: true } });
  return hostPathsFor(ports.db, workspaceId, modules.map(module => module.id), now);
}
async function runInbound(ports: StewardPorts, workspaceId: string, run: ClaimedRun, messages: Awaited<ReturnType<StewardPorts["db"]["message"]["findMany"]>>) {
  const source = await ports.db.audit.findFirst({ where: { workspaceId, kind: "chat_run_input", subjectId: run.id }, orderBy: { createdAt: "desc" } });
  const messageId = z.object({ messageId: z.string() }).safeParse(source?.details).data?.messageId;
  return messageId ? ports.db.message.findFirst({ where: { id: messageId, workspaceId, sessionId: run.sessionId ?? undefined, direction: "in" } }) : messages.findLast(m => m.direction === "in");
}
async function moduleContext(ports: StewardPorts, workspaceId: string, now: Date, entryModuleId: string | null | undefined) {
  const self: { name: string; description?: string; entry: boolean; origin: "builtin" | "external"; capabilities: ReturnType<typeof moduleIdentity>["capabilities"]; status: string; lastError?: { at: string; error: string } }[] = [];
  let via: string | undefined;
  for (const module of await ports.db.module.findMany({ where: { workspaceId, activeHash: { not: null } }, orderBy: { name: "asc" } })) {
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (!manifest) continue;
    const entry = isEntryModule(manifest);
    if (module.id === entryModuleId) via = module.name;
    const failed = await ports.db.moduleRun.findFirst({ where: { moduleId: module.id, error: { not: null }, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }, orderBy: { createdAt: "desc" } });
    self.push({ ...moduleIdentity(module, { configurable: Object.keys(manifest.settings).length > 0, removable: !entry }), name: module.name, ...(manifest.description ? { description: manifest.description } : {}), entry, status: module.status, ...(failed ? { lastError: { at: failed.createdAt.toISOString(), error: failed.error!.slice(0, 300) } } : {}) });
  }
  return { self, via };
}
/** Build runs: their whole instruction was written when queued; they find app tools like a conversation. */
function closedInput(run: ClaimedRun, sessionId: string | null) {
  const base = { inbound: null, searchTools: false, sessionId, hostPaths: [], content: [] };
  if (run.session?.source === "build") return { ...base, searchTools: true, prompt: `${run.prompt}\n\n${BUILD_REFERENCE_PROMPT}`, extraTools: BUILD_MODULE_TOOLS };
  return null;
}
function finalizeProvider(ports: StewardPorts, run: ClaimedRun, channel: ReturnType<typeof createProviderChannel>, handle: ReturnType<ProviderAdapter["start"]>, execution: boolean) {
  const runs = createRuns(ports, run.workspaceId);
  // Only the actual Provider handle proves process exit; the start gate may resolve before launch.
  return handle.done.then(async outcome => {
    try { await channel.close(); }
    catch { outcome = { ...outcome, outcome: "failed", error: "Execution interaction persistence failed" }; }
    if (execution) {
      try { await captureExecutionChanges(ports, run.id); }
      catch {
        // The Provider has exited even if the result sidecar could not be written.
        await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "execution_capture_failed", subjectId: run.id, details: {} }).catch(() => {});
      }
    }
    await runs.finish(run.id, outcome, execution ? { stopEvidence: "provider_exited" } : undefined);
  }, async () => {
    try { await channel.close(); } finally { await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Provider completion failed" }); }
  }).then(() => execution ? undefined : autoRetain(ports, run.workspaceId, run.sessionId)).catch(async () => {
    try { await audit(ports.db, { workspaceId: run.workspaceId, actor: "chrona", kind: "run_finalize_failed", subjectId: run.id, details: {} }); } catch { /* Lease expiry is the recovery path. */ }
  });
}
async function launchDeviceRuns(ports: StewardPorts, workspaceId: string, now: Date) {
  if (!ports.executorProvider || !ports.executorAdmission) return;
  const runs = createRuns(ports, workspaceId);
  const devices = await ports.db.executionExecutor.findMany({ where: { workspaceId, revokedAt: null }, select: { id: true }, take: EXECUTOR_LIMITS.assignmentRecords, orderBy: { id: "asc" } });
  for (const device of devices) {
    const online = await ports.db.$transaction(tx => ports.executorAdmission!.online(tx, { executorId: device.id, now }));
    if (!online) continue;
    for (let index = 0; index < EXECUTOR_LIMITS.codingEnvironment; index++) {
      const run = await runs.claimNext("background", now, { kind: "execution", executorId: device.id });
      if (!run) break;
      const attempt = await ports.db.executionAttempt.findUniqueOrThrow({ where: { runId: run.id } });
      // This handle observes the existing remote assignment; it neither starts nor stops an OS process.
      const handle = ports.executorProvider.start({ runId: run.id, token: run.token, lane: "background", cwd: run.cwd, sessionDir: run.cwd,
        sessionId: null, prompt: run.prompt, systemPrompt: "", resources: "minimal", deadline: run.deadlineAt,
        execution: { workId: attempt.workId, sessionId: run.sessionId!, runId: run.id, attemptId: attempt.id } });
      liveRuns.set(run.id, handle);
      // Remote completion already committed Q's original final; no local capture/finish or shutdown wait.
      void handle.done.then(() => { if (liveRuns.get(run.id) === handle) liveRuns.delete(run.id); }).catch(() => {});
    }
  }
}

function startBuild(ports: StewardPorts, builds: Map<string, Promise<void>>, buildFailures: Map<string, unknown>, workspaceId: string, now: Date) {
    if (builds.has(workspaceId)) return;
    builds.set(workspaceId, createModules(ports, workspaceId).buildPending(now).then(() => undefined, error => { buildFailures.set(workspaceId, error); }).finally(() => { builds.delete(workspaceId); }));
  }
export function createTick(ports: StewardPorts) {
  const builds = new Map<string, Promise<void>>(), buildFailures = new Map<string, unknown>();
  const finalizers = new Set<Promise<unknown>>();
  async function tick(now = ports.now()) {
    const failures: { workspaceId: string; stage: string; error: unknown }[] = [...buildFailures].map(([workspaceId, error]) => ({ workspaceId, stage: "modules", error }));
    buildFailures.clear();
    for (const workspace of await ports.db.workspace.findMany()) {
      const workspaceId = workspace.id, runs = createRuns(ports, workspaceId);
      async function runInput(run: NonNullable<Awaited<ReturnType<typeof runs.claimNext>>>) {
        const sessionId = run.session?.providerSessionId ?? null;
        const closed = closedInput(run, sessionId);
        if (closed) return closed;
        const messages = run.sessionId ? (await ports.db.message.findMany({ where: { workspaceId, sessionId: run.sessionId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 20 })).reverse() : [];
        const preferences = await ports.db.preference.findMany({ where: { workspaceId }, select: { text: true } });
        const agenda = await ports.db.schedule.findMany({ where: { workspaceId, originSessionId: run.sessionId, status: "active" }, take: 50 });
        const contextMessages = messages.map(m => ({ ...m, attachments: storedAttachments(m.attachments) }));
        const inbound = await runInbound(ports, workspaceId, run, messages);
        // v2-21: memory tools and instructions only with a provider; a conversation's first run gets what was recalled.
        const memory = await memoryInput(ports, workspaceId, run.session, messages);
        const catalog = (await moduleToolCatalog(ports, run)).filter(tool => !memory.hidden.includes(tool.name)), toolsets = moduleToolsets(catalog);
        const extraTools = catalog.filter(tool => tool.exposure === "direct").map(tool => tool.name);
        const hostPaths = await focusedHostPaths(ports, workspaceId, run.session?.focus, now);
        // The only directory mounted into runs: the conversations' files, read-only (v2-8).
        await mkdir(chatFilesDir(ports), { recursive: true });
        const content = [{ name: "chat", dir: chatFilesDir(ports), writable: false }];
        // Current app capabilities determine which app can handle a need; built-ins require a release to change code.
        const { self, via } = await moduleContext(ports, workspaceId, now, run.session?.entryModuleId);
        const timezone = notificationSettings(workspace.settings).timezone;
        const prompt = `${memory.text}\n\nContext (data):\n${JSON.stringify({ messages: contextMessages, preferences, agenda, focus: run.session?.focus, now: now.toISOString(), timezone })}\n\nChrona modules (data; this conversation's source: ${JSON.stringify({ session: run.session?.source ?? null, viaModule: via ?? null })}):\n${JSON.stringify(self)}\n\nModule toolsets (data; load deferred m_* tools with tool_search):\n${JSON.stringify(toolsets.slice(0, 30))}\n\nApproved host paths (data; this host is ${JSON.stringify(hostname())}, so its files are reached with chrona_request_path_access, not SSH):\n${JSON.stringify(hostPaths)}\n\nTrigger: ${run.trigger}\n${run.prompt}`;
        return { prompt, inbound, extraTools, searchTools: toolsets.length > 0, sessionId, hostPaths, content };
      }
      function providerInput(run: ClaimedRun, lane: "foreground" | "background" | "build", sessionDir: string, execution: Awaited<ReturnType<typeof executionRunInput>>, ordinary: Awaited<ReturnType<typeof runInput>> | null) {
        if (execution) return (({ onInteraction: _observer, ...input }) => input)(execution);
        return { runId: run.id, token: run.token, lane, cwd: run.cwd, sessionDir, sessionId: ordinary!.sessionId,
          prompt: ordinary!.prompt, systemPrompt: STEWARD_PROMPT, resources: "configured" as const, images: chatImages(ordinary!.inbound?.attachments ?? []), deadline: run.deadlineAt,
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
            if (!ports.provider) { gate.fail(); await runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: "Provider unconfigured" }); return; }
            const channel = createProviderChannel(ports, run, execution?.onInteraction);
            let handle;
            try {
              await runs.authenticate(run.token);
              if (gate.stopped()) { await channel.close(); return; }
              const input = providerInput(run, lane, sessionDir, execution, ordinary);
              handle = ports.provider.start({ ...input, events: channel.events });
            } catch (error) { await channel.close(); throw error; }
            gate.attach(handle);
            const finalized = finalizeProvider(ports, run, channel, handle, !!execution);
            finalizers.add(finalized);
            void finalized.finally(() => finalizers.delete(finalized));
          } catch (error) {
            gate.fail();
            await runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: `Provider could not start: ${String(error).slice(0, 300)}` });
          }
      }
      async function launch() {
        for (const lane of ["foreground", "background", "build"] as const) {
          const run = await runs.claimNext(lane, now, { kind: "ordinary" });
          if (run) await launchLocal(run, lane);
        }
        if (ports.provider) for (let index = 0; index < EXECUTOR_LIMITS.codingEnvironment; index++) {
          const run = await runs.claimNext("background", now, { kind: "execution", executorId: "server" });
          if (!run) break;
          await launchLocal(run, "background");
        }
        await launchDeviceRuns(ports, workspaceId, now);
      }
      for (const [stage, action] of [
        // notify keeps its own copy of the owner's notification settings: a new install or data directory gets the current ones.
        ["builtins", async () => { await registerBuiltins(ports, workspaceId); }],
        // Keep unrelated startup stages running even if one shipped app fails registration.
        ["initialization", async () => { await refreshInstallationReceipts(ports, workspaceId); await ensureWorkspaceInitialized(ports, workspaceId); }],
        ["notification-settings", () => forwardSettings(ports.db, ports, workspaceId, notificationSettings(workspace.settings), workspace.updatedAt)],
        ["retire-reflection", () => retireReflection(ports, workspaceId)],
        ["modules", async () => { await createModules(ports, workspaceId).recoverMigrations(now); startBuild(ports, builds, buildFailures, workspaceId, now); }],
        ["schedules", async () => {
          await createSchedules(ports, workspaceId).fireDue(now, { waitForDelivery: false });
          void drainSchedules(ports, workspaceId, now).catch(error => { buildFailures.set(workspaceId, error); });
        }],
        ["launch", launch], ["expire", async () => { await runs.expireLeases(now); }],
        ["approvals", () => announceApprovals(ports, workspaceId)],
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
    await Promise.all([...builds.values(), ...(includeRuns ? finalizers : []), schedulesSettled(ports)]);
    await callsSettled(ports);
  } });
}
