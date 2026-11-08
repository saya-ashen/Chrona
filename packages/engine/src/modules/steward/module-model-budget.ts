import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { tierTarget } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
import type { CallScope } from "./module-supervisor";
import { moduleModelSettings, budgetTimezone } from "./settings";
import { audit } from "./audit";
import { CallError } from "./module-call-error";

type ModelParams = { system?: string; prompt: string; maxOutputTokens: number };
export type ModelError = "undeclared" | "unconfigured" | "budget_exceeded" | "provider_error" | "timeout";
/** The call error for a refused or failed completion: its message starts with the reason (the SDK's ModelError code). */
export const refused = (code: ModelError) => new CallError(code === "undeclared" ? "forbidden" : code === "unconfigured" ? "unavailable" : "failed", `${code}: module model call`);
/** v2-17: a module's own daily cap stops only that module; the global cap stops all. */
function overDaily(settings: NonNullable<ReturnType<typeof moduleModelSettings>>, scope: CallScope, todays: { moduleId: string }[]) {
  const own = settings.moduleDailyCalls?.[scope.manifest.name];
  return todays.length >= settings.dailyCalls || (own !== undefined && todays.filter(row => row.moduleId === scope.moduleId).length >= own);
}
async function completionBudgetError({ tx, ports, scope, params, workspace, settings, now }: { tx: Prisma.TransactionClient; ports: StewardPorts; scope: CallScope; params: ModelParams; workspace: { settings: unknown }; settings: ReturnType<typeof moduleModelSettings>; now: Date }): Promise<ModelError | null> {
  if (!scope.manifest.model) return "undeclared";
  if (!settings || !Object.hasOwn(settings.models, scope.manifest.model.tier) || !ports.provider?.complete) return "unconfigured";
  const eventCalls = scope.moduleRunId ? await tx.moduleCall.count({ where: { moduleRunId: scope.moduleRunId, method: "model" } }) : Infinity;
  const timezone = budgetTimezone(workspace.settings), day = localDayKey(now, timezone);
  const recent = await tx.moduleCall.findMany({ where: { module: { workspaceId: scope.workspaceId }, method: "model", createdAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } }, select: { createdAt: true, moduleId: true } });
  const todays = recent.filter(row => localDayKey(row.createdAt, timezone) === day);
  return eventCalls >= Math.min(scope.manifest.model.maxCalls, settings.maxCallsPerEvent) || overDaily(settings, scope, todays)
    || params.maxOutputTokens > Math.min(scope.manifest.model.maxOutputTokens, settings.maxOutputTokens) ? "budget_exceeded" : null;
}
export async function reserveCompletion(ports: StewardPorts, scope: CallScope, params: ModelParams, now: Date) {
  return ports.db.$transaction(async tx => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId } });
    const settings = moduleModelSettings(workspace.settings);
    const error = await completionBudgetError({ tx, ports, scope, params, workspace, settings, now });
    const tier = settings && scope.manifest.model ? settings.models[scope.manifest.model.tier] : undefined, target = tier === undefined ? null : tierTarget(tier);
    const model = target?.model ?? null;
    const record = await tx.moduleCall.create({ data: { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "model", key: randomUUID(), status: error ? "rejected" : "pending", error, createdAt: now } });
    if (error) await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: record.id, model, inputTokens: null, outputTokens: null, error } });
    return { id: record.id, settings, model, thinking: target?.thinking, error };
  });
}
export async function finishCompletion(ports: StewardPorts, workspaceId: string, completion: { id: string; result?: { inputTokens: number | null; outputTokens: number | null }; error: ModelError | null; model?: string }) {
  const { id, result, error, model } = completion;
  await ports.db.$transaction(async tx => {
    const row = await tx.moduleCall.findFirst({ where: { id, method: "model", module: { workspaceId } } });
    if (!row) throw new CallError("not_found", "Model reservation not found");
    if (row.status !== "pending") return;
    await tx.moduleCall.update({ where: { id }, data: { status: error ? "failed" : "executed", error } });
    await audit(tx, { workspaceId, kind: "module_model_call", actor: "module", subjectId: row.moduleId, details: { callId: id, ...(model ? { model } : {}), inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null, error } });
  });
}
