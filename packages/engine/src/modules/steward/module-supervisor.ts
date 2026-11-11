import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleHttpReady } from "./module-http-ready";
import { listenPaths, moduleManifestSchema, RUN_LIMITS, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { createModuleChannel } from "./module-channel";
import { diagnosticText, recordModuleFailure, recordModuleRecovery, type ModuleFailureEvidence } from "./module-diagnostics";
import { currentModuleEvolution } from "./module-evolution";
import { moduleFailurePolicy } from "./module-failure-policy";
import { moduleContext } from "./module-context";
import { ensureVersionMaterial } from "./module-source";
import { rollbackFailedStart } from "./module-generation";
import { resolveExternalRelease } from "./module-release";
import { assertModuleOperation } from "./module-identity";
import { assertModuleAvailable, isModulePaused, ModuleUnavailableError } from "./module-availability";
import { eventLimits, activationChanged, availableInstance, evidence, failureDetail, deliveryFailure, handlerFailureData, instanceStatus, isHandlerRejection, keyOf, moduleEffects, restartDelay, staged, triggerKey, type CallScope, type DeliveryOptions, type DeliveryStage, type Instance, type Options, type Process, type Reply, type Timers } from "./module-supervisor-state";
export { registerModuleEffects, type CallScope, type DeliveryStage } from "./module-supervisor-state";

const isClosing = (instance: Instance) => instance.closing;
const RETIRE_GRACE_MS = 1000;
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
  private close(instance: Instance): Promise<void> {
    if (instance.closePromise) return instance.closePromise;
    instance.closing = true;
    if (instance.idle) this.timers.clearTimeout(instance.idle);
    instance.closePromise = (async () => {
      try {
        instance.process?.kill();
        try { await instance.channel?.close(); }
        finally { await instance.process?.exited; }
      } catch (error) {
        this.holdUnknown(instance, error);
        throw instance.stopUnknown;
      }
      const key = keyOf(instance.moduleId, instance.hash, instance.activationId);
      if (this.instances.get(key) === instance) this.instances.delete(key);
    })();
    return instance.closePromise;
  }
  private holdUnknown(instance: Instance, error: unknown) {
    instance.stopUnknown ??= error instanceof Error ? error : new Error(String(error));
    const restart = this.restarts.get(instance.moduleId);
    if (restart) this.timers.clearTimeout(restart);
    this.restarts.delete(instance.moduleId);
  }
  private retire(instance: Instance) {
    if (instance.retirement) return;
    instance.retiring = true;
    // A web page approving its own module's version waits on that call: answer it, then give the reply time to reach the browser.
    const answered = async () => { if (await instance.channel?.drained()) await new Promise(resolve => this.timers.setTimeout(resolve, RETIRE_GRACE_MS)); };
    instance.retirement = instance.queue.then(answered, answered).finally(() => this.close(instance)).then(() => this.ensureActive(instance.moduleId));
    void instance.retirement.catch(error => this.failure(instance, String(error))).catch(() => {});
  }
  private assertOwnershipAvailable(moduleId: string, key: string) {
    for (const instance of this.instances.values()) {
      if (instance.moduleId !== moduleId) continue;
      if (instance.stopUnknown) throw new Error(instance.stopUnknown.message, { cause: instance.stopUnknown });
      if (keyOf(moduleId, instance.hash, instance.activationId) !== key || instance.closing || instance.retiring) {
        this.retire(instance);
        throw new Error("Module process retirement has not confirmed descendant stop");
      }
    }
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
        retry: !instance.stopUnknown && !this.stopped && !instance.retiring && instance.manifest.keepAlive && module?.status === "active" && module.activeHash === instance.hash,
        activationId: instance.activationId, evidence: { ...detail, runId: run.id } });
    }); } catch (error) {
      console.error(JSON.stringify({ component: "module-supervisor", event: "module.failure.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) }));
    }
    return failureRunId;
  }
  private async rollbackFailedStart(instance: { moduleId: string; hash: string; activationId?: string | null; connected?: boolean; stopUnknown?: Error; failureEvidence?: ModuleFailureEvidence }, workspaceId: string, event: ModuleEvent | undefined, delivery: DeliveryStage | undefined) {
    if (instance.stopUnknown || instance.connected || instance.failureEvidence?.phase !== "start" || (event && delivery !== "unavailable") || !instance.activationId) return false;
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
    const detail = failureDetail(instance, { error, runId, event, delivery, triggerId: execution.triggerId });
    // Journal still has attributed evidence if SQLite itself cannot record the incident.
    console.error(JSON.stringify({ component: "module-supervisor", event: "module.failure", moduleId: instance.moduleId, module: instance.manifest.name, hash: instance.hash, ...detail }));
    const failureRunId = await this.persistFailure(instance, { execution, detail, runId, now });
    const rolledBack = await this.rollbackFailedStart(instance, execution.workspaceId, event, delivery);
    if (!rolledBack && failureRunId) await moduleEffects().pauseFailedModule(ports, execution, failureRunId).catch(pauseError => console.error(JSON.stringify({ component: "module-supervisor", event: "module.pause.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(pauseError), 300) })));
  }
  private async restart(instance: Instance) {
    if (instance.stopUnknown || this.stopped || instance.retiring || !instance.manifest.keepAlive || this.restarts.has(instance.moduleId)) return;
    const policy = await moduleFailurePolicy(this.ports.db, { workspaceId: instance.scope.workspaceId, ...instance });
    // Preserve the local restart execution limit even if evidence could not be persisted/attributed.
    const localFailures = this.backoffFailures.get(keyOf(instance.moduleId, instance.hash, instance.activationId)) ?? 0;
    if (policy?.shouldPause || localFailures >= 3) return;
    const timer = this.timers.setTimeout(() => {
      this.restarts.delete(instance.moduleId);
      void this.ensureActive(instance.moduleId).catch(() => {});
    }, restartDelay(this.backoffMs, policy?.consecutiveFailures ?? 0, localFailures));
    this.restarts.set(instance.moduleId, timer);
  }
  private async restartCurrent(instance: Instance) {
    if (instance.stopUnknown) return;
    const module = await this.ports.db.module.findUnique({ where: { id: instance.moduleId } });
    const current = module?.activeHash ? await currentModuleEvolution(this.ports.db, instance.scope.workspaceId, instance.moduleId, module.activeHash) : null;
    if (module?.status === "active" && module.activeHash && activationChanged(instance, module.activeHash, current?.activationId ?? null)) {
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
    try {
      await this.close(instance).catch(() => {});
      if (!stopped || instance.stopUnknown) await this.failure(instance, instance.stopUnknown ? String(instance.stopUnknown) : reason);
      if (!instance.stopUnknown) await this.restartCurrent(instance);
    } finally { instance.busy = false; }
  }
  private async collectExit(instance: Instance, reason: string) {
    // Socket close can precede the child's exit notification; collect evidence, never replay the event.
    if (reason === "Module disconnected" && instance.process) await Promise.race([instance.process.exited.catch(() => {}), new Promise(resolve => setTimeout(resolve, 50))]);
  }
  private async codeDir(instance: Instance) {
    const { ports } = this;
    const module = await ports.db.module.findUniqueOrThrow({ where: { id: instance.moduleId } });
    if (module.activeHash !== instance.hash || module.status !== "active") throw new Error("Module identity changed before start");
    assertModuleAvailable(module.name);
    const codeDir = join(ports.dataDir, "platform/store", instance.hash);
    assertModuleOperation(module, "enable");
    const version = await ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: instance.hash } } });
    if (version.status !== "approved") throw new Error("Module version is not approved");
    await ensureVersionMaterial(moduleContext(ports, instance.scope.workspaceId), version);
    return codeDir;
  }
  private async providerHost(instance: Instance) {
    const { ports } = this;
    const module = await this.getActiveModule(instance.moduleId, instance.hash);
    if (module.builtin || module.workspaceId !== instance.scope.workspaceId || module.name !== instance.manifest.name) return undefined;
    const host = Object.hasOwn(ports.providerModules ?? {}, module.name) ? ports.providerModules![module.name] : undefined;
    if (!host) return undefined;
    const version = await ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: instance.hash } } });
    if (version.status !== "approved") throw new Error("Provider module version is not approved");
    // A name or manifest alone never grants host configuration. The installed code
    // must be the exact verified release shipped by this host, including its Git seed.
    try {
      const release = await resolveExternalRelease(ports, module.name, instance.hash);
      if (!release.git || release.hash !== instance.hash || JSON.stringify(release.manifest) !== JSON.stringify(instance.manifest)) return undefined;
      return host;
    } catch { return undefined; }
  }
  private async bindings(workspaceId: string) {
    return Object.fromEntries((await this.ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, select: { id: true, name: true } })).map(row => [row.name, row.id]));
  }
  private async spawn(instance: Instance, sandbox: NonNullable<StewardPorts["sandbox"]>) {
    const { ports, timers } = this, codeDir = await this.codeDir(instance);
    instance.channel = await createModuleChannel({ onCall: call => moduleEffects().handleModuleCall(ports, { ...instance.scope }, call), timers });
    if (this.isStopped() || isClosing(instance)) throw new Error("Module supervisor stopped");
    const dataDir = join(ports.dataDir, "platform/data", instance.moduleId);
    await mkdir(dataDir, { recursive: true });
    const contentDir = instance.manifest.content ? join(ports.dataDir, "platform/content", instance.moduleId) : undefined;
    if (contentDir) await mkdir(contentDir, { recursive: true });
    const bindings = JSON.stringify(await this.bindings(instance.scope.workspaceId));
    const provider = await this.providerHost(instance);
    const startModule = provider ? provider.startModule : sandbox.startModule!;
    const current = await this.getActiveModule(instance.moduleId, instance.hash);
    if (current.workspaceId !== instance.scope.workspaceId || current.name !== instance.manifest.name || current.builtin) throw new Error("Module identity changed before start");
    if (isClosing(instance)) throw new Error("Module instance closed before start");
    const process = startModule({ codeDir, dataDir, contentDir, env: { CHRONA_PUBLIC_URL: ports.publicUrl ?? "", ...provider?.env, CHRONA_MODULE_BINDINGS: bindings }, entry: instance.manifest.entry, ipcEndpoint: instance.channel.endpoint, ipcToken: instance.channel.token, network: instance.manifest.effects.includes("network") });
    instance.process = process;
    // Install exit observers before yielding after startModule returns.
    return this.connect(instance, process);
  }
  private async connect(instance: Instance, process: Process) {
    const exited = process.exited.then(exit => { if (!instance.closing) instance.exit = exit; throw new Error("Module process exited"); }, error => { this.holdUnknown(instance, error); throw error; });
    void exited.catch(() => {});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([instance.channel!.ready, exited, new Promise<never>((_, reject) => { timeout = this.timers.setTimeout(() => reject(new Error("Module start timeout")), RUN_LIMITS.jobTimeoutMs); })]);
    } finally { if (timeout) this.timers.clearTimeout(timeout); }
    instance.connected = true;
    await recordModuleRecovery(this.ports, { workspaceId: instance.scope.workspaceId, moduleId: instance.moduleId, hash: instance.hash, activationId: instance.activationId }).catch(error => console.error(JSON.stringify({ component: "module-supervisor", event: "recovery_diagnostic.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) })));
    if (instance.stopUnknown) throw instance.stopUnknown;
    if (instance.exit) throw new Error("Module process exited");
    if (!instance.channel!.connected()) throw new Error("Module disconnected");
    void process.exited.then(() => this.unexpectedExit(instance), error => this.unexpectedExit(instance, String(error))).catch(() => {});
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
    assertModuleAvailable(module.name);
    if (module.status !== "active" || module.activeHash !== hash) throw new Error("Module version is not active");
    return module;
  }
  private async get(moduleId: string, hash: string) {
    const module = await this.getActiveModule(moduleId, hash);
    const evolution = await currentModuleEvolution(this.ports.db, module.workspaceId, moduleId, hash);
    const activationId = evolution?.activationId ?? null;
    const key = keyOf(moduleId, hash, activationId);
    this.assertOwnershipAvailable(moduleId, key);
    this.current.set(moduleId, key);
    const instance = this.instances.get(key);
    if (instance && instance.scope.receiverActivationId !== module.activationId) {
      this.retire(instance);
      throw new Error("Module activation retirement has not confirmed descendant stop");
    }
    return availableInstance(instance) ?? this.createInstance(module, hash, activationId, key);
  }
  private async createInstance(module: { id: string; workspaceId: string; activationId: string }, hash: string, activationId: string | null, key: string) {
    const moduleId = module.id;
    const version = await this.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId, hash } } });
    // Another caller may have finished the same asynchronous lookup.
    if (this.isStopped()) throw new Error("Module supervisor stopped");
    this.assertOwnershipAvailable(moduleId, key);
    const existing = availableInstance(this.instances.get(key));
    if (existing) return existing;
    const manifest = moduleManifestSchema.parse(version.manifest);
    const instance: Instance = { moduleId, hash, activationId, manifest, scope: { workspaceId: module.workspaceId, moduleId, hash, receiverActivationId: module.activationId, manifest }, queue: Promise.resolve(), retiring: false, closing: false, busy: false };
    this.instances.set(key, instance);
    return instance;
  }
  private async finishBusy(instance: Instance) {
    instance.busy = false;
    if (!isClosing(instance) && (instance.exit || instance.connected && !instance.channel?.connected())) await this.unexpectedExit(instance, instance.exit ? "Module process exited" : "Module disconnected");
  }
  private async ensureActive(moduleId: string) {
    const module = await this.ports.db.module.findUnique({ where: { id: moduleId } });
    if (this.stopped || this.restarts.has(moduleId) || module?.status !== "active" || !module.activeHash || isModulePaused(module.name)) return;
    const version = await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
    if (!moduleManifestSchema.safeParse(version?.manifest).data?.keepAlive) return;
    // Reconciliation defers replacement while the previous owner drains. Direct
    // deliveries still reject until its descendant-stop proof releases ownership.
    const owners = [...this.instances.values()].filter(instance => instance.moduleId === moduleId);
    const unknown = owners.find(instance => instance.stopUnknown);
    if (unknown) throw new Error(unknown.stopUnknown!.message, { cause: unknown.stopUnknown });
    if (owners.some(instance => instance.retiring || instance.closing)) return;
    await this.startKeepAlive(await this.get(moduleId, module.activeHash));
  }
  private async startKeepAlive(instance: Instance) {
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
    const modules = (await this.ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } })).filter(module => !isModulePaused(module.name));
    const active = new Map(modules.map(module => [module.id, module]));
    for (const instance of this.instances.values()) {
      const current = active.get(instance.moduleId);
      if (current?.activeHash !== instance.hash || current.activationId !== instance.scope.receiverActivationId) this.retire(instance);
    }
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
      const hashes = new Map(modules.filter(module => !isModulePaused(module.name)).map(module => [module.name, module.activeHash]));
      for (const module of modules) {
        if (isModulePaused(module.name)) continue;
        const hash = module.activeHash!, manifest = await this.manifestOf(module.id, hash);
        if (!manifest?.activated || (this.stopped as boolean)) continue;
        const uses = [...new Set(manifest.uses.filter(target => target !== "*").map(target => target.split(".")[0]!))].filter(name => name !== module.name && hashes.has(name)).sort();
        const signature = [hash, ...uses.map(name => `${name}@${hashes.get(name)}`)].join(" ");
        if (this.announced[module.id] === signature) continue;
        if (!await this.deliverActivation(module.id, hash, signature)) continue;
        this.announced[module.id] = signature;
        await mkdir(join(this.ports.dataDir, "platform"), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(this.announced));
        await rename(`${file}.tmp`, file);
      }
    } finally { this.announcing = false; }
  }
  private async deliverActivation(moduleId: string, hash: string, signature: string) {
    const now = this.ports.now().toISOString(), attempt = `${moduleId} ${signature}`;
    try { await this.deliver(moduleId, hash, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} }); }
    catch {
      const tries = (this.announceAttempts.get(attempt) ?? 0) + 1;
      this.announceAttempts.set(attempt, tries);
      if (tries < 3) return false;
    }
    return true;
  }
  private async manifestOf(moduleId: string, hash: string) {
    if (!this.manifests.has(hash)) this.manifests.set(hash, moduleManifestSchema.safeParse((await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } }))?.manifest).data ?? null);
    return this.manifests.get(hash);
  }
  private async validateTrigger(instance: Instance, event: ModuleEvent) {
    const { trigger } = event, { manifest, moduleId } = instance;
    switch (trigger.kind) {
      case "timer":
        if (!await this.ports.db.moduleInvocation.findFirst({ where: { id: trigger.eventId, workspaceId: instance.scope.workspaceId, targetModuleId: moduleId, targetHash: instance.hash, mode: "timer", status: "running" } })) throw staged(new Error("Timer event lacks its exact delivery claim"), "unavailable");
        return;
      case "schedule":
        // Only the module's own runtime timers deliver schedule events.
        if (trigger.scheduleId === undefined || trigger.payload === undefined || !await this.ports.db.schedule.findFirst({ where: { id: trigger.scheduleId, moduleId, mode: "module" } })) throw staged(new Error("Dynamic schedule requires its own timer"), "unavailable");
        return;
      case "tool":
        if (!manifest.tools.some(tool => tool.name === trigger.id)) throw staged(new Error("Module trigger missing"), "unavailable");
        return;
      case "activated":
        if (!manifest.activated) throw staged(new Error("Module has no activated handler"), "unavailable");
        return;
      case "call_result": return;
      default: throw staged(new Error("Unsupported module event kind"), "unavailable");
    }
  }
  private async sendEvent(instance: Instance, event: ModuleEvent, workspaceId: string, requested?: number, dispatch?: DeliveryOptions["dispatch"]) {
    const { manifest } = instance;
    try { await (instance.start ??= this.startInstance(instance)); }
    catch (error) { throw staged(error, "unavailable"); }
    const { timeoutMs, params } = await eventLimits(this.ports, manifest, workspaceId, requested);
    const bindings = await this.bindings(workspaceId);
    let reply: Reply;
    try { reply = await instance.channel!.send({ ...event, params, bindings }, timeoutMs, dispatch); }
    catch (error) { throw staged(error, (error as { written?: boolean }).written === false ? "unavailable" : "lost"); }
    if ("error" in reply) throw staged(Object.assign(new Error(reply.error), { code: reply.errorCode, reason: reply.errorReason }), "handler");
    return reply;
  }
  private async failedDelivery(instance: Instance, event: ModuleEvent, runId: string, error: unknown) {
    if (error instanceof Error) await this.collectExit(instance, error.message);
    await this.close(instance).catch(() => {});
    await this.failure(instance, instance.stopUnknown ? String(instance.stopUnknown) : error instanceof Error ? error.message : String(error), runId, event, (error as { stage?: DeliveryStage }).stage);
    if (instance.stopUnknown) throw staged(instance.stopUnknown, (error as { stage?: DeliveryStage }).stage ?? "unavailable");
    await this.restartCurrent(instance);
  }
  private async finishEvent(instance: Instance) {
    await this.finishBusy(instance);
    delete instance.scope.moduleRunId; delete instance.scope.eventKey; delete instance.scope.chain; delete instance.scope.path;
    if (!isClosing(instance) && !instance.manifest.keepAlive) instance.idle = this.timers.setTimeout(() => { void instance.queue.then(() => this.close(instance)).catch(error => this.failure(instance, String(error))).catch(() => {}); }, this.idleMs);
  }
  private async recordEventResult(input: { instance: Instance; event: ModuleEvent; workspaceId: string; runId: string; reply: Reply; private?: boolean; validateResult?: DeliveryOptions["validateResult"] }) {
    const { instance, event, workspaceId, runId, reply, validateResult } = input;
    if ("error" in reply) throw staged(Object.assign(new Error(reply.error), { code: reply.errorCode, reason: reply.errorReason }), "handler");
    const outputError = validateResult?.(reply.result.result ?? null) ?? null;
    if (outputError) {
      await this.ports.db.moduleRun.update({ where: { id: runId }, data: { exitCode: 1, error: input.private ? "Private operation returned an invalid result" : outputError.slice(0, 1000) } });
      return;
    }
    await this.ports.db.moduleRun.update({ where: { id: runId }, data: { exitCode: 0, output: input.private ? {} : reply.result } });
    this.backoffFailures.set(keyOf(instance.moduleId, instance.hash, instance.activationId), 0);
    await recordModuleRecovery(this.ports, { workspaceId, moduleId: instance.moduleId, hash: instance.hash, activationId: instance.activationId, triggerId: triggerKey(event), runId }).catch(error => console.error(JSON.stringify({ component: "module-supervisor", event: "recovery_diagnostic.persist_failed", moduleId: instance.moduleId, hash: instance.hash, error: diagnosticText(String(error), 300) })));
  }
  private async assertCurrentActivation(instance: Instance) {
    const { moduleId, hash } = instance;
    const module = await this.ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    const evolution = await currentModuleEvolution(this.ports.db, module.workspaceId, moduleId, hash);
    if (isModulePaused(module.name)) {
      await this.close(instance);
      throw Object.assign(staged(new ModuleUnavailableError(module.name), "unavailable"), { staleActivation: true });
    }
    if (this.stopped || instance.closing || module.status !== "active" || module.activeHash !== hash || module.activationId !== instance.scope.receiverActivationId || (evolution?.activationId ?? null) !== instance.activationId) {
      await this.close(instance);
      throw Object.assign(staged(new Error("Module activation changed before event delivery"), "unavailable"), { staleActivation: true });
    }
    return module;
  }
  private async deliverEvent(instance: Instance, event: ModuleEvent, { chain = [], path = [], timeoutMs, validateResult, beforeDelivery, dispatch, private: privateTransport }: DeliveryOptions): Promise<Reply> {
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
      const reply = await this.sendEvent(instance, event, module.workspaceId, timeoutMs, dispatch);
      await this.recordEventResult({ instance, event, workspaceId: module.workspaceId, runId: run.id, reply, validateResult, private: privateTransport });
      return reply;
    } catch (error) {
      if ((error as { staleActivation?: boolean }).staleActivation) throw error;
      if (isHandlerRejection(error) || (error as { deliveryRejected?: boolean }).deliveryRejected) {
        // A validated application rejection (invalid input, conflict, permission, capacity)
        // completes this call; the SDK process remains healthy and can serve the next one.
        await this.ports.db.moduleRun.update({ where: { id: run.id }, data: handlerFailureData(error, privateTransport) });
      } else await this.failedDelivery(instance, event, run.id, privateTransport ? staged(new Error("Private operation failed"), (error as { stage?: DeliveryStage }).stage ?? "lost") : error);
      throw deliveryFailure(error, privateTransport);
    } finally { await this.finishEvent(instance); }
  }
  /** Delivers one event serially; chain/path track routed calls, and failures carry their delivery stage. */
  async deliver(moduleId: string, hash: string, event: ModuleEvent, options: DeliveryOptions = {}): Promise<Reply> {
    // A new request must not bypass recovery backoff or count as another failed execution.
    if (this.restarts.has(moduleId)) throw staged(new Error("模块正在等待恢复，请稍后查看诊断状态"), "unavailable");
    const instance = await this.get(moduleId, hash).catch(error => { throw staged(options.private ? new Error("Private operation unavailable") : error, "unavailable"); });
    // A long-lived provider can print a previously received token on a later exit.
    // Once it has handled private transport, suppress its process output for its lifetime.
    if (options.private) instance.privateTransport = true;
    if (instance.idle) this.timers.clearTimeout(instance.idle);
    if (options.activationId !== undefined && options.activationId !== instance.activationId) throw staged(new Error("Module activation changed before event delivery"), "unavailable");
    const result = instance.queue.then(() => this.deliverEvent(instance, event, options));
    instance.queue = result.catch(() => {});
    return result;
  }
  /** Authenticated HTTP endpoint of the active module serving path; null when unavailable. */
  async listener(path: string) {
    for (const module of await this.ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } })) {
      if (isModulePaused(module.name)) continue;
      const version = await this.ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
      if (!listenPaths(moduleManifestSchema.safeParse(version?.manifest).data ?? {}).includes(path)) continue;
      if (this.stopped || this.restarts.has(module.id)) return null;
      try {
        const instance = await this.get(module.id, module.activeHash!);
        if (instance.idle) this.timers.clearTimeout(instance.idle);
        await (instance.start ??= this.startInstance(instance));
        const endpoint = await (instance.httpReady ??= moduleHttpReady(instance.channel!, this.timers));
        await this.assertCurrentActivation(instance); return endpoint;
      } catch { return null; }
    }
    return null;
  }
  status(moduleId: string, hash: string | null, keepAlive: boolean) {
    const held = [...this.instances.values()].find(instance => instance.moduleId === moduleId && instance.stopUnknown);
    if (held) return { state: "unknown" as const, pid: held.process?.pid ?? null, error: diagnosticText(String(held.stopUnknown), 1000) };
    const stopping = [...this.instances.values()].find(instance => instance.moduleId === moduleId && (instance.retiring || instance.closing));
    if (stopping) return { state: "stopping" as const, pid: stopping.process?.pid ?? null };
    if (!this.started || this.stopped) return { state: "unobserved" as const, pid: null };
    if (this.restarts.has(moduleId)) return { state: "backoff" as const, pid: null };
    const currentKey = this.current.get(moduleId), instance = currentKey ? this.instances.get(currentKey) : undefined;
    return instanceStatus(instance, hash, keepAlive);
  }
  async start() {
    if (this.started) return;
    this.stopped = false; this.started = true;
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
    const results = await Promise.allSettled([...this.instances.values()].map(async instance => {
      try { await this.close(instance); } finally { await instance.start?.catch(() => {}); }
    }));
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Module shutdown could not confirm descendant stop");
    this.current.clear();
  }
}

export function createModuleSupervisor(ports: StewardPorts, { timers = globalThis, idleMs = 10 * 60_000, backoffMs = 1000 }: Options = {}) {
  const runtime = new ModuleSupervisor(ports, timers, idleMs, backoffMs);
  // Preserve the closure API: consumers may extract methods without a receiver.
  return { deliver: runtime.deliver.bind(runtime), reconcile: runtime.reconcile.bind(runtime), listener: runtime.listener.bind(runtime),
    status: runtime.status.bind(runtime), start: runtime.start.bind(runtime), stop: runtime.stop.bind(runtime), settleModule: runtime.settleModule.bind(runtime) };
}
