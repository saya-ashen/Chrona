import { createScheduleSchema, type Schedule } from "@chrona/contracts";
import { StewardClientError } from "./client";

export const currentFolder = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export function newPagePath(folder: string, path: string) {
  if (!path.trim().toLowerCase().endsWith(".md")) throw new StewardClientError("invalidInput");
  return folder ? `${folder}/${path.trim()}` : path.trim();
}
export type ScheduleDraft = { mode: Schedule["mode"]; kind: Schedule["rule"]["kind"]; time: string; at: string; days: number[]; minutes: string; text: string; command: string; label: string };
export const initialSchedule: ScheduleDraft = { mode: "remind", kind: "daily", time: "08:00", at: "", days: [1], minutes: "60", text: "", command: "", label: "" };
export function scheduleInput(draft: ScheduleDraft) {
  const date = new Date(draft.at);
  const rule = draft.kind === "at" ? { kind: draft.kind, at: Number.isNaN(date.getTime()) ? "" : date.toISOString() }
    : draft.kind === "every" ? { kind: draft.kind, minutes: Number(draft.minutes) }
    : draft.kind === "weekly" ? { kind: draft.kind, days: draft.days, time: draft.time } : { kind: draft.kind, time: draft.time };
  const parsed = createScheduleSchema.safeParse({ mode: draft.mode, rule, text: draft.text, ...(draft.label.trim() ? { label: draft.label.trim() } : {}), ...(draft.mode === "job" ? { command: draft.command } : {}) });
  if (!parsed.success || (draft.mode === "job" && !draft.command.trim())) throw new StewardClientError("invalidInput");
  return parsed.data;
}
