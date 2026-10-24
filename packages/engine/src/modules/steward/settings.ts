import { DEFAULT_NOTIFICATION_SETTINGS, moduleModelSettingsSchema, notificationSettingsSchema, updateSettingsSchema, type NotificationSettings } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
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
/** `notify` is the notification module: it reports chat readiness and receives the settings it applies. */
export function createSettings({ db, workspaceId, now }: RecordContext, notify: {
  status(): Promise<{ chat: { channel: "in_app" | "chrona_qqbot"; bound: boolean; sentToday: number } } | null>;
  forward(tx: Parameters<Parameters<RecordContext["db"]["$transaction"]>[0]>[0], settings: NotificationSettings, at: Date): Promise<unknown>;
}) {
  async function get() {
    const row = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!row) throw new StewardError("not_found", "Workspace not found");
    const status = await notify.status();
    return { notifications: notificationSettings(row.settings), moduleModel: moduleModelSettings(row.settings), chat: status?.chat ?? { channel: "in_app" as const, bound: false, sentToday: 0 } };
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
      if (input.notifications) await notify.forward(tx, notifications, now());
      await audit(tx, { workspaceId, kind: "settings_updated", actor: "user", subjectId: workspaceId, details: input });
    });
    return get();
  } };
}
