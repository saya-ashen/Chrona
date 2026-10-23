import { randomUUID } from "node:crypto";
import type { ModuleCall, ModuleManifest } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./ports";
export type CallScope = { workspaceId: string; moduleId: string; hash: string; manifest: ModuleManifest; moduleRunId?: string; eventKey?: string };
import { moduleModelSettings, notificationSettings } from "./settings";
import { audit } from "./audit";

type ModelCall = Extract<ModuleCall, { method: "model" }>;
type ModelError = "undeclared" | "unconfigured" | "budget_exceeded" | "provider_error" | "timeout";
/** Reserve in SQLite before leaving the transaction: concurrent modules share the daily budget. */
export async function handleModuleModel(ports: StewardPorts, scope: CallScope, call: ModelCall) {
  const now = ports.now();
  const reservation = await ports.db.$transaction(async tx => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId } });
    const settings = moduleModelSettings(workspace.settings);
    let error: ModelError | null = null;
    if (!scope.manifest.effects.includes("model") || !scope.manifest.model) error = "undeclared";
    else if (!settings || !ports.modelGateway) error = "unconfigured";
    else {
      const eventCalls = scope.moduleRunId ? await tx.moduleCall.count({ where: { moduleRunId: scope.moduleRunId, method: "model" } }) : Infinity;
      const timezone = notificationSettings(workspace.settings).timezone, day = localDayKey(now, timezone);
      const recent = await tx.moduleCall.findMany({ where: { module: { workspaceId: scope.workspaceId }, method: "model", createdAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } }, select: { createdAt: true } });
      const daily = recent.filter(row => localDayKey(row.createdAt, timezone) === day).length;
      if (eventCalls >= Math.min(scope.manifest.model!.maxCalls, settings.maxCallsPerEvent) || daily >= settings.dailyCalls || call.params.maxOutputTokens > Math.min(scope.manifest.model!.maxOutputTokens, settings.maxOutputTokens)) error = "budget_exceeded";
    }
    const record = await tx.moduleCall.create({ data: { moduleId: scope.moduleId, hash: scope.hash, moduleRunId: scope.moduleRunId, eventKey: scope.eventKey, method: "model", key: randomUUID(), status: error ? "rejected" : "pending", error, createdAt: now } });
    if (error) await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: record.id, model: settings?.model ?? null, inputTokens: null, outputTokens: null, error } });
    return { id: record.id, settings, error };
  });
  if (reservation.error) return { id: call.id, error: { code: reservation.error, message: `Module model call: ${reservation.error}` } };
  const settings = reservation.settings!;
  let result: { text: string; inputTokens: number | null; outputTokens: number | null } | undefined, error: ModelError | null = null;
  try {
    result = await ports.modelGateway!.complete({ ...call.params, model: settings.model, timeoutMs: settings.timeoutMs });
    // shortcut: approximate the output token cap with four characters per token.
    result = { ...result, text: result.text.slice(0, call.params.maxOutputTokens * 4) };
  } catch (cause) {
    error = cause && typeof cause === "object" && "code" in cause && cause.code === "timeout" ? "timeout" : "provider_error";
  }
  await ports.db.$transaction(async tx => {
    await tx.moduleCall.update({ where: { id: reservation.id }, data: { status: error ? "failed" : "executed", error } });
    await audit(tx, { workspaceId: scope.workspaceId, kind: "module_model_call", actor: "module", subjectId: scope.moduleId, details: { callId: reservation.id, model: settings.model, inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null, error } });
  });
  return error ? { id: call.id, error: { code: error, message: `Module model call: ${error}` } } : { id: call.id, result: result! };
}
