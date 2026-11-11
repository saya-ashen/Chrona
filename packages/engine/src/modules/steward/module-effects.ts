import { currentCallerManifest } from "./module-owner";
import { publicCallError, publicCallReason } from "./module-call-error";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { registerModuleEffects, type CallScope } from "./module-supervisor";
import { CallError, callStatus, callSync, drainCalls, enqueueCall, type CallOrigin } from "./module-calls";
import { notifyLifecycle } from "./notify-user";
import { moduleContext } from "./module-context";
import { moduleIncidents } from "./module-diagnostics";
import { pauseIn } from "./module-status";
import { moduleFailurePolicy } from "./module-failure-policy";
import { fenceExecutionModuleIn } from "./execution-delivery-controls";
import { liveRuns } from "./run-live";
import { EXECUTION_DELIVERY_CARRIER, callExecutionDeliveryCarrier } from "./execution-delivery-carrier";
export type { CallScope } from "./module-supervisor";

export type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; activationId: string | null; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

function originOf(scope: CallScope): CallOrigin {
  return { workspaceId: scope.workspaceId, caller: { kind: "module", module: scope.manifest.name, moduleId: scope.moduleId, hash: scope.hash }, chain: scope.chain ?? [], path: scope.path ?? [],
    run: { ...(scope.moduleRunId ? { moduleRunId: scope.moduleRunId } : {}), ...(scope.eventKey ? { eventKey: scope.eventKey } : {}) } };
}
const failed = (id: string, error: unknown): Reply => error instanceof CallError
  ? { id, error: { code: publicCallError(error.code), reason: error.reason ?? publicCallReason(error.code), message: error.message.slice(0, 500) } }
  : { id, error: { code: "failed", message: "Module call failed" } };

/** Auxiliary diagnostics must never change a committed route result or prevent async delivery. */
async function recordRoutedCall(ports: StewardPorts, data: Prisma.ModuleCallUncheckedCreateInput) {
  try { await ports.db.moduleCall.create({ data }); }
  catch {
    // Database errors can include arguments, outputs and SQL. Emit only kernel-bound identity.
    console.error(JSON.stringify({ component: "module-effects", event: "module_call.persist_failed", moduleId: data.moduleId, moduleRunId: data.moduleRunId, method: data.method, status: data.status }));
  }
}

/** Routed calls: the router checks visibility, records the real caller and refuses waits on itself. */
async function routedCall(ports: StewardPorts, scope: CallScope, call: Extract<ModuleCall, { method: "call" }>): Promise<Reply> {
  const { args, mode, key, reply, timeoutMs, expectedTarget } = call.params, target = call.params.target, now = ports.now();
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "call", createdAt: now };
  try {
    if (target === EXECUTION_DELIVERY_CARRIER) {
      if (mode !== "sync") throw new CallError("invalid", "Execution delivery carrier requires a synchronous call");
      const output = z.json().parse(await callExecutionDeliveryCarrier(ports, scope, args));
      await recordRoutedCall(ports, { ...record, key: JSON.stringify(target), status: "executed" });
      return { id: call.id, result: { output } };
    }
    if (mode === "sync") {
      const result = await callSync(ports, originOf(scope), target, args, { timeoutMs, expectedTarget, key });
      await recordRoutedCall(ports, { ...record, key: result.callId, status: "executed" });
      return { id: call.id, result: { output: result.output } };
    }
    // The caller owns its keys (derive them from what is being done): a repeat after a crash returns the same call.
    const queued = await enqueueCall({ tx: ports.db, ports, origin: originOf(scope), target, raw: args }, { key: key!, reply, expectedTarget });
    await recordRoutedCall(ports, { ...record, key: queued.callId, status: queued.duplicate ? "duplicate" : "executed" });
    if (!queued.duplicate) void drainCalls(ports, scope.workspaceId).catch(() => {});
    return { id: call.id, result: queued };
  } catch (error) {
    await recordRoutedCall(ports, { ...record, key: JSON.stringify(target), status: error instanceof CallError && error.code !== "unknown" ? "rejected" : "failed", error: error instanceof CallError ? error.code : "internal" });
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
    const drain = await fenceExecutionModuleIn(ports, tx, workspaceId, moduleId);
    return { ...drain, receiverActivationId: module.activationId };
  });
  if (!fenced) return;
  for (const id of fenced.localRunIds) await liveRuns.get(id)?.abort().catch(() => {});
  await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const module = await tx.module.findFirst({ where: { ...where, activationId: fenced.receiverActivationId } });
    if (!module || !(await moduleFailurePolicy(tx, execution))?.shouldPause) return;
    const incident = (await moduleIncidents(tx, workspaceId, moduleId)).find(item => item.activationId === activationId && item.evidence.runId === runId);
    await pauseIn(moduleContext(ports, workspaceId), tx, moduleId, { source: "automatic", reason: "连续三次失败", incidentId: incident?.id });
    await notifyLifecycle(tx, ports, workspaceId, `module:${moduleId}:paused:${execution.firedAt.toISOString()}`, { kind: "module-paused", app: module.name, module: moduleId });
  });
}

registerModuleEffects({ handleModuleCall, pauseFailedModule });
