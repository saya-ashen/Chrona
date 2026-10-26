import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { grantedUses, type ModuleManifest } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
/** `chain`/`path`: the routed call path of the event being handled (see module-calls). */
export type CallScope = { workspaceId: string; moduleId: string; hash: string; manifest: ModuleManifest; moduleRunId?: string; eventKey?: string; chain?: string[]; path?: string[] };
import { moduleModelSettings, notificationSettings } from "./settings";
import { audit } from "./audit";
import { CallError } from "./module-calls";

type ModelParams = { system?: string; prompt: string; maxOutputTokens: number };
type ModelError = "undeclared" | "unconfigured" | "budget_exceeded" | "provider_error" | "timeout";
/** The call error for a refused or failed completion: its message starts with the reason (the SDK's ModelError code). */
const refused = (code: ModelError) => new CallError(code === "undeclared" ? "forbidden" : code === "unconfigured" ? "unavailable" : "failed", `${code}: module model call`);
async function completionBudgetError({ tx, ports, scope, params, workspace, settings, now }: { tx: Prisma.TransactionClient; ports: StewardPorts; scope: CallScope; params: ModelParams; workspace: { settings: unknown }; settings: ReturnType<typeof moduleModelSettings>; now: Date }): Promise<ModelError | null> {
  if (!grantedUses(scope.manifest).includes("provider.complete") || !scope.manifest.model) return "undeclared";
  if (!settings || !Object.hasOwn(settings.models, scope.manifest.model.tier) || !ports.provider?.complete) return "unconfigured";
  const eventCalls = scope.moduleRunId ? await tx.moduleCall.count({ where: { moduleRunId: scope.moduleRunId, method: "model" } }) : Infinity;
  const timezone = notificationSettings(workspace.settings).timezone, day = localDayKey(now, timezone);
  const recent = await tx.moduleCall.findMany({ where: { module: { workspaceId: scope.workspaceId }, method: "model", createdAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } }, select: { createdAt: true } });
  const daily = recent.filter(row => localDayKey(row.createdAt, timezone) === day).length;
  return eventCalls >= Math.min(scope.manifest.model.maxCalls, settings.maxCallsPerEvent) || daily >= settings.dailyCalls || params.maxOutputTokens > Math.min(scope.manifest.model.maxOutputTokens, settings.maxOutputTokens) ? "budget_exceeded" : null;
}
async function reserveCompletion(ports: StewardPorts, scope: CallScope, params: ModelParams, now: Date) {
  return ports.db.$transaction(async tx => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId } });
    const settings = moduleModelSettings(workspace.settings);
    const error = await completionBudgetError({ tx, ports, scope, params, workspace, settings, now });
    const model = settings && scope.manifest.model ? settings.models[scope.manifest.model.tier] ?? null : null;
    const record = await tx.moduleCall.create({ data: { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "model", key: randomUUID(), status: error ? "rejected" : "pending", error, createdAt: now } });
    if (error) await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: record.id, model, inputTokens: null, outputTokens: null, error } });
    return { id: record.id, settings, model, error };
  });
}
/**
 * `provider.complete` (v2-11): one completion for a module, within its manifest's tier and limits and the owner's moduleModel.
 * Reserve in SQLite before leaving the transaction: concurrent modules share the daily budget.
 */
async function requestCompletion(ports: StewardPorts, params: ModelParams, model: string, timeoutMs: number) {
  try {
    const result = await ports.provider!.complete!({ ...params, model, timeoutMs });
    // shortcut: approximate the output token cap with four characters per token.
    return { result: { ...result, text: result.text.slice(0, params.maxOutputTokens * 4) }, error: null as ModelError | null };
  } catch (cause) {
    return { result: undefined, error: cause && typeof cause === "object" && "code" in cause && cause.code === "timeout" ? "timeout" as const : "provider_error" as const };
  }
}
export async function completeForModule(ports: StewardPorts, scope: CallScope, params: ModelParams) {
  const reservation = await reserveCompletion(ports, scope, params, ports.now());
  if (reservation.error) throw refused(reservation.error);
  const settings = reservation.settings!, model = reservation.model!;
  const { result, error } = await requestCompletion(ports, params, model, settings.timeoutMs);
  await ports.db.$transaction(async tx => {
    await tx.moduleCall.update({ where: { id: reservation.id }, data: { status: error ? "failed" : "executed", error } });
    await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: reservation.id, model, inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null, error } });
  });
  if (error) throw refused(error);
  return result!;
}
