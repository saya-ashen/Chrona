import type { Prisma } from "@chrona/db";
import { isEntryModule, MODULE_METHODS, NOTIFY_INTERFACE, type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { createRuns, createRunSession } from "./runs";
import { handleModuleModel, type CallScope } from "./module-model";
import { CallError, callStatus, callSync, drainCalls, enqueueCall, type CallOrigin } from "./module-calls";
import { notifyUser } from "./notify-user";
export type { CallScope } from "./module-model";

export type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

function originOf(scope: CallScope): CallOrigin {
  return { workspaceId: scope.workspaceId, caller: { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash }, chain: scope.chain ?? [], path: scope.path ?? [] };
}
const failed = (id: string, error: unknown): Reply => error instanceof CallError
  ? { id, error: { code: error.code, message: error.message.slice(0, 500) } }
  : { id, error: { code: "internal", message: "Module call failed" } };

/** Routed calls: the target must be in `uses`; Chrona records the real caller and refuses waits on itself. */
async function routedCall(ports: StewardPorts, scope: CallScope, call: Extract<ModuleCall, { method: "call" }>): Promise<Reply> {
  const { target, args, mode, key, reply, timeoutMs } = call.params, now = ports.now();
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "call", createdAt: now };
  if (!scope.manifest.uses.includes(target)) {
    await ports.db.moduleCall.create({ data: { ...record, key: target, status: "rejected", error: "undeclared" } });
    return { id: call.id, error: { code: "undeclared", message: `${target} is not in the manifest's uses` } };
  }
  try {
    if (mode === "sync") {
      const result = await callSync(ports, originOf(scope), target, args, timeoutMs ? { timeoutMs } : {});
      await ports.db.moduleCall.create({ data: { ...record, key: result.callId, status: "executed" } });
      return { id: call.id, result: { output: result.output } };
    }
    // The caller owns its keys (derive them from what is being done): a repeat after a crash returns the same call.
    const queued = await enqueueCall(ports.db, ports, originOf(scope), target, args, { key: key!, reply });
    await ports.db.moduleCall.create({ data: { ...record, key: queued.callId, status: queued.duplicate ? "duplicate" : "executed" } });
    if (!queued.duplicate) void drainCalls(ports, scope.workspaceId).catch(() => {});
    return { id: call.id, result: queued };
  } catch (error) {
    await ports.db.moduleCall.create({ data: { ...record, key: target, status: error instanceof CallError && error.code !== "unknown" ? "rejected" : "failed", error: error instanceof CallError ? error.code : "internal" } }).catch(() => {});
    return failed(call.id, error);
  }
}

/** Effect calls are serialized by the supervisor, including calls made outside an event; owner and routed calls are not. */
export async function handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<Reply> {
  if (call.method === "model") return handleModuleModel(ports, scope, call);
  if (call.method === "call") return routedCall(ports, scope, call);
  if (call.method === "callStatus") {
    try { return { id: call.id, result: await callStatus(ports, originOf(scope), call.params.callId) as Extract<Reply, { result: unknown }>["result"] }; }
    catch (error) { return failed(call.id, error); }
  }
  if (call.method === "owner") {
    if (!scope.manifest.effects.includes("owner")) return { id: call.id, error: { code: "undeclared", message: "Module capability not declared" } };
    if (!ports.owner) return { id: call.id, error: { code: "unconfigured", message: "Owner API unavailable" } };
    try { return { id: call.id, result: await ports.owner(scope.workspaceId, call.params, { module: scope.manifest.name }) }; }
    catch { return { id: call.id, error: { code: "internal", message: "Owner API call failed" } }; }
  }
  if (call.method === "secret") {
    if (!isEntryModule(scope.manifest) || !scope.manifest.secrets.includes(call.params.name)) return { id: call.id, error: { code: "undeclared", message: "Secret not declared" } };
    const value = await ports.secrets?.(call.params.name).catch(() => null);
    return value ? { id: call.id, result: { value } } : { id: call.id, error: { code: "unconfigured", message: "Secret not configured" } };
  }
  const now = ports.now();
  const key = scope.eventKey ? `${scope.eventKey}:${call.params.key}` : call.params.key;
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: call.method, key, createdAt: now };
  try {
    const result = await ports.db.$transaction(async tx => {
      if (!scope.manifest.effects.includes(MODULE_METHODS[call.method])) {
        await tx.moduleCall.create({ data: { ...record, status: "rejected", error: "undeclared" } });
        return { id: call.id, error: { code: "undeclared" as const, message: "Module capability not declared" } };
      }
      const previous = await tx.moduleCall.findFirst({ where: { moduleId: scope.moduleId, method: call.method, key, status: "executed" } });
      let status: "executed" | "duplicate" = previous ? "duplicate" : "executed";
      if (!previous) {
        const { workspaceId, moduleId } = scope;
        if (call.method === "notify") {
          // `chrona.notify` is shorthand for an async call to notify.send; `notify_user` is the permission for it.
          const queued = await enqueueCall(tx, ports, originOf(scope), NOTIFY_INTERFACE, { key, level: call.params.level, title: call.params.title, body: call.params.body }, { key, lenient: true });
          if (queued.duplicate) status = "duplicate";
        } else {
          const session = await createRunSession(tx, workspaceId, "module", now, { moduleId });
          await createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", label: scope.manifest.name, prompt: `Module ${scope.manifest.name} output (untrusted data):\n${call.params.prompt}` }, tx);
        }
      }
      await tx.moduleCall.create({ data: { ...record, status } });
      return { id: call.id, result: { status } };
    });
    if (call.method === "notify" && "result" in result && result.result?.status === "executed") void drainCalls(ports, scope.workspaceId).catch(() => {});
    return result;
  } catch (error) {
    await ports.db.moduleCall.create({ data: { ...record, status: "failed", error: error instanceof CallError ? error.code : "internal" } });
    return failed(call.id, error);
  }
}

export async function pauseFailedModule(tx: Prisma.TransactionClient, ports: StewardPorts, execution: ModuleExecution, runId: string) {
  const { moduleId, workspaceId } = execution;
  const recent = await tx.moduleRun.findMany({ where: { moduleId, id: { not: runId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
  if (recent.length !== 2 || recent.some(run => !run.error)) return;
  const paused = await tx.module.updateMany({ where: { id: moduleId, status: "active" }, data: { status: "paused" } });
  if (!paused.count) return;
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active" }, data: { status: "paused" } });
  const module = await tx.module.findUnique({ where: { id: moduleId } });
  await notifyUser(tx, ports, workspaceId, { module: moduleId, ...(module ? { app: module.name } : {}), level: "now", title: "模块连续失败，已暂停", body: "模块连续三次执行失败，请检查后再启用。", key: `module:${moduleId}:paused:${execution.firedAt.toISOString()}` });
}
