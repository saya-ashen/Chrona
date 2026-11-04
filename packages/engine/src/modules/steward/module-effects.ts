import type { Prisma } from "@chrona/db";
import { NOTIFY_INTERFACE, type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { registerModuleEffects, type CallScope } from "./module-supervisor";
import { CallError, callStatus, callSync, drainCalls, enqueueCall, type CallOrigin } from "./module-calls";
import { notifyUser } from "./notify-user";
import { moduleContext } from "./module-context";
import { moduleIncidents } from "./module-diagnostics";
import { pauseIn } from "./module-status";
import { moduleFailurePolicy } from "./module-failure-policy";
export type { CallScope } from "./module-supervisor";

export type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; activationId: string | null; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

function originOf(scope: CallScope): CallOrigin {
  return { workspaceId: scope.workspaceId, caller: { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash }, chain: scope.chain ?? [], path: scope.path ?? [],
    run: { ...(scope.moduleRunId ? { moduleRunId: scope.moduleRunId } : {}), ...(scope.eventKey ? { eventKey: scope.eventKey } : {}) } };
}
const failed = (id: string, error: unknown): Reply => error instanceof CallError
  ? { id, error: { code: error.code, message: error.message.slice(0, 500) } }
  : { id, error: { code: "internal", message: "Module call failed" } };

/** Routed calls: the router checks visibility, records the real caller and refuses waits on itself. */
async function routedCall(ports: StewardPorts, scope: CallScope, call: Extract<ModuleCall, { method: "call" }>): Promise<Reply> {
  const { args, mode, key, reply, timeoutMs } = call.params, target = call.params.target, now = ports.now();
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "call", createdAt: now };
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

/** The module channel carries only routed calls (v2-10). */
export async function handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<Reply> {
  if (call.method === "call") return routedCall(ports, scope, call);
  try { return { id: call.id, result: await callStatus(ports, originOf(scope), call.params.callId) as Extract<Reply, { result: unknown }>["result"] }; }
  catch (error) { return failed(call.id, error); }
}

export async function pauseFailedModule(tx: Prisma.TransactionClient, ports: StewardPorts, execution: ModuleExecution, runId: string) {
  const { moduleId, workspaceId } = execution;
  if (!(await moduleFailurePolicy(tx, execution))?.shouldPause) return;
  const module = await tx.module.findFirst({ where: { workspaceId, id: moduleId, status: "active", activeHash: execution.hash } });
  if (!module) return;
  const incident = (await moduleIncidents(tx, workspaceId, moduleId)).find(item => item.activationId === execution.activationId && item.evidence.runId === runId);
  await pauseIn(moduleContext(ports, workspaceId), tx, moduleId, { source: "automatic", reason: "连续三次失败", incidentId: incident?.id });
  await notifyUser(tx, ports, workspaceId, { module: moduleId, app: module.name, level: "now", title: "模块连续失败，已暂停", body: `应用 ${module.name} 连续三次失败，已停止自动恢复。请在应用页查看故障详情，或运行 chrona admin diagnostics ${module.name}。修复后再启用；此前失败调用不会自动重放。`, key: `module:${moduleId}:paused:${execution.firedAt.toISOString()}` });
}

registerModuleEffects({ handleModuleCall, pauseFailedModule });
