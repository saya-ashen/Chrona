import type { AiSidebarPageContextSummary, AiSidebarQuickAction } from "@chrona/contracts";
import type { SchedulePageData, ScheduleViewMode } from "../schedule-page-types";

export function createScheduleAiSidebarContext({
  workspaceId,
  data,
  selectedDate,
  activeView,
}: {
  workspaceId: string;
  data: SchedulePageData;
  selectedDate: string;
  activeView: ScheduleViewMode;
}): { context: AiSidebarPageContextSummary; actions: AiSidebarQuickAction[] } {
  const freeMinutes = Math.max(0, (12 * 60) - data.planningSummary.todayLoadMinutes);
  const conflictCount = data.planningSummary.conflictCount + data.summary.riskCount;
  const fingerprint = [
    workspaceId,
    selectedDate,
    activeView,
    data.summary.unscheduledCount,
    data.planningSummary.largestIdleWindowMinutes,
    conflictCount,
  ].join(":");

  const context: AiSidebarPageContextSummary = {
    type: "schedule",
    fingerprint,
    title: "Schedule context",
    primaryObjectLabel: selectedDate,
    workspaceId,
    selectedDate,
    unscheduledCount: data.summary.unscheduledCount,
    freeMinutes,
    largestIdleWindowMinutes: data.planningSummary.largestIdleWindowMinutes,
    conflictCount,
    activeView,
    primaryAction: data.summary.unscheduledCount > 0 ? "Smart schedule queue" : "Review timeline",
    capabilities: ["smart-schedule", "find-opening", "explain-unplaced", "handle-conflict"],
    highlights: [
      { label: "Selected date", value: selectedDate },
      { label: "Queue", value: String(data.summary.unscheduledCount), tone: data.summary.unscheduledCount > 0 ? "info" : "success" },
      { label: "Free time", value: `${freeMinutes}m` },
      { label: "Largest opening", value: `${data.planningSummary.largestIdleWindowMinutes}m` },
      { label: "Conflicts", value: String(conflictCount), tone: conflictCount > 0 ? "critical" : "success" },
    ],
  };

  return {
    context,
    actions: [
      {
        id: "smart-schedule",
        label: "Smart schedule",
        description: "Preview ghost blocks for queued work before confirming.",
        kind: "mutating-preview",
        enabled: data.summary.unscheduledCount > 0,
        disabledReason: "No queued tasks need placement.",
      },
      {
        id: "find-opening",
        label: "Find opening",
        description: "Find the safest available window on this day.",
        kind: freeMinutes > 0 ? "informational" : "mutating-preview",
        enabled: true,
      },
      {
        id: "explain-unplaced",
        label: "Explain unplaced",
        description: "Explain why queued work is not placed yet.",
        kind: "informational",
        enabled: true,
      },
      {
        id: "handle-conflict",
        label: "Handle conflict",
        description: "Preview conflict resolution before schedule changes persist.",
        kind: "mutating-preview",
        enabled: conflictCount > 0,
        disabledReason: "No conflicts detected for the current context.",
      },
    ],
  };
}
