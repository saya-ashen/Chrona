import { mkdtemp, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listenPaths, moduleManifestSchema, moduleRuntimeParams, RUN_LIMITS, type ModuleCall, type moduleCallReplySchema, type ModuleEvent, type ModuleManifest, type moduleEventReplySchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { moduleModelSettings } from "./settings";
import { registerBuiltins } from "./module-builtin";
import { createModuleChannel } from "./module-channel";
import { diagnosticText, recordModuleFailure, recordModuleRecovery, type ModuleFailureEvidence } from "./module-diagnostics";
import { currentModuleEvolution } from "./module-evolution";
import { moduleFailurePolicy } from "./module-failure-policy";
import { moduleContext } from "./module-context";
import { rollbackFailedStart } from "./module-generation";
import { resolveBuiltinRelease } from "./module-release";
import { assertModuleOperation } from "./module-identity";

type Reply = ReturnType<typeof moduleEventReplySchema.parse>;
/** `chain`/`path`: the routed call path of the event being handled (see module-calls). */
export type CallScope = { workspaceId: string; moduleId: string; hash: string; manifest: ModuleManifest; moduleRunId?: string; eventKey?: string; chain?: string[]; path?: string[] };
type ModuleEffects = {
  handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<ReturnType<typeof moduleCallReplySchema.parse>>;
  pauseFailedModule(tx: Prisma.TransactionClient, ports: StewardPorts, execution: { workspaceId: string; moduleId: string; hash: string; activationId: string | null; triggerId: string; firedAt: Date }, runId: string): Promise<void>;
};
// module-effects routes a module's calls through module-calls, which delivers through this supervisor: it registers here instead of being imported.
let effects: ModuleEffects | undefined;
export function registerModuleEffects(value: ModuleEffects) { effects = value; }
function moduleEffects() {
  if (!effects) throw new Error("Module effects are not registered: import ./module-effects");
  return effects;
}
/** Where a failed delivery stopped: never reached the module, the module answered with an error, or lost after sending. */
export type DeliveryStage = "unavailable" | "handler" | "lost";
function staged(error: unknown, stage: DeliveryStage) {
  const base: Error & { stage?: DeliveryStage } = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { stage: base.stage ?? stage });
}
type Process = ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>>;
type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
type Options = { timers?: Timers; idleMs?: number; backoffMs?: number };
type DeliveryOptions = { chain?: string[]; path?: string[]; timeoutMs?: number; activationId?: string | null; beforeDelivery?: () => Promise<void>; validateResult?: (result: unknown) => string | null };
type Instance = {
  moduleId: string; hash: string; activationId: string | null; manifest: ModuleManifest; scope: CallScope;
  queue: Promise<unknown>; start?: Promise<void>;
  process?: Process; channel?: Awaited<ReturnType<typeof createModuleChannel>>;
  dir?: string; idle?: ReturnType<typeof setTimeout>; retiring: boolean; closing: boolean; busy: boolean; connected?: boolean;
  exit?: { code: number | null; signal: string | null };
  failureEvidence?: ModuleFailureEvidence;
  failureRecorded?: boolean;
};
const triggerKey = (event: ModuleEvent) => event.trigger.kind === "tool" ? `tool:${event.trigger.id}` : event.trigger.kind === "call_result" ? `call_result:${event.trigger.callId}` : event.trigger.id;
const isClosing = (instance: Instance) => instance.closing;
const RETIRE_GRACE_MS = 1000;
const keyOf = (moduleId: string, hash: string, activationId: string | null) => `${moduleId}:${hash}:${activationId ?? "untracked"}`;
function failurePhase(event: ModuleEvent | undefined, connected: boolean | undefined) { return event ? "event" : connected ? "process" : "start"; }
function processEvidence(instance: Partial<Pick<Instance, "process" | "exit">>) {
  const process = instance.process, exit = instance.exit;
  return { pid: process?.pid ?? null, exitCode: exit?.code ?? null, signal: exit?.signal ?? null,
    stderr: diagnosticText(process?.stderr() ?? "", 4000, true), virtualMemoryMb: process?.limits?.virtualMemoryMb ?? null };
}
function evidence(instance: Partial<Pick<Instance, "connected" | "process" | "exit">>, error: string, runId?: string, event?: ModuleEvent): ModuleFailureEvidence {
  return { phase: failurePhase(event, instance.connected), reason: diagnosticText(error, 1000),
    runId: runId ?? null, triggerId: event ? triggerKey(event) : "process", delivery: null, ...processEvidence(instance) };
}
// Services wrap ports to add callbacks; process ownership belongs to the runtime's DB/data pair.
const supervisors = new WeakMap<StewardPorts["db"], Map<string, ReturnType<typeof createModuleSupervisor>>>();
export function moduleSupervisor(ports: StewardPorts) {
  let runtimes = supervisors.get(ports.db);
  if (!runtimes) { runtimes = new Map(); supervisors.set(ports.db, runtimes); }
  let supervisor = runtimes.get(ports.dataDir);
  if (!supervisor) { supervisor = createModuleSupervisor(ports); runtimes.set(ports.dataDir, supervisor); }
  return supervisor;
}

class ModuleSupervisor {
  private readonly instances = new Map<string, Instance>();
  private readonly current = new Map<string, string>();
  private readonly backoffFailures = new Map<string, number>();
  private readonly restarts = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private started = false;
  private poll?: ReturnType<typeof setTimeout>;
  constructor(private readonly ports: StewardPorts, private readonly timers: Timers, private readonly idleMs: number, private readonly backoffMs: number) {}
  private isStopped() { return this.stopped; }
  private async close(instance: Instance) {
    instance.closing = true;
    if (instance.idle) this.timers.clearTimeout(instance.idle);
    instance.process?.kill();
    await instance.channel?.close();
    await instance.process?.exited.catch(() => {});
    if (instance.dir) await rm(instance.dir, { recursive: true, force: true });
    const key = keyOf(instance.moduleId, instance.hash, instance.activationId);
    if (this.instances.get(key) === instance) this.instances.delete(key);
  }
  private retire(instance: Instance) {
    instance.retiring = true;
    // A web page approving its own module's version waits on that call: answer it, then give the reply time to reach the browser.
    const answered = async () => { if (await instance.channel?.drained()) await new Promise(resolve => this.timers.setTimeout(resolve, RETIRE_GRACE_MS)); };
    void instance.queue.then(answered, answered).finally(() => this.close(instance)).catch(() => {});
  }
  private async currentFailure(instance: { moduleId: string; hash: string; activationId?: string | null; scope: Pick<CallScope, "workspaceId"> }) {
    if (!instance.activationId) return true;
    try { return (await currentModuleEvolution(this.ports.db, instance.scope.workspaceId, instance.moduleId, instance.hash))?.activationId === instance.activationId; }
    catch (error) {
      console.error(JSON.stringify({ component: "module-supervisor", event: "stale_failure_check.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) }));
      return false;
    }
  }
  private async persistFailure(instance: Instance, input: { execution: { workspaceId: string; triggerId: string; firedAt: Date }; detail: ModuleFailureEvidence & { runId: string | null; delivery: DeliveryStage | null }; runId: string | undefined; now: Date }) {
    const { execution, detail, runId, now } = input;
    let failureRunId = runId ?? "";
    try { await this.ports.db.$transaction(async tx => {
      const data = { error: diagnosticText(detail.reason, 2000), exitCode: detail.exitCode ?? -1 };
      const run = runId ? await tx.moduleRun.update({ where: { id: runId }, data }) : await tx.moduleRun.create({ data: { moduleId: instance.moduleId, hash: instance.hash, triggerId: execution.triggerId, firedAt: execution.firedAt, ...data, createdAt: now } });
      failureRunId = run.id;
      const module = await tx.module.findUnique({ where: { id: instance.moduleId } });
      await recordModuleFailure(tx, { workspaceId: execution.workspaceId, moduleId: instance.moduleId, hash: instance.hash, now,
        retry: !this.stopped && !instance.retiring && instance.manifest.keepAlive && module?.status === "active" && module.activeHash === instance.hash,
        activationId: instance.activationId, evidence: { ...detail, runId: run.id } });
    }); } catch (error) {
      console.error(JSON.stringify({ component: "module-supervisor", event: "module.failure.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) }));
    }
    return failureRunId;
  }
  private async rollbackFailedStart(instance: { moduleId: string; hash: string; activationId?: string | null; connected?: boolean; failureEvidence?: ModuleFailureEvidence }, workspaceId: string, event: ModuleEvent | undefined, delivery: DeliveryStage | undefined) {
    if (instance.connected || instance.failureEvidence?.phase !== "start" || (event && delivery !== "unavailable") || !instance.activationId) return false;
    try { return (await rollbackFailedStart(moduleContext(this.ports, workspaceId), instance.moduleId, instance.hash, instance.activationId)).rolledBack; }
    catch (error) { console.error(JSON.stringify({ component: "module-supervisor", event: "module.rollback.failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) })); return false; }
  }
  private async failure(instance: Instance, error: string, runId?: string, event?: ModuleEvent, delivery?: DeliveryStage) {
    const { ports } = this;
    // The socket and process can report the same exit; a failed event may observe it too.
    if (instance.failureRecorded) return;
    instance.failureRecorded = true;
    if (!await this.currentFailure(instance)) return;
    const now = ports.now(), execution = { workspaceId: instance.scope.workspaceId, moduleId: instance.moduleId, hash: instance.hash, activationId: instance.activationId, triggerId: event ? triggerKey(event) : "process", firedAt: event ? new Date(event.trigger.firedAt) : now };
    const failureKey = keyOf(instance.moduleId, instance.hash, instance.activationId);
    this.backoffFailures.set(failureKey, (this.backoffFailures.get(failureKey) ?? 0) + 1);
    const detail = { ...(instance.failureEvidence ?? evidence(instance, error, runId, event)), reason: diagnosticText(error, 1000), runId: runId ?? null,
      triggerId: execution.triggerId, delivery: delivery ?? null };
    // Journal still has attributed evidence if SQLite itself cannot record the incident.
    console.error(JSON.stringify({ component: "module-supervisor", event: "module.failure", moduleId: instance.moduleId, module: instance.manifest.name, hash: instance.hash, ...detail }));
    const failureRunId = await this.persistFailure(instance, { execution, detail, runId, now });
    const rolledBack = await this.rollbackFailedStart(instance, execution.workspaceId, event, delivery);
    if (!rolledBack && failureRunId) await ports.db.$transaction(tx => moduleEffects().pauseFailedModule(tx, ports, execution, failureRunId)).catch(pauseError => console.error(JSON.stringify({ component: "module-supervisor", event: "module.pause.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(pauseError), 300) })));
  }
  private async restart(instance: Instance) {
    if (this.stopped || instance.retiring || !instance.manifest.keepAlive || this.restarts.has(instance.moduleId)) return;
    const policy = await moduleFailurePolicy(this.ports.db, { workspaceId: instance.scope.workspaceId, ...instance });
    // Preserve the local restart execution limit even if evidence could not be persisted/attributed.
    if (policy?.shouldPause || (this.backoffFailures.get(keyOf(instance.moduleId, instance.hash, instance.activationId)) ?? 0) >= 3) return;
    const timer = this.timers.setTimeout(() => {
      this.restarts.delete(instance.moduleId);
      void this.ensureActive(instance.moduleId).catch(() => {});
    }, Math.min(60_000, this.backoffMs * 2 ** Math.max(0, Math.max(policy?.consecutiveFailures ?? 0, this.backoffFailures.get(keyOf(instance.moduleId, instance.hash, instance.activationId)) ?? 1) - 1)));
    this.restarts.set(instance.moduleId, timer);
  }
  private async restartCurrent(instance: Instance) {
    const module = await this.ports.db.module.findUnique({ where: { id: instance.moduleId } });
    const current = module?.activeHash ? await currentModuleEvolution(this.ports.db, instance.scope.workspaceId, instance.moduleId, module.activeHash) : null;
    if (module?.status === "active" && module.activeHash && (module.activeHash !== instance.hash || (current?.activationId ?? null) !== instance.activationId)) {
      this.backoffFailures.delete(keyOf(instance.moduleId, instance.hash, instance.activationId));
      await this.ensureActive(instance.moduleId);
    } else if (module?.status === "active") await this.restart(instance);
  }
  private async unexpectedExit(instance: Instance, reason = "Module process exited") {
    if (instance.closing || instance.busy) return;
    instance.busy = true;
    await this.collectExit(instance, reason);
    // Stopped with Chrona (systemd signals the whole control group) or by the supervisor itself: not a module fault.
    const stopped = this.stopped || ["SIGTERM", "SIGINT"].includes(instance.exit?.signal ?? "");
    try { if (!stopped) await this.failure(instance, reason); }
    finally { await this.close(instance); await this.restartCurrent(instance); instance.busy = false; }
  }
  private async collectExit(instance: Instance, reason: string) {
    // Socket close can precede the child's exit notification; collect evidence, never replay the event.
    if (reason === "Module disconnected" && instance.process) await Promise.race([instance.process.exited.catch(() => {}), new Promise(resolve => setTimeout(resolve, 50))]);
  }
  private async codeDir(instance: Instance) {
    const { ports } = this;
    const module = await ports.db.module.findUniqueOrThrow({ where: { id: instance.moduleId } });
    if (module.activeHash !== instance.hash || module.status !== "active") throw new Error("Module identity changed before start");
    let codeDir = join(ports.dataDir, "platform/store", instance.hash);
    if (module.builtin) {
      const release = await resolveBuiltinRelease(ports, module.name, instance.hash);
      if (JSON.stringify(release.manifest) !== JSON.stringify(instance.manifest)) throw new Error("Built-in release manifest differs from registered metadata");
      codeDir = release.codeDir;
    } else assertModuleOperation(module, "activate");
    return codeDir;
  }
  private async spawn(instance: Instance, sandbox: NonNullable<StewardPorts["sandbox"]>) {
    const { ports, timers } = this, codeDir = await this.codeDir(instance);
    // Deliberately not under dataDir: deep installations exceed Unix socket path limits.
    instance.dir = await mkdtemp("/tmp/cm-");
    await chmod(instance.dir, 0o700);
    const dataDir = join(ports.dataDir, "platform/data", instance.moduleId);
    await mkdir(dataDir, { recursive: true });
    // Only routed calls cross the channel (v2-10); each waits for its own target, never for the module's other calls.
    instance.channel = await createModuleChannel(join(instance.dir, "s"), { timers, onCall: call => moduleEffects().handleModuleCall(ports, { ...instance.scope }, call) });
    if (this.isStopped() || isClosing(instance)) throw new Error("Module supervisor stopped");
    const contentDir = instance.manifest.content ? join(ports.dataDir, "platform/content", instance.moduleId) : undefined;
    if (contentDir) await mkdir(contentDir, { recursive: true });
    const httpDir = instance.manifest.listen ? join(instance.dir, "http") : undefined;
    if (httpDir) await mkdir(httpDir, { mode: 0o700 });
    const process = sandbox.startModule!({ codeDir, dataDir, ...(contentDir ? { contentDir } : {}), ...(httpDir ? { httpDir } : {}), ...(ports.publicUrl ? { env: { CHRONA_PUBLIC_URL: ports.publicUrl } } : {}), entry: instance.manifest.entry, socketPath: join(instance.dir, "s"), network: instance.manifest.effects.includes("network"), ...(instance.manifest.limits ? { memoryMb: instance.manifest.limits.virtualMemoryMb } : {}) });
    instance.process = process;
    // Install exit observers before yielding after startModule returns.
    return this.connect(instance, process);
  }
  private async connect(instance: Instance, process: Process) {
    const exited = process.exited.then(exit => { if (!instance.closing) instance.exit = exit; throw new Error("Module process exited"); });
    void exited.catch(() => {});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([instance.channel!.ready, exited, new Promise<never>((_, reject) => { timeout = this.timers.setTimeout(() => reject(new Error("Module start timeout")), RUN_LIMITS.jobTimeoutMs); })]);
    } finally { if (timeout) this.timers.clearTimeout(timeout); }
    instance.connected = true;
    await recordModuleRecovery(this.ports, { workspaceId: instance.scope.workspaceId, moduleId: instance.moduleId, hash: instance.hash, activationId: instance.activationId }).catch(error => console.error(JSON.stringify({ component: "module-supervisor", event: "recovery_diagnostic.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) })));
    if (instance.exit) throw new Error("Module process exited");
    if (!instance.channel!.connected()) throw new Error("Module disconnected");
    void process.exited.catch(() => {}).then(() => this.unexpectedExit(instance)).catch(() => {});
    void instance.channel!.closedWithError.then(error => this.unexpectedExit(instance, error.message)).catch(() => {});
  }
  private async startInstance(instance: Instance) {
    try {
      if (this.stopped || instance.closing) throw new Error("Module supervisor stopped");
      const sandbox = this.ports.sandbox;
      if (!sandbox?.available || !sandbox.startModule) throw new Error("Module sandbox unavailable");
      await this.spawn(instance, sandbox);
    } catch (error) {
      instance.failureEvidence = evidence(instance, String(error));
      await this.close(instance);
      throw error;
    }
  }
  private async getActiveModule(moduleId: string, hash: string) {
    if (this.isStopped()) throw new Error("Module supervisor stopped");
    const module = await this.ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    if (this.isStopped()) throw new Error("Module supervisor stopped");
    if (module.status !== "active" || module.activeHash !== hash) throw new Error("Module version is not active");
    return module;
  }
  private async get(moduleId: string, hash: string) {
    const module = await this.getActiveModule(moduleId, hash);
    const evolution = await currentModuleEvolution(this.ports.db, module.workspaceId, moduleId, hash);
    const activationId = evolution?.activationId ?? null;
    const key = keyOf(moduleId, hash, activationId), previous = this.current.get(moduleId);
    if (previous && previous !== key) { const old = this.instances.get(previous); if (old) this.retire(old); }
    this.current.set(moduleId, key);
    let instance = this.instances.get(key);
    if (!instance) {
      const version = await this.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId, hash } } });
      // Another caller may have finished the same asynchronous lookup.
      if (this.isStopped()) throw new Error("Module supervisor stopped");
      instance = this.instances.get(key);
      if (!instance) {
        const manifest = moduleManifestSchema.parse(version.manifest);
        instance = { moduleId, hash, activationId, manifest, scope: { workspaceId: module.workspaceId, moduleId, hash, manifest }, queue: Promise.resolve(), retiring: false, closing: false, busy: false };
        this.instances.set(key, instance);
      }
    }
    return instance;
  }
  private async finishBusy(instance: Instance) {
    instance.busy = false;
    if (!isClosing(instance) && (instance.exit || instance.connected && !instance.channel?.connected())) await this.unexpectedExit(instance, instance.exit ? "Module process exited" : "Module disconnected");
  }
  private async ensureActive(moduleId: string) {
    const module = await this.ports.db.module.findUnique({ where: { id: moduleId } });
    if (this.stopped || this.restarts.has(moduleId) || module?.status !== "active" || !module.activeHash) return;
    const version = await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
    if (!moduleManifestSchema.safeParse(version?.manifest).data?.keepAlive) return;
    const instance = await this.get(moduleId, module.activeHash);
    if (instance.start) return;
    instance.busy = true;
    try { await (instance.start = this.startInstance(instance)); }
    catch (error) {
      // A replaced version closed while starting is not a module fault.
      if (instance.retiring) return;
      await this.failure(instance, String(error).slice(0, 2000)); await this.restartCurrent(instance);
    }
    finally { await this.finishBusy(instance); }
  }
  async reconcile() {
    if (this.stopped) return;
    const modules = await this.ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } });
    const active = new Map(modules.map(module => [module.id, module.activeHash]));
    for (const instance of this.instances.values()) if (active.get(instance.moduleId) !== instance.hash) this.retire(instance);
    for (const module of modules) await this.ensureActive(module.id);
    void this.announce(modules).catch(error => console.error(JSON.stringify({ level: "error", message: "module activated delivery failed", error: String(error) })));
  }
  /**
   * `activated` reaches each module declaring it once per active version and again when a module it `uses` changes version
   * (module-dependency-direction §4), so a sleeping app can register with web. Recorded in platform/activated.json;
   * a delivery that fails is retried on later passes, at most three times per change.
   */
  private announced?: Record<string, string>;
  private announcing = false;
  private readonly announceAttempts = new Map<string, number>();
  private readonly manifests = new Map<string, ModuleManifest | null>();
  private async announce(modules: { id: string; name: string; activeHash: string | null }[]) {
    if (this.announcing || this.stopped) return;
    this.announcing = true;
    const file = join(this.ports.dataDir, "platform", "activated.json");
    try {
      this.announced ??= await readFile(file, "utf8").then(text => JSON.parse(text) as Record<string, string>).catch(() => ({}));
      const hashes = new Map(modules.map(module => [module.name, module.activeHash]));
      for (const module of modules) {
        const hash = module.activeHash!, manifest = await this.manifestOf(module.id, hash);
        if (!manifest?.activated || (this.stopped as boolean)) continue;
        const uses = [...new Set(manifest.uses.filter(target => target !== "*").map(target => target.split(".")[0]!))].filter(name => name !== module.name && hashes.has(name)).sort();
        const signature = [hash, ...uses.map(name => `${name}@${hashes.get(name)}`)].join(" ");
        if (this.announced[module.id] === signature) continue;
        const now = this.ports.now().toISOString(), attempt = `${module.id} ${signature}`;
        try { await this.deliver(module.id, hash, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} }); }
        catch {
          const tries = (this.announceAttempts.get(attempt) ?? 0) + 1;
          this.announceAttempts.set(attempt, tries);
          if (tries < 3) continue;
        }
        this.announced[module.id] = signature;
        await mkdir(join(this.ports.dataDir, "platform"), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(this.announced));
        await rename(`${file}.tmp`, file);
      }
    } finally { this.announcing = false; }
  }
  private async manifestOf(moduleId: string, hash: string) {
    if (!this.manifests.has(hash)) this.manifests.set(hash, moduleManifestSchema.safeParse((await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } }))?.manifest).data ?? null);
    return this.manifests.get(hash);
  }
  private async validateTrigger(instance: Instance, event: ModuleEvent) {
    const { trigger } = event, { manifest, moduleId } = instance;
    const dynamic = trigger.kind === "schedule" && trigger.scheduleId !== undefined && trigger.payload !== undefined;
    if (dynamic) {
      // v2-24: only the module's own timers deliver schedule events.
      if (!await this.ports.db.schedule.findFirst({ where: { id: trigger.scheduleId, moduleId, mode: "module" } })) throw staged(new Error("Dynamic schedule requires its own timer"), "unavailable");
    } else if (trigger.kind === "activated" || trigger.kind === "call_result") return;
    else if (trigger.kind === "tool" ? !manifest.tools.some(tool => tool.name === trigger.id) : !manifest.triggers.some(candidate => candidate.id === trigger.id)) throw staged(new Error("Module trigger missing"), "unavailable");
  }
  /** The owner's settings decide a model module's timeout and every module's params (v2-23 settings). */
  private async eventLimits(manifest: ModuleManifest, workspaceId: string, requested?: number) {
    const workspace = manifest.model || Object.keys(manifest.settings).length ? await this.ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }) : null;
    const timeoutMs = requested ?? (workspace && manifest.model ? moduleModelSettings(workspace.settings)?.timeoutMs ?? RUN_LIMITS.jobTimeoutMs : RUN_LIMITS.jobTimeoutMs);
    return { timeoutMs, params: moduleRuntimeParams(manifest, workspace?.settings) };
  }
  private async sendEvent(instance: Instance, event: ModuleEvent, workspaceId: string, requested?: number) {
    const { manifest } = instance;
    try { await (instance.start ??= this.startInstance(instance)); }
    catch (error) { throw staged(error, "unavailable"); }
    const { timeoutMs, params } = await this.eventLimits(manifest, workspaceId, requested);
    let reply: Reply;
    try { reply = await instance.channel!.send({ ...event, params }, timeoutMs); }
    catch (error) { throw staged(error, (error as { written?: boolean }).written === false ? "unavailable" : "lost"); }
    if ("error" in reply) throw staged(Object.assign(new Error(reply.error), { code: reply.errorCode }), "handler");
    return reply;
  }
  private async failedDelivery(instance: Instance, event: ModuleEvent, runId: string, error: unknown) {
    if (error instanceof Error) await this.collectExit(instance, error.message);
    try { await this.failure(instance, error instanceof Error ? error.message : String(error), runId, event, (error as { stage?: DeliveryStage }).stage); }
    finally { await this.close(instance); await this.restartCurrent(instance); }
  }
  private async finishEvent(instance: Instance) {
    await this.finishBusy(instance);
    delete instance.scope.moduleRunId; delete instance.scope.eventKey; delete instance.scope.chain; delete instance.scope.path;
    if (!isClosing(instance) && !instance.manifest.keepAlive) instance.idle = this.timers.setTimeout(() => { void instance.queue.then(() => this.close(instance)); }, this.idleMs);
  }
  private async recordEventResult(input: { instance: Instance; event: ModuleEvent; workspaceId: string; runId: string; reply: Reply; validateResult?: DeliveryOptions["validateResult"] }) {
    const { instance, event, workspaceId, runId, reply, validateResult } = input;
    if ("error" in reply) throw staged(Object.assign(new Error(reply.error), { code: reply.errorCode }), "handler");
    const outputError = validateResult?.(reply.result.result ?? null) ?? null;
    if (outputError) {
      await this.ports.db.moduleRun.update({ where: { id: runId }, data: { exitCode: 1, error: outputError.slice(0, 1000) } });
      return;
    }
    await this.ports.db.moduleRun.update({ where: { id: runId }, data: { exitCode: 0, output: reply.result } });
    this.backoffFailures.set(keyOf(instance.moduleId, instance.hash, instance.activationId), 0);
    await recordModuleRecovery(this.ports, { workspaceId, moduleId: instance.moduleId, hash: instance.hash, activationId: instance.activationId, triggerId: triggerKey(event), runId }).catch(error => console.error(JSON.stringify({ component: "module-supervisor", event: "recovery_diagnostic.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) })));
  }
  private async assertCurrentActivation(instance: Instance) {
    const { moduleId, hash } = instance;
    const module = await this.ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    const evolution = await currentModuleEvolution(this.ports.db, module.workspaceId, moduleId, hash);
    if (this.stopped || instance.closing || module.status !== "active" || module.activeHash !== hash || (evolution?.activationId ?? null) !== instance.activationId) {
      await this.close(instance);
      throw Object.assign(staged(new Error("Module activation changed before event delivery"), "unavailable"), { staleActivation: true });
    }
    return module;
  }
  private async deliverEvent(instance: Instance, event: ModuleEvent, { chain = [], path = [], timeoutMs, validateResult, beforeDelivery }: DeliveryOptions): Promise<Reply> {
    const { moduleId, hash } = instance, module = await this.assertCurrentActivation(instance);
    // Admission/metadata rejection is not a real execution result.
    await this.validateTrigger(instance, event);
    try { await beforeDelivery?.(); } catch (error) { throw staged(error, "unavailable"); }
    const run = await this.ports.db.moduleRun.create({ data: { moduleId, hash, triggerId: triggerKey(event), firedAt: new Date(event.trigger.firedAt), exitCode: -1, createdAt: this.ports.now() } });
    instance.busy = true;
    instance.scope.moduleRunId = run.id;
    instance.scope.eventKey = `${event.trigger.id}:${event.trigger.firedAt}`;
    instance.scope.chain = chain; instance.scope.path = path;
    try {
      const reply = await this.sendEvent(instance, event, module.workspaceId, timeoutMs);
      await this.recordEventResult({ instance, event, workspaceId: module.workspaceId, runId: run.id, reply, validateResult });
      return reply;
    } catch (error) {
      if ((error as { staleActivation?: boolean }).staleActivation) throw error;
      const rejection = error as { stage?: DeliveryStage; code?: string };
      if (rejection.stage === "handler" && rejection.code && !["internal", "failed", "unknown"].includes(rejection.code)) {
        // A validated application rejection (invalid input, conflict, permission, capacity)
        // completes this call; the SDK process remains healthy and can serve the next one.
        await this.ports.db.moduleRun.update({ where: { id: run.id }, data: { exitCode: 1, error: diagnosticText(error instanceof Error ? error.message : String(error), 1000) } });
      } else await this.failedDelivery(instance, event, run.id, error);
      throw error;
    } finally { await this.finishEvent(instance); }
  }
  /** Delivers one event serially; chain/path track routed calls, and failures carry their delivery stage. */
  async deliver(moduleId: string, hash: string, event: ModuleEvent, options: DeliveryOptions = {}): Promise<Reply> {
    // A new request must not bypass recovery backoff or count as another failed execution.
    if (this.restarts.has(moduleId)) throw staged(new Error("模块正在等待恢复，请稍后查看诊断状态"), "unavailable");
    const instance = await this.get(moduleId, hash).catch(error => { throw staged(error, "unavailable"); });
    if (instance.idle) this.timers.clearTimeout(instance.idle);
    if (options.activationId !== undefined && options.activationId !== instance.activationId) throw staged(new Error("Module activation changed before event delivery"), "unavailable");
    const result = instance.queue.then(() => this.deliverEvent(instance, event, options));
    instance.queue = result.catch(() => {});
    return result;
  }
  /** The HTTP socket of the active module serving path, started if needed; null when none can serve it. */
  async listener(path: string) {
    for (const module of await this.ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } })) {
      const version = await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
      if (!listenPaths(moduleManifestSchema.safeParse(version?.manifest).data ?? {}).includes(path)) continue;
      await this.ensureActive(module.id);
      const currentKey = this.current.get(module.id);
      const instance = currentKey ? this.instances.get(currentKey) : undefined;
      await instance?.start?.catch(() => {});
      return instance?.dir && !instance.closing ? join(instance.dir, "http/s") : null;
    }
    return null;
  }
  status(moduleId: string, hash: string | null, keepAlive: boolean) {
    if (!this.started || this.stopped) return { state: "unobserved" as const, pid: null };
    if (this.restarts.has(moduleId)) return { state: "backoff" as const, pid: null };
    const currentKey = this.current.get(moduleId), instance = currentKey ? this.instances.get(currentKey) : undefined;
    if (instance && instance.hash === hash && !instance.closing) return { state: instance.connected ? "running" as const : "starting" as const, pid: instance.process?.pid ?? null };
    return { state: keepAlive ? "unavailable" as const : "idle" as const, pid: null };
  }
  async start() {
    if (this.started) return;
    this.stopped = false; this.started = true;
    for (const workspace of await this.ports.db.workspace.findMany()) {
      try { await registerBuiltins(this.ports, workspace.id); }
      catch (error) { console.error(JSON.stringify({ component: "module-supervisor", event: "builtin.registration_failed", workspaceId: workspace.id, error: diagnosticText(String(error), 1000) })); }
    }
    const loop = async () => { try { await this.reconcile(); } finally { if (!this.stopped) this.poll = this.timers.setTimeout(() => { void loop().catch(() => {}); }, 30_000); } };
    await loop();
  }
  /** Removal waits for this app's in-flight event and confirmed process exit before copying data. */
  async settleModule(moduleId: string) {
    const instances = [...this.instances.values()].filter(instance => instance.moduleId === moduleId);
    await Promise.all(instances.map(async instance => {
      instance.retiring = true;
      await instance.start?.catch(() => {});
      await instance.queue.catch(() => {});
      await this.close(instance);
    }));
  }
  async stop() {
    this.stopped = true; this.started = false;
    if (this.poll) this.timers.clearTimeout(this.poll);
    for (const timer of this.restarts.values()) this.timers.clearTimeout(timer);
    this.restarts.clear();
    await Promise.all([...this.instances.values()].map(async instance => { await this.close(instance); await instance.start?.catch(() => {}); }));
    this.current.clear();
  }
}

export function createModuleSupervisor(ports: StewardPorts, { timers = globalThis, idleMs = 10 * 60_000, backoffMs = 1000 }: Options = {}) {
  const runtime = new ModuleSupervisor(ports, timers, idleMs, backoffMs);
  // Preserve the closure API: consumers may extract methods without a receiver.
  return { deliver: runtime.deliver.bind(runtime), reconcile: runtime.reconcile.bind(runtime), listener: runtime.listener.bind(runtime),
    status: runtime.status.bind(runtime), start: runtime.start.bind(runtime), stop: runtime.stop.bind(runtime), settleModule: runtime.settleModule.bind(runtime) };
}
