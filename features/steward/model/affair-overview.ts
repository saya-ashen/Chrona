import type { Affair, TodayView } from "@chrona/contracts";
import { formatShortDateTime } from "./format";

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
