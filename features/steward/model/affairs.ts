import { AFFAIR_STATUSES, type AffairDetail, type AffairStatus, type ToolState } from "@chrona/contracts";

export function parseKeywords(value: string) { return [...new Set(value.split(",").map(word => word.trim()).filter(Boolean))]; }
export function affairStatusOptions(labels: Record<AffairStatus, string>) { return AFFAIR_STATUSES.map(value => ({ value, label: labels[value] })); }
export function toolStateLabel(state: ToolState, labels: Record<ToolState, string>) { return labels[state]; }
export function isNotFound(error: unknown) { return typeof error === "object" && error !== null && "status" in error && error.status === 404; }
export function deriveAffair(detail: AffairDetail) {
  const attention = detail.attention.filter(item => item.status === "open");
  const events = detail.events.filter(item => item.linkStatus === "confirmed");
  const suggestedEvents = detail.suggestedEvents.filter(item => item.linkStatus === "suggested");
  return { attention, events, suggestedEvents, showSuggestions: suggestedEvents.length > 0 };
}
