import { mkdtemp, chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { listenPaths, moduleManifestSchema, RUN_LIMITS, type ModuleEvent, type ModuleManifest, type moduleEventReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleModelSettings } from "./settings";
import { registerBuiltins } from "./module-builtin";
import { createModuleChannel } from "./module-channel";
import { handleModuleCall, pauseFailedModule, type CallScope } from "./module-effects";
import { diagnosticText, recordModuleFailure, recordModuleRecovery, type ModuleFailureEvidence } from "./module-diagnostics";

type Reply = ReturnType<typeof moduleEventReplySchema.parse>;
/** Where a failed delivery stopped: never reached the module, the module answered with an error, or lost after sending. */
export type DeliveryStage = "unavailable" | "handler" | "lost";
function staged(error: unknown, stage: DeliveryStage) {
  const base: Error & { stage?: DeliveryStage } = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { stage: base.stage ?? stage });
}
type Process = ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>>;
type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
type Options = { timers?: Timers; idleMs?: number; backoffMs?: number };
type DeliveryOptions = { chain?: string[]; path?: string[]; timeoutMs?: number };
type Instance = {
  moduleId: string; hash: string; manifest: ModuleManifest; scope: CallScope;
  queue: Promise<unknown>; start?: Promise<void>;
  process?: Process; channel?: Awaited<ReturnType<typeof createModuleChannel>>;
  dir?: string; idle?: ReturnType<typeof setTimeout>; retiring: boolean; closing: boolean; busy: boolean; connected?: boolean;
  exit?: { code: number | null; signal: string | null };
  failureEvidence?: ModuleFailureEvidence;
};
const triggerKey = (event: ModuleEvent) => event.trigger.kind === "tool" ? `tool:${event.trigger.id}` : event.trigger.kind === "call_result" ? `call_result:${event.trigger.callId}` : event.trigger.id;
const isClosing = (instance: Instance) => instance.closing;
const keyOf = (moduleId: string, hash: string) => `${moduleId}:${hash}`;
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
  private readonly failures = new Map<string, number>();
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
    if (this.instances.get(keyOf(instance.moduleId, instance.hash)) === instance) this.instances.delete(keyOf(instance.moduleId, instance.hash));
  }
  private retire(instance: Instance) {
    instance.retiring = true;
    void instance.queue.finally(() => this.close(instance)).catch(() => {});
  }
  private async failure(instance: { moduleId: string; hash: string; scope: Pick<CallScope, "workspaceId"> } & Partial<Omit<Instance, "scope">>, error: string, runId?: string, event?: ModuleEvent, delivery?: DeliveryStage) {
    const { ports } = this;
    const now = ports.now(), execution = { workspaceId: instance.scope.workspaceId, moduleId: instance.moduleId, hash: instance.hash, triggerId: event ? triggerKey(event) : "process", firedAt: event ? new Date(event.trigger.firedAt) : now };
    const failureKey = keyOf(instance.moduleId, instance.hash);
    this.failures.set(failureKey, (this.failures.get(failureKey) ?? 0) + 1);
    const detail = { ...(instance.failureEvidence ?? evidence(instance, error, runId, event)), reason: diagnosticText(error, 1000), runId: runId ?? null,
      triggerId: execution.triggerId, delivery: delivery ?? null };
    // Journal still has attributed evidence if SQLite itself cannot record the incident.
    console.error(JSON.stringify({ component: "module-supervisor", event: "module.failure", moduleId: instance.moduleId, module: instance.manifest?.name, hash: instance.hash, ...detail }));
    await ports.db.$transaction(async tx => {
      const data = { error: diagnosticText(error, 2000), exitCode: detail.exitCode ?? -1 };
      const run = runId ? await tx.moduleRun.update({ where: { id: runId }, data }) : await tx.moduleRun.create({ data: { moduleId: instance.moduleId, hash: instance.hash, triggerId: execution.triggerId, firedAt: execution.firedAt, ...data, createdAt: now } });
      await pauseFailedModule(tx, ports, execution, run.id);
      const module = await tx.module.findUnique({ where: { id: instance.moduleId } });
      await recordModuleFailure(tx, { workspaceId: execution.workspaceId, moduleId: instance.moduleId, hash: instance.hash, now,
        retry: !this.stopped && !instance.retiring && !!instance.manifest?.keepAlive && module?.status === "active" && module.activeHash === instance.hash && (this.failures.get(failureKey) ?? 0) < 3,
        evidence: { ...detail, runId: run.id } });
    });
  }
  private restart(instance: Instance) {
    if (this.stopped || instance.retiring || !instance.manifest.keepAlive || this.restarts.has(instance.moduleId) || (this.failures.get(keyOf(instance.moduleId, instance.hash)) ?? 0) >= 3) return;
    const timer = this.timers.setTimeout(() => {
      this.restarts.delete(instance.moduleId);
      void this.ensureActive(instance.moduleId).catch(() => {});
    }, Math.min(60_000, this.backoffMs * 2 ** Math.max(0, (this.failures.get(keyOf(instance.moduleId, instance.hash)) ?? 1) - 1)));
    this.restarts.set(instance.moduleId, timer);
  }
  private async unexpectedExit(instance: Instance, reason = "Module process exited") {
    if (instance.closing || instance.busy) return;
    instance.busy = true;
    await this.collectExit(instance, reason);
    try { await this.failure(instance, reason); }
    finally { await this.close(instance); this.restart(instance); instance.busy = false; }
  }
  private async collectExit(instance: Instance, reason: string) {
    // Socket close can precede the child's exit notification; collect evidence, never replay the event.
    if (reason === "Module disconnected" && instance.process) await Promise.race([instance.process.exited.catch(() => {}), new Promise(resolve => setTimeout(resolve, 50))]);
  }
  private async spawn(instance: Instance, sandbox: NonNullable<StewardPorts["sandbox"]>) {
    const { ports, timers } = this;
    // Deliberately not under dataDir: deep installations exceed Unix socket path limits.
    instance.dir = await mkdtemp("/tmp/cm-");
    await chmod(instance.dir, 0o700);
    const dataDir = join(ports.dataDir, "platform/data", instance.moduleId);
    await mkdir(dataDir, { recursive: true });
    // Only routed calls cross the channel (v2-10); each waits for its own target, never for the module's other calls.
    instance.channel = await createModuleChannel(join(instance.dir, "s"), { timers, onCall: call => handleModuleCall(ports, { ...instance.scope }, call) });
    if (this.isStopped() || isClosing(instance)) throw new Error("Module supervisor stopped");
    const contentDir = instance.manifest.content ? join(ports.dataDir, "platform/content", instance.moduleId) : undefined;
    if (contentDir) await mkdir(contentDir, { recursive: true });
    const httpDir = instance.manifest.listen ? join(instance.dir, "http") : undefined;
    if (httpDir) await mkdir(httpDir, { mode: 0o700 });
    const process = sandbox.startModule!({ codeDir: join(ports.dataDir, "platform/store", instance.hash), dataDir, ...(contentDir ? { contentDir } : {}), ...(httpDir ? { httpDir } : {}), ...(ports.publicUrl ? { env: { CHRONA_PUBLIC_URL: ports.publicUrl } } : {}), entry: instance.manifest.entry, socketPath: join(instance.dir, "s"), network: instance.manifest.effects.includes("network") });
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
    await recordModuleRecovery(this.ports, instance.scope.workspaceId, instance.moduleId, instance.hash);
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
  private async get(moduleId: string, hash: string) {
    if (this.isStopped()) throw new Error("Module supervisor stopped");
    const module = await this.ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    if (this.isStopped()) throw new Error("Module supervisor stopped");
    if (module.status !== "active" || module.activeHash !== hash) throw new Error("Module version is not active");
    const key = keyOf(moduleId, hash), previous = this.current.get(moduleId);
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
        instance = { moduleId, hash, manifest, scope: { workspaceId: module.workspaceId, moduleId, hash, manifest }, queue: Promise.resolve(), retiring: false, closing: false, busy: false };
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
    catch (error) { await this.failure(instance, String(error).slice(0, 2000)); this.restart(instance); }
    finally { await this.finishBusy(instance); }
  }
  async reconcile() {
    if (this.stopped) return;
    const modules = await this.ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } });
    const active = new Map(modules.map(module => [module.id, module.activeHash]));
    for (const instance of this.instances.values()) if (active.get(instance.moduleId) !== instance.hash) this.retire(instance);
    for (const module of modules) await this.ensureActive(module.id);
  }
  private async validateTrigger(instance: Instance, event: ModuleEvent, builtin: boolean) {
    const { trigger } = event, { manifest, moduleId } = instance;
    const dynamic = trigger.kind === "schedule" && trigger.scheduleId !== undefined && trigger.payload !== undefined;
    if (dynamic) {
      if (!builtin || !manifest.dynamicSchedules || !await this.ports.db.schedule.findFirst({ where: { id: trigger.scheduleId, moduleId, mode: "module" } })) throw staged(new Error("Dynamic schedule requires a built-in module declaring dynamicSchedules"), "unavailable");
    } else if (trigger.kind === "call_result" ? !manifest.uses.length : trigger.kind === "tool" ? !manifest.tools.some(tool => tool.name === trigger.id) : !manifest.triggers.some(candidate => candidate.id === trigger.id)) throw staged(new Error("Module trigger missing"), "unavailable");
  }
  private async sendEvent(instance: Instance, event: ModuleEvent, workspaceId: string, requested?: number) {
    const { manifest } = instance;
    try { await (instance.start ??= this.startInstance(instance)); }
    catch (error) { throw staged(error, "unavailable"); }
    const workspace = manifest.model ? await this.ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }) : null;
    const timeoutMs = requested ?? (workspace ? moduleModelSettings(workspace.settings)?.timeoutMs ?? RUN_LIMITS.jobTimeoutMs : RUN_LIMITS.jobTimeoutMs);
    let reply: Reply;
    try { reply = await instance.channel!.send({ ...event, params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) }, timeoutMs); }
    catch (error) { throw staged(error, (error as { written?: boolean }).written === false ? "unavailable" : "lost"); }
    if ("error" in reply) throw staged(new Error(reply.error), "handler");
    return reply;
  }
  private async failedDelivery(instance: Instance, event: ModuleEvent, runId: string, error: unknown) {
    if (error instanceof Error) await this.collectExit(instance, error.message);
    try { await this.failure(instance, error instanceof Error ? error.message : String(error), runId, event, (error as { stage?: DeliveryStage }).stage); }
    finally { await this.close(instance); this.restart(instance); }
  }
  private async finishEvent(instance: Instance) {
    await this.finishBusy(instance);
    delete instance.scope.moduleRunId; delete instance.scope.eventKey; delete instance.scope.chain; delete instance.scope.path;
    if (!isClosing(instance) && !instance.manifest.keepAlive) instance.idle = this.timers.setTimeout(() => { void instance.queue.then(() => this.close(instance)); }, this.idleMs);
  }
  private async deliverEvent(instance: Instance, event: ModuleEvent, { chain = [], path = [], timeoutMs }: DeliveryOptions): Promise<Reply> {
    const { moduleId, hash } = instance;
    const module = await this.ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    if (this.stopped || instance.closing || module.status !== "active") throw staged(new Error("Module is not active"), "unavailable");
    const run = await this.ports.db.moduleRun.create({ data: { moduleId, hash, triggerId: triggerKey(event), firedAt: new Date(event.trigger.firedAt), exitCode: -1, createdAt: this.ports.now() } });
    instance.busy = true;
    instance.scope.moduleRunId = run.id;
    instance.scope.eventKey = `${event.trigger.id}:${event.trigger.firedAt}`;
    instance.scope.chain = chain; instance.scope.path = path;
    try {
      await this.validateTrigger(instance, event, module.builtin);
      const reply = await this.sendEvent(instance, event, module.workspaceId, timeoutMs);
      await this.ports.db.moduleRun.update({ where: { id: run.id }, data: { exitCode: 0, output: reply.result } });
      this.failures.set(keyOf(moduleId, hash), 0);
      await recordModuleRecovery(this.ports, module.workspaceId, moduleId, hash, triggerKey(event));
      return reply;
    } catch (error) {
      await this.failedDelivery(instance, event, run.id, error);
      throw error;
    } finally { await this.finishEvent(instance); }
  }
  /** Delivers one event serially; chain/path track routed calls, and failures carry their delivery stage. */
  async deliver(moduleId: string, hash: string, event: ModuleEvent, options: DeliveryOptions = {}): Promise<Reply> {
    // A new request must not bypass recovery backoff or count as another failed execution.
    if (this.restarts.has(moduleId)) throw staged(new Error("模块正在等待恢复，请稍后查看诊断状态"), "unavailable");
    let instance: Instance;
    try { instance = await this.get(moduleId, hash); }
    catch (error) {
      const module = await this.ports.db.module.findUnique({ where: { id: moduleId } });
      if (!this.stopped && module?.status === "active" && module.activeHash === hash) await this.failure({ moduleId, hash, scope: module }, String(error).slice(0, 2000), undefined, event);
      throw staged(error, "unavailable");
    }
    if (instance.idle) this.timers.clearTimeout(instance.idle);
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
      const instance = this.instances.get(keyOf(module.id, module.activeHash!));
      await instance?.start?.catch(() => {});
      return instance?.dir && !instance.closing ? join(instance.dir, "http/s") : null;
    }
    return null;
  }
  status(moduleId: string, hash: string | null, keepAlive: boolean) {
    if (!this.started || this.stopped) return { state: "unobserved" as const, pid: null };
    if (this.restarts.has(moduleId)) return { state: "backoff" as const, pid: null };
    const instance = hash ? this.instances.get(keyOf(moduleId, hash)) : undefined;
    if (instance && !instance.closing) return { state: instance.connected ? "running" as const : "starting" as const, pid: instance.process?.pid ?? null };
    return { state: keepAlive ? "unavailable" as const : "idle" as const, pid: null };
  }
  async start() {
    if (this.started) return;
    this.stopped = false; this.started = true;
    for (const workspace of await this.ports.db.workspace.findMany()) await registerBuiltins(this.ports, workspace.id);
    const loop = async () => { try { await this.reconcile(); } finally { if (!this.stopped) this.poll = this.timers.setTimeout(() => { void loop().catch(() => {}); }, 30_000); } };
    await loop();
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
  // Preserve the closure API: callers may extract methods without a receiver.
  return { deliver: runtime.deliver.bind(runtime), reconcile: runtime.reconcile.bind(runtime), listener: runtime.listener.bind(runtime),
    status: runtime.status.bind(runtime), start: runtime.start.bind(runtime), stop: runtime.stop.bind(runtime) };
}
