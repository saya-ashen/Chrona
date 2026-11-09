import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
import type { CallScope } from "./module-supervisor";
import { moduleModelSettings, budgetTimezone } from "./settings";
import { audit } from "./audit";
import { CallError } from "./module-call-error";

type ModelParams = { system?: string; prompt: string; maxOutputTokens: number };
export type ModelError = "undeclared" | "unconfigured" | "budget_exceeded" | "provider_error" | "timeout";
export type EffectiveHardLimits = { maxCallsPerEvent: number; maxOutputTokens: number; eventTimeoutMs: number };
export type CompletionReservation = { id: string; declaredTier: string | null; effectiveHardLimits: EffectiveHardLimits | null; error: ModelError | null };
export type CompletionOwner = { moduleId: string; hash: string };
/** The call error for a refused or failed completion: its message starts with the SDK's ModelError code. */
export const refused = (code: ModelError) => new CallError(code === "undeclared" ? "forbidden" : code === "unconfigured" ? "unavailable" : "failed", `${code}: module model call`);

async function completionBudgetError({ tx, scope, params, workspace, settings, limits, now }: { tx: Prisma.TransactionClient; scope: CallScope; params: ModelParams; workspace: { settings: unknown }; settings: ReturnType<typeof moduleModelSettings>; limits: EffectiveHardLimits | null; now: Date }): Promise<ModelError | null> {
  if (!scope.manifest.model) return "undeclared";
  if (!settings || !limits) return "unconfigured";
  const eventCalls = scope.moduleRunId ? await tx.moduleCall.count({ where: { moduleRunId: scope.moduleRunId, method: "model", status: { not: "rejected" } } }) : Infinity;
  const timezone = budgetTimezone(workspace.settings), day = localDayKey(now, timezone);
  const recent = await tx.moduleCall.findMany({ where: { module: { workspaceId: scope.workspaceId }, method: "model", status: { not: "rejected" }, createdAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } }, select: { createdAt: true, moduleId: true } });
  const todays = recent.filter(row => localDayKey(row.createdAt, timezone) === day);
  const own = settings.moduleDailyCalls?.[scope.manifest.name];
  return eventCalls >= limits.maxCallsPerEvent || todays.length >= settings.dailyCalls
    || (own !== undefined && todays.filter(row => row.moduleId === scope.moduleId).length >= own)
    || params.maxOutputTokens > limits.maxOutputTokens ? "budget_exceeded" : null;
}
/** Count and reserve together in SQLite before execution leaves the kernel. */
export async function reserveCompletion(ports: StewardPorts, scope: CallScope, params: ModelParams, now: Date): Promise<CompletionReservation> {
  return ports.db.$transaction(async tx => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId } });
    const module = await tx.module.findFirst({ where: { id: scope.moduleId, workspaceId: scope.workspaceId } });
    if (!module) throw new CallError("not_found", "Model reservation module not found");
    if (scope.moduleRunId && !await tx.moduleRun.findFirst({ where: { id: scope.moduleRunId, moduleId: scope.moduleId, hash: scope.hash } })) throw new CallError("not_found", "Model reservation event not found");
    const settings = moduleModelSettings(workspace.settings), declaration = scope.manifest.model;
    const effectiveHardLimits = settings && declaration ? {
      maxCallsPerEvent: Math.min(declaration.maxCalls, settings.maxCallsPerEvent),
      maxOutputTokens: Math.min(declaration.maxOutputTokens, settings.maxOutputTokens),
      eventTimeoutMs: settings.eventTimeoutMs,
    } : null;
    const error = await completionBudgetError({ tx, scope, params, workspace, settings, limits: effectiveHardLimits, now });
    const record = await tx.moduleCall.create({ data: { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "model", key: randomUUID(), status: error ? "rejected" : "pending", error, createdAt: now } });
    if (error) await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: record.id, inputTokens: null, outputTokens: null, error } });
    return { id: record.id, declaredTier: declaration?.tier ?? null, effectiveHardLimits, error };
  });
}
/** Only the first pending settlement can mutate the reservation or emit its audit. */
export async function finishCompletion(ports: StewardPorts, workspaceId: string, completion: { id: string; result?: { inputTokens: number | null; outputTokens: number | null }; error: ModelError | null; model?: string }, expectedOwner?: CompletionOwner) {
  const { id, result, error, model } = completion;
  await ports.db.$transaction(async tx => {
    const where = { id, method: "model", module: { workspaceId }, ...expectedOwner };
    const row = await tx.moduleCall.findFirst({ where });
    if (!row) throw new CallError("not_found", "Model reservation not found");
    const settled = await tx.moduleCall.updateMany({ where: { ...where, status: "pending" }, data: { status: error ? "failed" : "executed", error } });
    if (settled.count !== 1) return;
    await audit(tx, { workspaceId, kind: "module_model_call", actor: "module", subjectId: row.moduleId, details: { callId: id, ...(model ? { model } : {}), inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null, error } });
  });
}
