import { RUN_LIMITS, buildSettingsSchema, settingsSchema, updateSettingsSchema, moduleModelSettingsSchema } from "@chrona/contracts/steward";

export const kernelModuleModelSettingsSchema = moduleModelSettingsSchema;
export const kernelSettingsSchema = settingsSchema;
export const kernelUpdateSettingsSchema = updateSettingsSchema;
import type { StewardPorts } from "./ports";
import { localDayKey } from "@chrona/domain/steward/local-day";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
export function moduleModelSettings(settings: unknown) {
  const value = settings as { moduleModel?: unknown } | null;
  return kernelModuleModelSettingsSchema.nullable().parse(value?.moduleModel ?? null);
}
export function runTimeoutMinutes(settings: unknown): number | null {
  const value = settings as { runTimeoutMinutes?: unknown } | null;
  return settingsSchema.shape.runTimeoutMinutes.parse(value?.runTimeoutMinutes);
}
export function buildSettings(settings: unknown) {
  const value = settings as { builds?: unknown } | null;
  return buildSettingsSchema.parse(value?.builds ?? { dailyLimit: RUN_LIMITS.maxBuildRunsPerDay, timeoutMinutes: RUN_LIMITS.buildTimeoutMs / 60_000, maxSubmissions: RUN_LIMITS.maxBuildSubmissionsPerRun });
}
/** Kernel-owned governance day boundary. */
export function budgetTimezone(settings: unknown): string {
  const value = settings as { timezone?: unknown } | null;
  return settingsSchema.shape.timezone.parse(value?.timezone ?? "Asia/Shanghai");
}
/** Same local-day count for both admission and the owner's settings page. */
export async function buildUsage(db: Pick<StewardPorts["db"], "session">, workspaceId: string, settings: unknown, at: Date) {
  const timezone = budgetTimezone(settings), date = localDayKey(at, timezone);
  const recent = await db.session.findMany({ where: { workspaceId, source: "build", createdAt: { gte: new Date(at.getTime() - 48 * 3600000), lte: at } }, select: { createdAt: true } });
  const used = recent.filter(row => localDayKey(row.createdAt, timezone) === date).length;
  return { date, timezone, used, remaining: Math.max(0, buildSettings(settings).dailyLimit - used) };
}
function validateTimezone(timezone: string, now: Date) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now); } catch { throw new StewardError("invalid", "Invalid timezone"); }
}
/** v2-17: today's module model calls and tokens (the owner's local day), from the call records and their audits. */
export async function modelUsage(db: StewardPorts["db"], workspaceId: string, settings: unknown, at: Date) {
  const timezone = budgetTimezone(settings), day = localDayKey(at, timezone), since = new Date(at.getTime() - 48 * 3600_000);
  const today = (row: { createdAt: Date }) => localDayKey(row.createdAt, timezone) === day;
  const calls = (await db.moduleCall.findMany({ where: { OR: [{ workspaceId }, { module: { workspaceId } }], method: "model", status: { not: "rejected" }, createdAt: { gte: since, lte: at } }, select: { id: true, createdAt: true, moduleName: true, module: { select: { name: true } } } })).filter(today);
  const audits = await db.audit.findMany({ where: { workspaceId, kind: "module_model_call", createdAt: { gte: since } }, select: { details: true } });
  const tokens = new Map(audits.map(row => row.details as { callId?: string; inputTokens?: number | null; outputTokens?: number | null }).filter(details => details.callId).map(details => [details.callId!, details]));
  const usage = new Map<string, { module: string; calls: number; inputTokens: number; outputTokens: number }>();
  for (const call of calls) {
    const moduleName = call.moduleName ?? call.module?.name ?? "removed";
    const row = usage.get(moduleName) ?? { module: moduleName, calls: 0, inputTokens: 0, outputTokens: 0 }, spent = tokens.get(call.id);
    row.calls++; row.inputTokens += spent?.inputTokens ?? 0; row.outputTokens += spent?.outputTokens ?? 0;
    usage.set(moduleName, row);
  }
  return [...usage.values()].sort((a, b) => a.module.localeCompare(b.module));
}
/** Kernel settings facts only; application readiness is composed by the entry application. */
export function createSettings({ db, workspaceId, now }: RecordContext) {
  async function get() {
    const row = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!row) throw new StewardError("not_found", "Workspace not found");
    return { timezone: budgetTimezone(row.settings), runTimeoutMinutes: runTimeoutMinutes(row.settings), modelUsage: await modelUsage(db, workspaceId, row.settings, now()), moduleModel: moduleModelSettings(row.settings) };
  }
  return { get, update: async (raw: unknown) => {
    const input = parseInput(kernelUpdateSettingsSchema, raw);
    await db.$transaction(async tx => {
      const row = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!row) throw new StewardError("not_found", "Workspace not found");
      const timezone = input.timezone ?? budgetTimezone(row.settings);
      validateTimezone(timezone, now());
      const previous = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...previous, timezone, runTimeoutMinutes: input.runTimeoutMinutes === undefined ? runTimeoutMinutes(row.settings) : input.runTimeoutMinutes, moduleModel: input.moduleModel === undefined ? moduleModelSettings(row.settings) : input.moduleModel } } });
      await audit(tx, { workspaceId, kind: "settings_updated", actor: "user", subjectId: workspaceId, details: input });
    });
    return get();
  } };
}
