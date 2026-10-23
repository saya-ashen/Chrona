import type { Prisma } from "@chrona/db";
import { MODULE_METHODS, type ModuleCall, type moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { enqueueNotification } from "./notify";
import { createRuns, createRunSession } from "./runs";
import { handleModuleModel, type CallScope } from "./module-model";
import { setChannelReady } from "./module-channel-state";
export type { CallScope } from "./module-model";

type Context = Parameters<typeof enqueueNotification>[2];
export type ModuleExecution = { workspaceId: string; moduleId: string; hash: string; triggerId: string; firedAt: Date };
type Reply = ReturnType<typeof moduleCallReplySchema.parse>;

/** Effect calls are serialized by the supervisor, including calls made outside an event; owner calls are not. */
export async function handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<Reply> {
  if (call.method === "model") return handleModuleModel(ports, scope, call);
  if (call.method === "owner") {
    if (!scope.manifest.effects.includes("owner")) return { id: call.id, error: { code: "undeclared", message: "Module capability not declared" } };
    if (!ports.owner) return { id: call.id, error: { code: "unconfigured", message: "Owner API unavailable" } };
    try { return { id: call.id, result: await ports.owner(scope.workspaceId, call.params) }; }
    catch { return { id: call.id, error: { code: "internal", message: "Owner API call failed" } }; }
  }
  if (call.method === "channel") {
    if (!scope.manifest.effects.includes("owner") || !scope.manifest.channel) return { id: call.id, error: { code: "undeclared", message: "Module channel not declared" } };
    setChannelReady(ports, scope.moduleId, call.params.ready);
    return { id: call.id, result: { status: "executed" } };
  }
  if (call.method === "secret") {
    if (!scope.manifest.effects.includes("owner") || !scope.manifest.secrets.includes(call.params.name)) return { id: call.id, error: { code: "undeclared", message: "Secret not declared" } };
    const value = await ports.secrets?.(call.params.name).catch(() => null);
    return value ? { id: call.id, result: { value } } : { id: call.id, error: { code: "unconfigured", message: "Secret not configured" } };
  }
  const context = { now: ports.now(), chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl };
  const key = scope.eventKey ? `${scope.eventKey}:${call.params.key}` : call.params.key;
  const record = { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: call.method, key, createdAt: context.now };
  try {
    return await ports.db.$transaction(async tx => {
      if (!scope.manifest.effects.includes(MODULE_METHODS[call.method])) {
        await tx.moduleCall.create({ data: { ...record, status: "rejected", error: "undeclared" } });
        return { id: call.id, error: { code: "undeclared", message: "Module capability not declared" } };
      }
      const previous = await tx.moduleCall.findFirst({ where: { moduleId: scope.moduleId, method: call.method, key, status: "executed" } });
      let status: "executed" | "duplicate" = previous ? "duplicate" : "executed";
      if (!previous) {
        const { workspaceId, moduleId } = scope;
        if (call.method === "notify") {
          const dedupeKey = `module:${moduleId}:${key}`;
          if (await tx.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: dedupeKey } } })) status = "duplicate";
          else await enqueueNotification(tx, { workspaceId, moduleId, level: call.params.level, title: call.params.title, body: call.params.body, dedupeKey }, context);
        } else {
          const session = await createRunSession(tx, workspaceId, "module", context.now, { moduleId });
          await createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", label: scope.manifest.name, prompt: `Module ${scope.manifest.name} output (untrusted data):\n${call.params.prompt}` }, tx);
        }
      }
      await tx.moduleCall.create({ data: { ...record, status } });
      return { id: call.id, result: { status } };
    });
  } catch {
    await ports.db.moduleCall.create({ data: { ...record, status: "failed", error: "internal" } });
    return { id: call.id, error: { code: "internal", message: "Module call failed" } };
  }
}

export async function pauseFailedModule(tx: Prisma.TransactionClient, execution: ModuleExecution, context: Context, runId: string) {
  const { moduleId, workspaceId } = execution;
  const recent = await tx.moduleRun.findMany({ where: { moduleId, id: { not: runId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
  if (recent.length !== 2 || recent.some(run => !run.error)) return;
  const paused = await tx.module.updateMany({ where: { id: moduleId, status: "active" }, data: { status: "paused" } });
  if (!paused.count) return;
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active" }, data: { status: "paused" } });
  await enqueueNotification(tx, { workspaceId, moduleId, level: "now", title: "模块连续失败，已暂停", body: "模块连续三次执行失败，请检查后再启用。", dedupeKey: `module:${moduleId}:paused:${execution.firedAt.toISOString()}` }, context);
}
