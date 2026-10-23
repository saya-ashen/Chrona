import { mkdtemp, chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, RUN_LIMITS, type ModuleEvent, type ModuleManifest, type moduleEventReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { registerBuiltins } from "./module-builtin";
import { createModuleChannel } from "./module-channel";
import { handleModuleCall, pauseFailedModule, type CallScope } from "./module-effects";

type Reply = ReturnType<typeof moduleEventReplySchema.parse>;
type Process = ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>>;
type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
type Instance = {
  moduleId: string; hash: string; manifest: ModuleManifest; scope: CallScope;
  queue: Promise<unknown>; calls: Promise<unknown>; start?: Promise<void>;
  process?: Process; channel?: Awaited<ReturnType<typeof createModuleChannel>>;
  dir?: string; idle?: ReturnType<typeof setTimeout>; retiring: boolean; closing: boolean; busy: boolean;
};
// Services wrap ports to add callbacks; process ownership belongs to the runtime's DB/data pair.
const supervisors = new WeakMap<StewardPorts["db"], Map<string, ReturnType<typeof createModuleSupervisor>>>();
export function moduleSupervisor(ports: StewardPorts) {
  let runtimes = supervisors.get(ports.db);
  if (!runtimes) { runtimes = new Map(); supervisors.set(ports.db, runtimes); }
  let supervisor = runtimes.get(ports.dataDir);
  if (!supervisor) { supervisor = createModuleSupervisor(ports); runtimes.set(ports.dataDir, supervisor); }
  return supervisor;
}

export function createModuleSupervisor(ports: StewardPorts, { timers = globalThis, idleMs = 10 * 60_000, backoffMs = 1000 }: { timers?: Timers; idleMs?: number; backoffMs?: number } = {}) {
  const instances = new Map<string, Instance>(), current = new Map<string, string>(), failures = new Map<string, number>();
  const restarts = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false, started = false, poll: ReturnType<typeof setTimeout> | undefined;
  const keyOf = (moduleId: string, hash: string) => `${moduleId}:${hash}`;
  async function close(instance: Instance) {
    instance.closing = true;
    if (instance.idle) timers.clearTimeout(instance.idle);
    instance.process?.kill();
    await instance.channel?.close();
    await instance.process?.exited.catch(() => {});
    await instance.calls.catch(() => {});
    if (instance.dir) await rm(instance.dir, { recursive: true, force: true });
    if (instances.get(keyOf(instance.moduleId, instance.hash)) === instance) instances.delete(keyOf(instance.moduleId, instance.hash));
  }
  function retire(instance: Instance) {
    instance.retiring = true;
    void instance.queue.finally(() => close(instance)).catch(() => {});
  }
  async function failure(instance: { moduleId: string; hash: string; scope: Pick<CallScope, "workspaceId"> }, error: string, runId?: string, event?: ModuleEvent) {
    const now = ports.now(), execution = { workspaceId: instance.scope.workspaceId, moduleId: instance.moduleId, hash: instance.hash, triggerId: event ? event.trigger.kind === "tool" ? `tool:${event.trigger.id}` : event.trigger.id : "process", firedAt: event ? new Date(event.trigger.firedAt) : now };
    failures.set(instance.moduleId, (failures.get(instance.moduleId) ?? 0) + 1);
    const context = { now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl };
    await ports.db.$transaction(async tx => {
      const run = runId ? await tx.moduleRun.update({ where: { id: runId }, data: { error, exitCode: -1 } }) : await tx.moduleRun.create({ data: { moduleId: instance.moduleId, hash: instance.hash, triggerId: execution.triggerId, firedAt: execution.firedAt, exitCode: -1, error, createdAt: now } });
      await pauseFailedModule(tx, execution, context, run.id);
    });
  }
  function restart(instance: Instance) {
    if (stopped || instance.retiring || !instance.manifest.keepAlive || restarts.has(instance.moduleId)) return;
    const timer = timers.setTimeout(() => {
      restarts.delete(instance.moduleId);
      void ensureActive(instance.moduleId).catch(() => {});
    }, Math.min(60_000, backoffMs * 2 ** Math.max(0, (failures.get(instance.moduleId) ?? 1) - 1)));
    restarts.set(instance.moduleId, timer);
  }
  async function start(instance: Instance) {
    try {
      if (stopped || instance.closing) throw new Error("Module supervisor stopped");
      if (!ports.sandbox?.available || !ports.sandbox.startModule) throw new Error("Module sandbox unavailable");
      // Deliberately not under dataDir: deep installations exceed Unix socket path limits.
      instance.dir = await mkdtemp("/tmp/cm-");
      await chmod(instance.dir, 0o700);
      const dataDir = join(ports.dataDir, "platform/data", instance.moduleId);
      await mkdir(dataDir, { recursive: true });
      instance.channel = await createModuleChannel(join(instance.dir, "s"), { timers, onCall: call => {
        const scope = { ...instance.scope };
        const result = instance.calls.then(() => handleModuleCall(ports, scope, call));
        instance.calls = result.catch(() => {});
        return result;
      } });
      if (stopped || instance.closing) throw new Error("Module supervisor stopped");
      const contentDir = instance.manifest.content ? join(ports.dataDir, "platform/content", instance.moduleId) : undefined;
      if (contentDir) await mkdir(contentDir, { recursive: true });
      const process = ports.sandbox.startModule({ codeDir: join(ports.dataDir, "platform/store", instance.hash), dataDir, ...(contentDir ? { contentDir } : {}), entry: instance.manifest.entry, socketPath: join(instance.dir, "s"), network: instance.manifest.effects.includes("network") });
      instance.process = process;
      const exited = process.exited.then(() => { throw new Error("Module process exited"); });
      void exited.catch(() => {});
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([instance.channel.ready, exited, new Promise<never>((_, reject) => { timeout = timers.setTimeout(() => reject(new Error("Module start timeout")), RUN_LIMITS.jobTimeoutMs); })]);
      } finally { if (timeout) timers.clearTimeout(timeout); }
      void process.exited.catch(() => {}).then(async () => {
        if (instance.closing || instance.busy) return;
        await failure(instance, "Module process exited");
        await close(instance); restart(instance);
      }).catch(() => {});
    } catch (error) {
      await close(instance);
      throw error;
    }
  }
  async function get(moduleId: string, hash: string) {
    if (stopped) throw new Error("Module supervisor stopped");
    const module = await ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    if (stopped) throw new Error("Module supervisor stopped");
    if (module.status !== "active" || module.activeHash !== hash) throw new Error("Module version is not active");
    const key = keyOf(moduleId, hash), previous = current.get(moduleId);
    if (previous && previous !== key) { const old = instances.get(previous); if (old) retire(old); }
    current.set(moduleId, key);
    let instance = instances.get(key);
    if (!instance) {
      const version = await ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId, hash } } });
      // Another caller may have finished the same asynchronous lookup.
      if (stopped) throw new Error("Module supervisor stopped");
      instance = instances.get(key);
      if (!instance) {
        const manifest = moduleManifestSchema.parse(version.manifest);
        instance = { moduleId, hash, manifest, scope: { workspaceId: module.workspaceId, moduleId, hash, manifest }, queue: Promise.resolve(), calls: Promise.resolve(), retiring: false, closing: false, busy: false };
        instances.set(key, instance);
      }
    }
    return instance;
  }
  async function ensureActive(moduleId: string) {
    const module = await ports.db.module.findUnique({ where: { id: moduleId } });
    if (stopped || restarts.has(moduleId) || module?.status !== "active" || !module.activeHash) return;
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
    if (!moduleManifestSchema.safeParse(version?.manifest).data?.keepAlive) return;
    const instance = await get(moduleId, module.activeHash);
    if (instance.start) return;
    instance.busy = true;
    try { await (instance.start = start(instance)); }
    catch (error) { await failure(instance, String(error).slice(0, 2000)); restart(instance); }
    finally { instance.busy = false; }
  }
  async function reconcile() {
    if (stopped) return;
    const modules = await ports.db.module.findMany({ where: { status: "active", activeHash: { not: null } } });
    const active = new Map(modules.map(module => [module.id, module.activeHash]));
    for (const instance of instances.values()) if (active.get(instance.moduleId) !== instance.hash) retire(instance);
    for (const module of modules) await ensureActive(module.id);
  }
  async function deliver(moduleId: string, hash: string, event: ModuleEvent, { inboundItemId }: { inboundItemId?: string } = {}): Promise<Reply> {
    let instance: Instance;
    try { instance = await get(moduleId, hash); }
    catch (error) {
      const module = await ports.db.module.findUnique({ where: { id: moduleId } });
      if (!stopped && module?.status === "active" && module.activeHash === hash) await failure({ moduleId, hash, scope: module }, String(error).slice(0, 2000), undefined, event);
      throw error;
    }
    if (instance.idle) timers.clearTimeout(instance.idle);
    const result = instance.queue.then(async () => {
      const module = await ports.db.module.findUniqueOrThrow({ where: { id: moduleId } });
      if (stopped || module.status !== "active") throw new Error("Module is not active");
      const run = await ports.db.moduleRun.create({ data: { moduleId, hash, triggerId: event.trigger.kind === "tool" ? `tool:${event.trigger.id}` : event.trigger.id, inboundItemId, firedAt: new Date(event.trigger.firedAt), exitCode: -1, createdAt: ports.now() } });
      instance.busy = true;
      instance.scope.moduleRunId = run.id;
      instance.scope.eventKey = inboundItemId ? `inbound:${inboundItemId}` : `${event.trigger.id}:${event.trigger.firedAt}`;
      try {
        const dynamic = event.trigger.kind === "schedule" && event.trigger.scheduleId !== undefined && event.trigger.payload !== undefined;
        if (dynamic) {
          if (!module.builtin || !instance.manifest.dynamicSchedules || !await ports.db.schedule.findFirst({ where: { id: event.trigger.kind === "schedule" ? event.trigger.scheduleId : undefined, moduleId, mode: "module" } })) throw new Error("Dynamic schedule requires a built-in module declaring dynamicSchedules");
        } else if (event.trigger.kind === "content_edit" ? !instance.manifest.content : event.trigger.kind === "tool" ? !instance.manifest.tools.some(tool => tool.name === event.trigger.id) : !instance.manifest.triggers.some(trigger => trigger.id === event.trigger.id)) throw new Error("Module trigger missing");
        await (instance.start ??= start(instance));
        const reply = await instance.channel!.send({ ...event, params: Object.fromEntries(Object.entries(instance.manifest.params).map(([key, param]) => [key, param.value])) }, RUN_LIMITS.jobTimeoutMs);
        await instance.calls;
        if ("error" in reply) throw new Error(reply.error);
        await ports.db.moduleRun.update({ where: { id: run.id }, data: { exitCode: 0, output: reply.result } });
        failures.set(moduleId, 0);
        return reply;
      } catch (error) {
        await failure(instance, (error instanceof Error ? error.message : String(error)).slice(0, 2000), run.id, event);
        await close(instance); restart(instance);
        throw error;
      } finally {
        instance.busy = false;
        delete instance.scope.moduleRunId; delete instance.scope.eventKey;
        if (!instance.closing && !instance.manifest.keepAlive) instance.idle = timers.setTimeout(() => { void instance.queue.then(() => close(instance)); }, idleMs);
      }
    });
    instance.queue = result.catch(() => {});
    return result;
  }
  return {
    deliver, reconcile,
    async start() {
      if (started) return;
      stopped = false; started = true;
      for (const workspace of await ports.db.workspace.findMany()) await registerBuiltins(ports, workspace.id);
      const loop = async () => { try { await reconcile(); } finally { if (!stopped) poll = timers.setTimeout(() => { void loop().catch(() => {}); }, 30_000); } };
      await loop();
    },
    async stop() {
      stopped = true; started = false;
      if (poll) timers.clearTimeout(poll);
      for (const timer of restarts.values()) timers.clearTimeout(timer);
      restarts.clear();
      await Promise.all([...instances.values()].map(async instance => { await close(instance); await instance.start?.catch(() => {}); }));
      current.clear();
    },
  };
}
