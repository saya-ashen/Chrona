import { type Health, type TodayView } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { notificationSettings } from "./settings";
import { toApproval, toSession } from "./store";
import { createApps } from "./apps";
import { createNotificationsView } from "./notify-user";
import { entryConversations } from "./memory";
import { moduleHealthSummary } from "./modules";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
/** `notifications` is answered by the notify module; when it cannot answer the view shows none. */
export type HealthPorts = { provider(): Promise<Health["provider"]>; moduleSandbox(): boolean;
  notifications: { list(limit: number): Promise<TodayView["updates"]>; status(): Promise<{ queued: number; failed: number } | null> } };
export function createToday({ db, workspaceId, now }: RecordContext, ports: HealthPorts, apps: () => Promise<TodayView["apps"]> = async () => [], problems: () => Promise<TodayView["problems"]> = async () => []) {
  async function health(): Promise<Health> {
    const at = now(), settings = notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
    const [provider, runs, dueSchedules, notifications, state] = await Promise.all([
      ports.provider(), db.run.findMany({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { createdAt: { gte: new Date(at.getTime() - 48 * 3600000) } }] } }),
      db.schedule.count({ where: { workspaceId, status: "active", nextAt: { lte: at } } }),
      ports.notifications.status(),
      db.stewardState.findUnique({ where: { workspaceId } }),
    ]);
    const day = localDayKey(at, settings.timezone);
    return { provider, moduleSandbox: ports.moduleSandbox(), queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
      failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, settings.timezone) === day).length,
      dueSchedules, queuedNotifications: notifications?.queued ?? 0, failedNotifications: notifications?.failed ?? 0, lastTickAt: state?.lastTickAt?.toISOString() ?? null };
  }
  async function get(): Promise<TodayView> {
    const at = now(), week = 7 * 86400000, conversations = await entryConversations(db, workspaceId);
    const [approvals, schedules, notifications, sessions, applications, status, issues] = await Promise.all([
      db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" } }),
      db.schedule.findMany({ where: { workspaceId, status: "active", OR: [{ mode: "wake" }, { mode: "module", payload: { not: Prisma.DbNull } }], nextAt: { gte: at, lte: new Date(at.getTime() + week) } }, orderBy: { nextAt: "asc" }, take: 50 }),
      ports.notifications.list(20),
      db.session.findMany({ where: { workspaceId, ...conversations }, include: { runs: { where: { status: "running" }, select: { id: true }, take: 1 } }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }], take: 20 }),
      apps(), health(), problems().catch(() => []),
    ]);
    return { generatedAt: at.toISOString(), approvals: approvals.map(toApproval), updates: notifications, apps: applications, problems: issues,
      sessions: sessions.map(toSession),
      upcoming: schedules.filter(s => !s.until || s.nextAt! <= s.until).map(s => ({ scheduleId: s.id, mode: s.mode as TodayView["upcoming"][number]["mode"], label: s.label ?? (s.payload !== null ? s.text.slice(0, 300) : null), at: s.nextAt!.toISOString() })), health: status };
  }
  return { get, health };
}

async function openProblems(ports: StewardPorts, workspaceId: string): Promise<TodayView["problems"]> {
  const rows = await ports.db.module.findMany({ where: { workspaceId } });
  const summaries = await Promise.all(rows.map(row => moduleHealthSummary(ports, workspaceId, row)));
  return summaries.filter(item => item.open).map(item => ({
    module: item.module, moduleId: item.moduleId,
    incidentStatus: item.incident?.status === "recovered" ? null : item.incident?.status ?? null,
    contractFailures: item.contractFailureCount, nextAction: item.nextAction, since: item.incident?.lastAt ?? null,
  })).sort((a, b) => (b.since ?? "").localeCompare(a.since ?? "")).slice(0, 20);
}

/** The workspace's today view as Chrona sees it through the system tool chat.today. */
export function workspaceToday(ports: StewardPorts, workspaceId: string) {
  return createToday({ db: ports.db, workspaceId, now: ports.now }, {
    async provider() {
      if (!ports.provider) return { name: "unconfigured", available: false, sandboxed: false, lastError: null };
      try { const h = await ports.provider.health(); return { name: ports.provider.name, available: h.available, sandboxed: h.sandboxed, lastError: h.error?.slice(0, 500) ?? null }; }
      catch { return { name: ports.provider.name, available: false, sandboxed: false, lastError: "Provider health check failed" }; }
    },
    moduleSandbox: () => ports.sandbox?.isolated ?? false,
    notifications: createNotificationsView(ports, workspaceId),
  }, createApps(ports, workspaceId).list, () => openProblems(ports, workspaceId));
}
