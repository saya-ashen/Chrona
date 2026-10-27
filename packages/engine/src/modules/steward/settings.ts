import { DEFAULT_NOTIFICATION_SETTINGS, RUN_LIMITS, buildSettingsSchema, moduleModelSettingsSchema, notificationSettingsSchema, reflectionSettingsSchema, updateSettingsSchema, type NotificationSettings } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { localDayKey } from "@chrona/domain/steward/local-day";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
export function notificationSettings(settings: unknown): NotificationSettings {
  const value = settings as { notifications?: unknown } | null;
  return notificationSettingsSchema.parse(value?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS);
}
export function moduleModelSettings(settings: unknown) {
  const value = settings as { moduleModel?: unknown } | null;
  return moduleModelSettingsSchema.nullable().parse(value?.moduleModel ?? null);
}
export function buildSettings(settings: unknown) {
  const value = settings as { builds?: unknown } | null;
  return buildSettingsSchema.parse(value?.builds ?? { dailyLimit: RUN_LIMITS.maxBuildRunsPerDay, timeoutMinutes: RUN_LIMITS.buildTimeoutMs / 60_000, maxSubmissions: RUN_LIMITS.maxBuildSubmissionsPerRun });
}
/** v2-19: on unless the owner turned it off. */
export function reflectionSettings(settings: unknown) {
  const value = settings as { reflection?: unknown } | null;
  return reflectionSettingsSchema.parse(value?.reflection ?? { enabled: true });
}
/** Same local-day count for both admission and the owner's settings page. */
export async function buildUsage(db: Pick<StewardPorts["db"], "session">, workspaceId: string, settings: unknown, at: Date) {
  const timezone = notificationSettings(settings).timezone, date = localDayKey(at, timezone);
  const recent = await db.session.findMany({ where: { workspaceId, source: "build", createdAt: { gte: new Date(at.getTime() - 48 * 3600000), lte: at } }, select: { createdAt: true } });
  const used = recent.filter(row => localDayKey(row.createdAt, timezone) === date).length;
  return { date, timezone, used, remaining: Math.max(0, buildSettings(settings).dailyLimit - used) };
}
function validateNotificationSettings(notifications: NotificationSettings, now: Date) {
  try { new Intl.DateTimeFormat("en", { timeZone: notifications.timezone }).format(now); } catch { throw new StewardError("invalid", "Invalid timezone"); }
  for (const time of [notifications.digestAt, notifications.quietHours?.start, notifications.quietHours?.end]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new StewardError("invalid", "Invalid time");
}
/** v2-17: today's module model calls and tokens (the owner's local day), from the call records and their audits. */
export async function modelUsage(db: StewardPorts["db"], workspaceId: string, settings: unknown, at: Date) {
  const timezone = notificationSettings(settings).timezone, day = localDayKey(at, timezone), since = new Date(at.getTime() - 48 * 3600_000);
  const today = (row: { createdAt: Date }) => localDayKey(row.createdAt, timezone) === day;
  const calls = (await db.moduleCall.findMany({ where: { module: { workspaceId }, method: "model", status: { not: "rejected" }, createdAt: { gte: since, lte: at } }, select: { id: true, createdAt: true, module: { select: { name: true } } } })).filter(today);
  const audits = await db.audit.findMany({ where: { workspaceId, kind: "module_model_call", createdAt: { gte: since } }, select: { details: true } });
  const tokens = new Map(audits.map(row => row.details as { callId?: string; inputTokens?: number | null; outputTokens?: number | null }).filter(details => details.callId).map(details => [details.callId!, details]));
  const usage = new Map<string, { module: string; calls: number; inputTokens: number; outputTokens: number }>();
  for (const call of calls) {
    const row = usage.get(call.module.name) ?? { module: call.module.name, calls: 0, inputTokens: 0, outputTokens: 0 }, spent = tokens.get(call.id);
    row.calls++; row.inputTokens += spent?.inputTokens ?? 0; row.outputTokens += spent?.outputTokens ?? 0;
    usage.set(call.module.name, row);
  }
  return [...usage.values()].sort((a, b) => a.module.localeCompare(b.module));
}
/** `notify` is the notification module: it reports chat readiness and receives the settings it applies. */
export function createSettings({ db, workspaceId, now }: RecordContext, notify: {
  status(): Promise<{ chat: { channel: "in_app" | "chrona_qqbot"; bound: boolean; sentToday: number } } | null>;
  forward(tx: Parameters<Parameters<RecordContext["db"]["$transaction"]>[0]>[0], settings: NotificationSettings, at: Date): Promise<unknown>;
}) {
  async function get() {
    const row = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!row) throw new StewardError("not_found", "Workspace not found");
    const status = await notify.status();
    return { notifications: notificationSettings(row.settings), reflection: reflectionSettings(row.settings), builds: buildSettings(row.settings), buildUsage: await buildUsage(db, workspaceId, row.settings, now()), modelUsage: await modelUsage(db, workspaceId, row.settings, now()), moduleModel: moduleModelSettings(row.settings), chat: status?.chat ?? { channel: "in_app" as const, bound: false, sentToday: 0 } };
  }
  return { get, update: async (raw: unknown) => {
    const input = parseInput(updateSettingsSchema, raw);
    await db.$transaction(async tx => {
      const row = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!row) throw new StewardError("not_found", "Workspace not found");
      const notifications = notificationSettingsSchema.parse({ ...notificationSettings(row.settings), ...input.notifications });
      validateNotificationSettings(notifications, now());
      const previous = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...previous, notifications, builds: buildSettingsSchema.parse({ ...buildSettings(row.settings), ...input.builds }), moduleModel: input.moduleModel === undefined ? moduleModelSettings(row.settings) : input.moduleModel, reflection: input.reflection ?? reflectionSettings(row.settings) } } });
      if (input.notifications) await notify.forward(tx, notifications, now());
      await audit(tx, { workspaceId, kind: "settings_updated", actor: "user", subjectId: workspaceId, details: input });
    });
    return get();
  } };
}
