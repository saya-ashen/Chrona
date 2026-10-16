import { formatShortDateTime } from "./format";
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

type WorkCopy = { running: string; queued: string; replying: string; started: string; followUp: string };
export function workStatus(work: AffairDetail["affair"]["work"], locale: string, copy: WorkCopy) {
  if (!work) return null;
  if (work.state === "queued") return copy.queued.replace("{label}", work.label || copy.followUp);
  return `${work.label ? copy.running.replace("{label}", work.label) : copy.replying} · ${copy.started.replace("{time}", formatShortDateTime(work.since, locale))}`;
}
