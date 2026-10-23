import { DEFAULT_NOTIFICATION_SETTINGS, moduleModelSettingsSchema, notificationSettingsSchema, updateSettingsSchema, type NotificationSettings } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { RESPONSE_KEY_PREFIX } from "@chrona/domain/steward/notify-budget";
import { parseInput, StewardError } from "./errors";
export function notificationSettings(settings: unknown): NotificationSettings {
  const value = settings as { notifications?: unknown } | null;
  return notificationSettingsSchema.parse(value?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS);
}
export function moduleModelSettings(settings: unknown) {
  const value = settings as { moduleModel?: unknown } | null;
  return moduleModelSettingsSchema.nullable().parse(value?.moduleModel ?? null);
}
export function createSettings({ db, workspaceId, now }: RecordContext, chat: { channel: "chrona_qqbot"; bound(): Promise<boolean> } | null) {
  async function get() {
    const row = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!row) throw new StewardError("not_found", "Workspace not found");
    const notifications = notificationSettings(row.settings), day = localDayKey(now(), notifications.timezone);
    const sent = await db.notification.findMany({ where: { workspaceId, channel: "chrona_qqbot", NOT: { idempotencyKey: { startsWith: RESPONSE_KEY_PREFIX } }, sentAt: { not: null, gte: new Date(now().getTime() - 48 * 3600000) } }, select: { sentAt: true } });
    return { notifications, moduleModel: moduleModelSettings(row.settings), chat: { channel: chat?.channel ?? "in_app" as const, bound: chat ? await chat.bound() : false, sentToday: sent.filter(r => r.sentAt && localDayKey(r.sentAt, notifications.timezone) === day).length } };
  }
  return { get, update: async (raw: unknown) => {
    const input = parseInput(updateSettingsSchema, raw);
    await db.$transaction(async tx => {
      const row = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!row) throw new StewardError("not_found", "Workspace not found");
      const notifications = notificationSettingsSchema.parse({ ...notificationSettings(row.settings), ...input.notifications });
      try { new Intl.DateTimeFormat("en", { timeZone: notifications.timezone }).format(now()); } catch { throw new StewardError("invalid", "Invalid timezone"); }
      for (const time of [notifications.digestAt, notifications.quietHours?.start, notifications.quietHours?.end]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new StewardError("invalid", "Invalid time");
      const previous = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...previous, notifications, moduleModel: input.moduleModel === undefined ? moduleModelSettings(row.settings) : input.moduleModel } } });
      await audit(tx, { workspaceId, kind: "settings_updated", actor: "user", subjectId: workspaceId, details: input });
    });
    return get();
  } };
}
