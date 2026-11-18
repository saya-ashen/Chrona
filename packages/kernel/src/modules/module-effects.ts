import { rollbackFailedStart } from "./module-generation";
import { currentCallerManifest } from "./module-owner";
import { publicCallError, publicCallReason } from "./module-call-error";
import type { Prisma } from "@chrona/db";
import { type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { registerModuleEffects, type CallScope } from "./module-supervisor";
import { CallError, callStatus, callSync, drainCalls, enqueueCall, type CallOrigin } from "./module-calls";
import { notifyLifecycle } from "../notify-user";
import { moduleContext } from "./module-context";
import { moduleIncidents } from "./module-diagnostics";
import { pauseIn } from "./module-status";
import { moduleFailurePolicy } from "./module-failure-policy";
import { fenceAgentModuleIn, abortDrainedAgentRuns } from "../agent/module-drain";
export type { CallScope } from "./module-supervisor";

type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; activationId: string | null; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

function originOf(scope: CallScope): CallOrigin {
  return { workspaceId: scope.workspaceId, caller: { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash }, chain: scope.chain ?? [], path: scope.path ?? [],
    run: { ...(scope.moduleRunId ? { moduleRunId: scope.moduleRunId } : {}), ...(scope.eventKey ? { eventKey: scope.eventKey } : {}) } };
}
const failed = (id: string, error: unknown): Reply => error instanceof CallError
  ? { id, error: { code: publicCallError(error.code), reason: error.reason ?? publicCallReason(error.code), message: error.message.slice(0, 500) } }
  : { id, error: { code: "failed", message: "Module call failed" } };

/** Rejected-call diagnostics must never replace the original routing error. */
async function recordRejectedCall(ports: StewardPorts, data: Prisma.ModuleCallUncheckedCreateInput) {
  try { await ports.db.moduleCall.create({ data }); }
  catch {
    // Database errors can include arguments, outputs and SQL. Emit only kernel-bound identity.
    console.error(JSON.stringify({ component: "module-effects", event: "module_call.persist_failed", moduleId: data.moduleId, moduleRunId: data.moduleRunId, method: data.method, status: data.status }));
  }
}

/** Routed calls: the router checks visibility, records the real caller and refuses waits on itself. */
async function routedCall(ports: StewardPorts, scope: CallScope, call: Extract<ModuleCall, { method: "call" }>): Promise<Reply> {
  const { args, mode, key, reply, timeoutMs, expectedTarget } = call.params, target = call.params.target;
  try {
    if (mode === "sync") {
      const result = await callSync(ports, originOf(scope), target, args, { timeoutMs, expectedTarget, key });
      return { id: call.id, result: { output: result.output } };
    }
    // The caller owns its keys (derive them from what is being done): a repeat after a crash returns the same call.
    const queued = await enqueueCall({ tx: ports.db, ports, origin: originOf(scope), target, raw: args }, { key: key!, reply, expectedTarget });
    if (!queued.duplicate) void drainCalls(ports, scope.workspaceId).catch(error => console.error(JSON.stringify({ component: "module-effects", event: "drain_calls.failed", workspaceId: scope.workspaceId, error: String(error).slice(0, 2000) })));
    return { id: call.id, result: queued };
  } catch (error) {
    if (error instanceof CallError && error.code !== "unknown") await recordRejectedCall(ports, { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "call", createdAt: ports.now(), key: JSON.stringify(target), status: "rejected", error: error.code });
    return failed(call.id, error);
  }
}

/** The module channel carries only routed calls (v2-10). */
export async function handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<Reply> {
  if (!await currentCallerManifest(ports.db, scope.workspaceId, { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash })) return failed(call.id, new CallError("forbidden", "Application caller is no longer active and approved"));
  if (call.method === "call") return routedCall(ports, scope, call);
  try { return { id: call.id, result: await callStatus(ports, originOf(scope), call.params) as Extract<Reply, { result: unknown }>["result"] }; }
  catch (error) { return failed(call.id, error); }
}

/** Commit the exact activation's drain before the idle check can reject its pause. */
export async function pauseFailedModule(ports: StewardPorts, execution: ModuleExecution, runId: string) {
  const { moduleId, workspaceId, hash, activationId } = execution;
  const where = { workspaceId, id: moduleId, status: "active", activeHash: hash };
  const fenced = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const module = await tx.module.findFirst({ where });
    if (!module || !activationId || !(await moduleFailurePolicy(tx, execution))?.shouldPause) return null;
    const drain = await fenceAgentModuleIn(ports, tx, workspaceId, moduleId);
    return { ...drain, receiverActivationId: module.activationId };
  });
  if (!fenced) return;
  await abortDrainedAgentRuns(ports, workspaceId, fenced.runIds);
  await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const module = await tx.module.findFirst({ where: { ...where, activationId: fenced.receiverActivationId } });
    if (!module || !(await moduleFailurePolicy(tx, execution))?.shouldPause) return;
    const incident = (await moduleIncidents(tx, workspaceId, moduleId)).find(item => item.activationId === activationId && item.evidence.runId === runId);
    await pauseIn(moduleContext(ports, workspaceId), tx, moduleId, { source: "automatic", reason: "连续三次失败", incidentId: incident?.id });
    await notifyLifecycle(tx, ports, workspaceId, `module:${moduleId}:paused:${execution.firedAt.toISOString()}`, { kind: "module-paused", app: module.name, module: moduleId });
  });
}

registerModuleEffects({ handleModuleCall, pauseFailedModule, rollbackFailedStart });
