import type { WorkEntry, WorkSummary, WorkView } from "@chrona/contracts";
export const dimensions = ["participation", "reply", "calendar", "meeting"] as const;
export const signalValues = {
  participation: ["unknown", "accepted", "declined", "tentative"], reply: ["unknown", "pending", "sent", "failed"],
  calendar: ["unknown", "pending", "accepted", "declined", "failed"], meeting: ["unknown", "upcoming", "happened"],
} as const;
function scheduleMismatch(record: WorkView["record"], schedule: WorkView["schedule"]) {
  if (!record || record.cancelled || !record.context.window) return false;
  if (!schedule) return true;
  return Date.parse(record.context.window.startsAt) !== Date.parse(schedule.startsAt) || Date.parse(record.context.window.endsAt) !== Date.parse(schedule.endsAt);
}
function nextStep(view: WorkView, mismatch: boolean, uncertain: boolean) {
  if (mismatch) return "scheduleConflict";
  if (view.pendingChanges.length) return "reviewChange";
  if (uncertain) return "reconcile";
  return view.record?.cancelled ? "cancelFollowUp" : "chooseNext";
}
export function deriveWorkState(view: WorkView) {
  const record = view.record, mismatch = scheduleMismatch(record, view.schedule);
  const uncertain = !!record && Object.values(record.signals).some(s => s.value === "unknown" || s.value === "failed");
  return { pendingCount: view.pendingChanges.length, mismatch, uncertain, nextKey: nextStep(view, mismatch, uncertain),
    stateKey: record?.cancelled ? "cancelled" : view.pendingChanges.length ? "changePending" : record?.needsAttention ? "needsAttention" : "upToDate" } as const;
}
export function proposalStale(record: WorkSummary, entry: WorkEntry) { return entry.details.baseRevision !== Number(record.revision.split(":").at(-1)); }
export function formatWorkTime(window: WorkSummary["context"]["window"], locale: string) {
  if (!window) return "";
  const formatter = new Intl.DateTimeFormat(locale, { timeZone: window.timezone, year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  return formatter.formatRange(new Date(window.startsAt), new Date(window.endsAt));
}
export function localDateInput(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso), pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function windowFromForm(form: FormData) {
  const startsAt = new Date(String(form.get("startsAt"))), endsAt = new Date(String(form.get("endsAt")));
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error("invalid");
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
