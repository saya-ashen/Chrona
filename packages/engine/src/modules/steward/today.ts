import { affairPathSchema, type Health, type TodayView } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/notify-budget";
import type { RecordContext } from "./affairs";
import { notificationSettings } from "./settings";
import { toApproval, toRun, toSchedule } from "./store";
import type { WorkspaceFs } from "./workspace-fs";
export type HealthPorts = { provider(): Promise<Health["provider"]>; git(): Promise<boolean>; jobsSandbox(): boolean };
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
    return { provider, git, jobsSandbox: ports.jobsSandbox(), queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
      failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, settings.timezone) === day).length,
      dueSchedules, failingConnectors, queuedNotifications, failedNotifications, lastTickAt: state?.lastTickAt?.toISOString() ?? null };
  }
  async function get(): Promise<TodayView> {
    const at = now(), settings = notificationSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings), day = localDayKey(at, settings.timezone);
    const [approvals, schedules, edits, affairs, running, status] = await Promise.all([
      db.approval.findMany({ where: { workspaceId, status: "open" }, include: { affair: true }, orderBy: { createdAt: "asc" } }),
      db.schedule.findMany({ where: { workspaceId, status: "active", nextAt: { gte: at, lte: new Date(at.getTime() + 26 * 3600000) }, affair: { status: "active" } }, include: { affair: true }, orderBy: { nextAt: "asc" } }),
      db.activity.findMany({ where: { workspaceId, kind: "edit" }, include: { affair: true }, orderBy: { at: "desc" }, take: 100 }),
      db.affair.findMany({ where: { workspaceId, status: "active" }, orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }] }),
      db.run.findMany({ where: { workspaceId, status: "running" }, orderBy: { createdAt: "asc" } }), health(),
    ]);
    const changes: TodayView["changes"] = [];
    const seen = new Set<string>();
    for (const edit of edits) {
      if (edit.actor !== "user" && edit.actor !== "chrona") continue;
      const data = edit.data as { paths?: unknown } | null;
      if (!Array.isArray(data?.paths)) continue;
      for (const value of data.paths) {
        const path = affairPathSchema.safeParse(value);
        if (!path.success || seen.has(`${edit.affairId}:${path.data}`)) continue;
        seen.add(`${edit.affairId}:${path.data}`);
        changes.push({ affairId: edit.affairId, affairTitle: edit.affair.title, path: path.data, message: edit.text.slice(0, 500), at: edit.at.toISOString(), author: edit.actor });
      }
    }
    const todayPage = await findTodayPage(fs, affairs);
    return { generatedAt: at.toISOString(), approvals: approvals.map(toApproval), agenda: schedules.filter(s => localDayKey(s.nextAt!, settings.timezone) === day && (!s.until || s.nextAt! <= s.until)).map(s => ({ ...toSchedule(s), affairTitle: s.affair.title })), changes: changes.slice(0, 100), todayPage, running: running.map(toRun), health: status };
  }
  return { get, health };
}
