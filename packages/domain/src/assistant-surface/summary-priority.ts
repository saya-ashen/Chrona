import type { AssistantStatusSummary, AssistantSurfaceSeverity } from "@chrona/contracts";

const severityRank: Record<AssistantSurfaceSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  success: 3,
  neutral: 4,
};

export function compareAssistantSeverity(a: AssistantSurfaceSeverity, b: AssistantSurfaceSeverity) {
  return severityRank[a] - severityRank[b];
}

export function sortAssistantSummaries(summaries: AssistantStatusSummary[]) {
  return [...summaries].sort((a, b) => compareAssistantSeverity(a.severity, b.severity));
}

export function pickTopAssistantSummary(summaries: AssistantStatusSummary[]): AssistantStatusSummary {
  return sortAssistantSummaries(summaries)[0] ?? {
    id: "empty",
    label: "Status",
    value: "No active page context",
    severity: "neutral",
  };
}
