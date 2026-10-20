import { formatShortDateTime } from "./format";
import { fileTree, visiblePath } from "./affair-file";
import type { AffairDetail, Schedule } from "@chrona/contracts";

export function scheduleLabel(schedule: Schedule, fallback: string) {
  return schedule.label || (schedule.mode === "remind" ? schedule.text : fallback);
}
export function affairCenter(detail: AffairDetail, fallback: string) {
  const next = detail.affair.nextSchedule;
  return {
    approvals: detail.approvals.filter(item => item.status === "open"),
    active: detail.schedules.filter(item => item.status === "active" || item.status === "paused"),
    completed: detail.schedules.filter(item => item.status === "done" || item.status === "cancelled"),
    nextLabel: next?.label ?? fallback,
  };
}

export function affairPages(detail: AffairDetail | null | undefined, path: string) {
  return {
    selected: detail?.files.find(file => file.path === path && file.kind === "file" && visiblePath(path)),
    tree: detail ? fileTree(detail.files) : [],
  };
}

export type WorkIssue = "failed" | "timed_out" | "provider_unavailable" | "cancelled";
/** Retain an unfinished outcome, but never invite duplicate work while another attempt exists. */
export function affairWorkFeedback(detail: Pick<AffairDetail, "affair" | "runs">) {
  const settled = detail.runs.filter(run => run.status !== "running" && run.status !== "queued");
  const time = (run: AffairDetail["runs"][number]) => Date.parse(run.endedAt ?? run.createdAt);
  const status = settled.sort((a, b) => time(b) - time(a))[0]?.status;
  const issue: WorkIssue | null = detail.affair.status === "active"
    && (status === "failed" || status === "timed_out" || status === "provider_unavailable" || status === "cancelled") ? status : null;
  return { issue, recovering: !!issue && !!detail.affair.work, canResume: !!issue && !detail.affair.work };
}

type WorkCopy = { running: string; queued: string; replying: string; started: string; followUp: string };
export function workStatus(work: AffairDetail["affair"]["work"], locale: string, copy: WorkCopy) {
  if (!work) return null;
  if (work.state === "queued") return copy.queued.replace("{label}", work.label || copy.followUp);
  return `${work.label ? copy.running.replace("{label}", work.label) : copy.replying} · ${copy.started.replace("{time}", formatShortDateTime(work.since, locale))}`;
}
