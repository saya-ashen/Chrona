import { sessionSchema, type Health, type TodayView } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { StewardPorts } from "./ports";
import { notificationSettings } from "./settings";
import { toApproval, toNotification } from "./store";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
export type HealthPorts = { provider(): Promise<Health["provider"]>; moduleSandbox(): boolean };
export function createToday({ db, workspaceId, now }: RecordContext, ports: HealthPorts, apps: () => Promise<TodayView["apps"]> = async () => []) {
  async function health(): Promise<Health> {
    const at = now(), settings = notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
    const [provider, runs, dueSchedules, failingConnectors, queuedNotifications, failedNotifications, state] = await Promise.all([
      ports.provider(), db.run.findMany({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { createdAt: { gte: new Date(at.getTime() - 48 * 3600000) } }] } }),
      db.schedule.count({ where: { workspaceId, status: "active", nextAt: { lte: at } } }),
      db.connector.count({ where: { workspaceId, status: { in: ["failing", "needs_authorization"] } } }),
      db.notification.count({ where: { workspaceId, status: "queued" } }), db.notification.count({ where: { workspaceId, status: { in: ["failed", "uncertain"] } } }),
      db.stewardState.findUnique({ where: { workspaceId } }),
    ]);
    const day = localDayKey(at, settings.timezone);
    return { provider, moduleSandbox: ports.moduleSandbox(), queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
      failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, settings.timezone) === day).length,
      dueSchedules, failingConnectors, queuedNotifications, failedNotifications, lastTickAt: state?.lastTickAt?.toISOString() ?? null };
  }
  async function get(): Promise<TodayView> {
    const at = now(), week = 7 * 86400000;
    const [approvals, schedules, notifications, sessions, applications, status] = await Promise.all([
      db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" } }),
      db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { gte: at, lte: new Date(at.getTime() + week) } }, orderBy: { nextAt: "asc" }, take: 50 }),
      db.notification.findMany({ where: { workspaceId, status: { not: "suppressed" } }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.session.findMany({ where: { workspaceId, source: { in: ["web", "qq", "mcp"] } }, include: { runs: { where: { status: "running" }, select: { id: true }, take: 1 } }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }], take: 20 }),
      apps(), health(),
    ]);
    return { generatedAt: at.toISOString(), approvals: approvals.map(toApproval), updates: notifications.map(toNotification), apps: applications,
      sessions: sessions.map(row => sessionSchema.parse({ id: row.id, key: row.key, source: row.source, title: row.title, status: row.status, moduleId: row.moduleId, originSessionId: row.originSessionId, focus: row.focus, running: row.runs.length > 0, lastActivityAt: row.lastActivityAt.toISOString(), createdAt: row.createdAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null })),
      upcoming: schedules.filter(s => !s.until || s.nextAt! <= s.until).map(s => ({ scheduleId: s.id, mode: s.mode as TodayView["upcoming"][number]["mode"], label: s.label ?? (s.mode === "remind" ? s.text.slice(0, 300) : null), at: s.nextAt!.toISOString() })), health: status };
  }
  return { get, health };
}
