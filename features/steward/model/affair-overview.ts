import type { Affair, TodayView } from "@chrona/contracts";
import { formatShortDateTime } from "./format";

type PillCopy = { runningPill: string; queuedPill: string; waitingPill: string; activePill: string };
type PillAffair = Pick<Affair, "work" | "openApprovals" | "status">;
export function progressPill(affair: PillAffair, copy: PillCopy) {
  if (affair.work?.state === "running") return copy.runningPill;
  if (affair.work?.state === "queued") return copy.queuedPill;
  return affair.openApprovals ? copy.waitingPill : null;
}
export function affairPill(affair: PillAffair, copy: PillCopy, statuses: Record<Affair["status"], string>) {
  return progressPill(affair, copy) ?? (affair.status === "active" ? copy.activePill : statuses[affair.status]);
}
export function affairPillClass(affair: PillAffair) {
  if (affair.openApprovals && !affair.work) return "bg-warning/10 text-warning";
  return affair.work?.state === "running" || affair.status === "active" && !affair.work ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground";
}
export function progressPillClass(affair: PillAffair) {
  return affair.work?.state === "running" ? "bg-primary-soft text-primary" : affair.work ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning";
}
export function progressDetail(changedPages: number, next: string | null, pages: string) {
  return [changedPages > 0 ? pages.replace("{count}", String(changedPages)) : null, next].filter(Boolean).join(" · ");
}

/** Plain text for overview cards, never Markdown destinations. */
export function plainSummary(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ").trim();
}

type SummaryCopy = { waiting: string; working: string; progress: string; clear: string };
export function todaySummary(view: TodayView, copy: SummaryCopy): string {
  if (view.approvals.length) return copy.waiting.replace("{count}", String(view.approvals.length));
  const working = view.progress.filter(item => item.affair.work !== null).length;
  if (working) return copy.working.replace("{count}", String(working));
  if (view.progress.length) return copy.progress.replace("{count}", String(view.progress.length));
  return copy.clear;
}

/** The sentence under the headline: only what the headline did not already say. */
export function todayDetail(view: TodayView, copy: SummaryCopy & { upcoming: string; separator: string; end: string }): string {
  const working = view.progress.filter(item => item.affair.work !== null).length;
  const lead = view.approvals.length ? 0 : working ? 1 : view.progress.length ? 2 : 3;
  const parts = [
    ...(lead < 1 && working ? [copy.working.replace("{count}", String(working))] : []),
    ...(lead < 2 && view.progress.length ? [copy.progress.replace("{count}", String(view.progress.length))] : []),
    ...(view.upcoming.length ? [copy.upcoming.replace("{count}", String(view.upcoming.length))] : []),
  ];
  return parts.length ? parts.join(copy.separator) + copy.end : "";
}

type OverviewCopy = { running: string; queued: string; replying: string; followUp: string; next: string };
export function affairOverview(affair: Affair, locale: string, copy: OverviewCopy) {
  const work = affair.work;
  const status = !work ? null : work.state === "queued"
    ? copy.queued.replace("{label}", work.label ?? copy.followUp)
    : work.label ? copy.running.replace("{label}", work.label) : copy.replying;
  return {
    summary: plainSummary(affair.summary),
    status,
    next: affair.nextSchedule ? copy.next.replace("{label}", affair.nextSchedule.label ?? copy.followUp).replace("{time}", formatShortDateTime(affair.nextSchedule.at, locale)) : null,
    updatedAt: formatShortDateTime(affair.lastActivityAt, locale),
  };
}
