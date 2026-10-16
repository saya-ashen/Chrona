import type { Activity, AffairDetail } from "@chrona/contracts";
import { visiblePath } from "./affair-file";

export type TimelineEntry = { id: string; at: string; kind: "message" | "edit" | "created" | "approvalCreated" | "approvalResolved"; actor?: "user" | "chrona"; text: string; paths: string[] };
function editPaths(activity: Activity) {
  const paths = activity.data?.paths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string" && visiblePath(path)) : [];
}
export function affairTimeline(detail: AffairDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ id: "created", at: detail.affair.createdAt, kind: "created", text: "", paths: [] }];
  for (const message of detail.messages) entries.push({ id: `message:${message.id}`, at: message.at, kind: "message", actor: message.direction === "in" ? "user" : "chrona", text: message.text, paths: [] });
  const edits = new Map<string, TimelineEntry>();
  for (const activity of detail.activity) {
    if (activity.kind !== "edit") continue;
    const key = typeof activity.data?.commit === "string" ? activity.data.commit : activity.id;
    const paths = editPaths(activity);
    const existing = edits.get(key);
    if (existing) {
      existing.paths = [...new Set([...existing.paths, ...paths])];
      if (Date.parse(activity.at) > Date.parse(existing.at)) existing.at = activity.at;
    } else edits.set(key, { id: `edit:${key}`, at: activity.at, kind: "edit", actor: activity.actor === "user" ? "user" : "chrona", text: "", paths });
  }
  entries.push(...edits.values());
  for (const approval of detail.approvals) {
    entries.push({ id: `approval:${approval.id}`, at: approval.createdAt, kind: "approvalCreated", text: approval.title, paths: [] });
    if (approval.resolvedAt) entries.push({ id: `resolved:${approval.id}`, at: approval.resolvedAt, kind: "approvalResolved", text: approval.title, paths: [] });
  }
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}
