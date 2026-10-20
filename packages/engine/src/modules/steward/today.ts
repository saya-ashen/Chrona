import { readUiCard } from "./ui-files";
import { affairPathSchema, type Health, type TodayView } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { RecordContext } from "./affairs";
import { notificationSettings } from "./settings";
import { toApproval } from "./store";
import { createAffairs } from "./affairs";
import type { WorkspaceFs } from "./workspace-fs";
export type HealthPorts = { provider(): Promise<Health["provider"]>; git(): Promise<boolean>; moduleSandbox(): boolean };
async function findTodayPage(fs: WorkspaceFs, affairs: { id: string; dirName: string }[]): Promise<TodayView["todayPage"]> {
  for (const affair of affairs) {
    try {
      const directory = fs.forAffair(affair.dirName), path = affairPathSchema.safeParse((await directory.read(".chrona/today")).content.trim());
      if (!path.success) continue;
      await directory.read(path.data); // Pointer must resolve through the confined filesystem.
      return { affairId: affair.id, path: path.data };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as { code?: string }).code === "invalid" || (error as { code?: string }).code === "forbidden") continue;
      throw error;
    }
  }
  return null;
}
export function createToday({ db, workspaceId, now }: RecordContext, fs: WorkspaceFs, ports: HealthPorts) {
  async function health(): Promise<Health> {
    const at = now(), settings = notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
    const [provider, git, runs, dueSchedules, failingConnectors, queuedNotifications, failedNotifications, state] = await Promise.all([
      ports.provider(), ports.git(), db.run.findMany({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { createdAt: { gte: new Date(at.getTime() - 48 * 3600000) } }] } }),
      db.schedule.count({ where: { workspaceId, status: "active", nextAt: { lte: at }, affair: { status: "active" } } }),
      db.connector.count({ where: { workspaceId, status: { in: ["failing", "needs_authorization"] } } }),
      db.notification.count({ where: { workspaceId, status: "queued" } }), db.notification.count({ where: { workspaceId, status: { in: ["failed", "uncertain"] } } }),
      db.stewardState.findUnique({ where: { workspaceId } }),
    ]);
    const day = localDayKey(at, settings.timezone);
    return { provider, git, moduleSandbox: ports.moduleSandbox(), queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
      failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, settings.timezone) === day).length,
      dueSchedules, failingConnectors, queuedNotifications, failedNotifications, lastTickAt: state?.lastTickAt?.toISOString() ?? null };
  }
  async function get(): Promise<TodayView> {
    const at = now(), week = 7 * 86400000, since = new Date(at.getTime() - week);
    const [approvals, schedules, affairs, notifications, edits, status] = await Promise.all([
      db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" } }),
      db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { gte: at, lte: new Date(at.getTime() + week) }, affair: { status: "active" } }, include: { affair: true }, orderBy: { nextAt: "asc" }, take: 50 }),
      createAffairs({ db, workspaceId, now }, fs).list(),
      db.notification.findMany({ where: { workspaceId, affairId: { not: null }, createdAt: { gte: since }, status: { notIn: ["suppressed"] } }, orderBy: { createdAt: "desc" } }),
      db.activity.findMany({ where: { workspaceId, kind: "edit", at: { gte: since } }, select: { affairId: true, data: true } }),
      health(),
    ]);
    const pages = new Map<string, Set<string>>();
    for (const edit of edits) {
      const paths = (edit.data as { paths?: unknown } | null)?.paths;
      if (Array.isArray(paths)) for (const path of paths) if (affairPathSchema.safeParse(path).success) pages.set(edit.affairId, (pages.get(edit.affairId) ?? new Set()).add(path));
    }
    // An affair belongs in "what happened" when Chrona is on it now or it changed this week.
    const progress = await Promise.all(affairs.filter(affair => affair.status !== "done" && (affair.work || Date.parse(affair.lastActivityAt) >= since.getTime())).slice(0, 50).map(async affair => ({
      affair,
      updates: notifications.filter(n => n.affairId === affair.id).slice(0, 3).map(n => ({ title: n.title, body: n.body, at: n.createdAt.toISOString() })),
      changedPages: pages.get(affair.id)?.size ?? 0,
      card: await readUiCard(await createAffairs({ db, workspaceId, now }, fs).files(affair.id)),
    })));
    const upcoming = schedules.filter(s => !s.until || s.nextAt! <= s.until).map(s => ({ scheduleId: s.id, affairId: s.affairId, affairTitle: s.affair.title, mode: s.mode as TodayView["upcoming"][number]["mode"], label: s.label ?? (s.mode === "remind" ? s.text.slice(0, 300) : null), at: s.nextAt!.toISOString() }));
    const active = await db.affair.findMany({ where: { workspaceId, status: "active" }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }] });
    return { generatedAt: at.toISOString(), approvals: approvals.map(toApproval), upcoming, progress, todayPage: await findTodayPage(fs, active), health: status };
  }
  return { get, health };
}
