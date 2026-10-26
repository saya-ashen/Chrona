import type { Prisma } from "@chrona/db";
import { currentTarget, grantedUses, NOTIFY_INTERFACE, type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { CallScope } from "./module-model";
import { callerGranted, CallError, callStatus, callSync, drainCalls, enqueueCall, type CallOrigin } from "./module-calls";
import { notifyUser } from "./notify-user";
export type { CallScope } from "./module-model";

export type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

function originOf(scope: CallScope): CallOrigin {
  return { workspaceId: scope.workspaceId, caller: { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash }, chain: scope.chain ?? [], path: scope.path ?? [],
    run: { ...(scope.moduleRunId ? { moduleRunId: scope.moduleRunId } : {}), ...(scope.eventKey ? { eventKey: scope.eventKey } : {}) } };
}
const failed = (id: string, error: unknown): Reply => error instanceof CallError
  ? { id, error: { code: error.code, message: error.message.slice(0, 500) } }
  : { id, error: { code: "internal", message: "Module call failed" } };

/**
 * Routed calls: the target must be granted (`uses`, deprecated declarations, or `*`); Chrona records the real caller and
 * refuses waits on itself.
 */
async function routedCall(ports: StewardPorts, scope: CallScope, call: Extract<ModuleCall, { method: "call" }>): Promise<Reply> {
  const { args, mode, key, reply, timeoutMs } = call.params, target = currentTarget(call.params.target), now = ports.now();
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "call", createdAt: now };
  const uses = grantedUses(scope.manifest);
  if (!uses.includes(target) && !uses.includes("*") && !await callerGranted(ports.db, scope.workspaceId, target, scope.manifest.name)) {
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
    // A notification is stored even while the built-in notify module is not running (e.g. rebuilding); it is delivered later.
    const queued = await enqueueCall({ tx: ports.db, ports, origin: originOf(scope), target, raw: args }, { key: key!, reply, lenient: target === NOTIFY_INTERFACE });
    await ports.db.moduleCall.create({ data: { ...record, key: queued.callId, status: queued.duplicate ? "duplicate" : "executed" } });
    if (!queued.duplicate) void drainCalls(ports, scope.workspaceId).catch(() => {});
    return { id: call.id, result: queued };
  } catch (error) {
    await ports.db.moduleCall.create({ data: { ...record, key: target, status: error instanceof CallError && error.code !== "unknown" ? "rejected" : "failed", error: error instanceof CallError ? error.code : "internal" } }).catch(() => {});
    return failed(call.id, error);
  }
}

/** The module channel carries only routed calls (v2-10): every capability is an interface in `uses` (see grantedUses). */
export async function handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<Reply> {
  if (call.method === "call") return routedCall(ports, scope, call);
  try { return { id: call.id, result: await callStatus(ports, originOf(scope), call.params.callId) as Extract<Reply, { result: unknown }>["result"] }; }
  catch (error) { return failed(call.id, error); }
}

export async function pauseFailedModule(tx: Prisma.TransactionClient, ports: StewardPorts, execution: ModuleExecution, runId: string) {
  const { moduleId, workspaceId } = execution;
  const recent = await tx.moduleRun.findMany({ where: { moduleId, hash: execution.hash, id: { not: runId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
  if (recent.length !== 2 || recent.some(run => !run.error)) return;
  const paused = await tx.module.updateMany({ where: { id: moduleId, status: "active", activeHash: execution.hash }, data: { status: "paused" } });
  if (!paused.count) return;
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active" }, data: { status: "paused" } });
  const module = await tx.module.findUnique({ where: { id: moduleId } });
  await notifyUser(tx, ports, workspaceId, { module: moduleId, ...(module ? { app: module.name } : {}), level: "now", title: "模块连续失败，已暂停", body: `应用 ${module?.name ?? moduleId} 连续三次失败，已停止自动恢复。请在应用页查看故障详情，或运行 chrona admin diagnostics ${module?.name ?? moduleId}。修复后再启用；此前失败调用不会自动重放。`, key: `module:${moduleId}:paused:${execution.firedAt.toISOString()}` });
}
