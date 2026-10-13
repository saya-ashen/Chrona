import { TOOL_TRANSITIONS, type ToolState, type NotificationStatus, type FollowUp, type ManagedTool } from "@chrona/contracts";

export type ToolAction = (typeof TOOL_TRANSITIONS)[number] | "run";
const actions: Record<ToolState, ToolAction[]> = {
  generated: ["validate"], validation_failed: [], validated: ["authorize"],
  authorized: ["enable"], enabled: ["run", "disable"], disabled: ["enable", "retire"], retired: [],
};
export function toolActions(state: ToolState): readonly ToolAction[] { return actions[state]; }
export const toolSteps = ["generated", "validated", "authorized", "enabled"] as const;
export function toolProgress(state: ToolState) {
  const index = state === "disabled" || state === "retired" ? -1 : state === "validation_failed" ? 0 : toolSteps.indexOf(state);
  return toolSteps.map((step, i) => ({ step, reached: i <= index, current: step === state }));
}
export function toolTransitionInput(tool: Pick<ManagedTool, "version">, action: (typeof TOOL_TRANSITIONS)[number]) { return { action, expectedVersion: tool.version }; }
export function canRetryNotification(status: NotificationStatus) { return status === "failed"; }
export function canFinishFollowUp(status: FollowUp["status"]) { return status === "pending"; }
export function stewardIsStale(lastTickAt: string | null, now: number) { return lastTickAt === null || !Number.isFinite(Date.parse(lastTickAt)) || now - Date.parse(lastTickAt) > 10 * 60 * 1000; }
/** Only transport error messages, never request payloads. */
export function serverReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error) || typeof error.message !== "string") return null;
  return error.message.slice(0, 2000);
}
export type SampleCase = { title: string; body: string; author: string; expectMatch: boolean };
export const panelColumns = ["title", "author", "occurredAt", "status", "note"] as const;
export type PanelColumn = (typeof panelColumns)[number];
export function hasBothSamples(cases: SampleCase[]) { return cases.some(item => item.expectMatch) && cases.some(item => !item.expectMatch); }
export function eventRuleSpec(keywords: string, author: string, disposition: "retain" | "digest" | "await_decision", note: string, cases: SampleCase[]) {
  return { type: "event_rule", match: { anyKeywords: [...new Set(keywords.split(",").map(s => s.trim()).filter(Boolean))], ...(author.trim() ? { author: author.trim() } : {}) }, then: { disposition, note }, cases };
}
export function tablePanelSpec(columns: PanelColumn[], source: "affair_events" | "affair_attention", labels: Record<PanelColumn, string>) { return { type: "table_panel", columns: columns.map(key => ({ key, label: labels[key] })), source }; }
