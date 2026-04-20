"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

type RunSidePanelProps = {
  taskShell: {
    priority: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    blockReason: { actionRequired?: string } | null;
  };
  scheduleImpact: { status: string; summary: string };
  currentRun: {
    id: string;
    status: string;
    startedAt?: string | null;
    endedAt?: string | null;
    updatedAt?: string | null;
    lastSyncedAt?: string | null;
    syncStatus?: string | null;
    resumeSupported?: boolean | null;
    pendingInputPrompt?: string | null;
    errorSummary?: string | null;
  } | null;
  reliability: {
    refreshedAt: string;
    lastSyncedAt: string | null;
    lastUpdatedAt: string | null;
    syncStatus: string | null;
    isStale: boolean;
    stuckFor: string | null;
    stopReason: string | null;
  };
  approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
  artifacts: Array<{ id: string; title: string; type: string; uri?: string | null }>;
  toolCalls: Array<{ id: string; toolName: string; status: string; argumentsSummary?: string | null; resultSummary?: string | null; errorSummary?: string | null }>;
};

const tabs = ["context", "tools", "outputs"] as const;

type CopyType = Record<string, string>;

function formatDate(value: string | null | undefined, fallback: string) {
  return value ? value.slice(0, 10) : fallback;
}

function formatDateTime(value: string | null | undefined, fallback: string) {
  return value ? value.slice(0, 16).replace("T", " ") : fallback;
}

function formatScheduleWindow(start: string | null | undefined, end: string | null | undefined, fallback: string, none: string) {
  if (start && end) {
    return `${formatDateTime(start, none)} - ${formatDateTime(end, none)}`;
  }

  return fallback;
}

function getPriorityLabel(priority: string, copy: CopyType) {
  switch (priority) {
    case "High":
      return copy.priorityHigh;
    case "Medium":
      return copy.priorityMedium;
    case "Low":
      return copy.priorityLow;
    default:
      return priority || copy.none;
  }
}

function getScheduleStatusLabel(status: string | null | undefined, copy: CopyType) {
  switch (status) {
    case "AtRisk":
    case "Overdue":
      return copy.scheduleAtRisk;
    case "OnTrack":
      return copy.scheduleOnTrack;
    case "Unscheduled":
      return copy.scheduleUnscheduled;
    case "Completed":
      return copy.scheduleCompleted;
    default:
      return status || copy.none;
  }
}

function getRunStatusLabel(status: string | null | undefined, fallback: string, copy: CopyType) {
  switch (status) {
    case "Running":
      return copy.runRunning;
    case "WaitingForApproval":
      return copy.runWaitingForApproval;
    case "WaitingForInput":
      return copy.runWaitingForInput;
    case "Completed":
      return copy.runCompleted;
    case "Failed":
      return copy.runFailed;
    case "Cancelled":
      return copy.runCancelled;
    case null:
    case undefined:
      return fallback;
    default:
      return status;
  }
}

function getRunStatusTone(status: string | null | undefined, isStale: boolean) {
  if (isStale) {
    return "warning" as const;
  }

  switch (status) {
    case "Completed":
      return "success" as const;
    case "Failed":
    case "Cancelled":
      return "critical" as const;
    case "WaitingForApproval":
    case "WaitingForInput":
      return "warning" as const;
    case "Running":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

const DEFAULTS: Record<string, string> = {
  context: "Context",
  tools: "Tool Log",
  outputs: "Outputs",
  priority: "Priority",
  due: "Due",
  scheduleWindow: "Schedule Window",
  noScheduleWindow: "No schedule window",
  noRun: "No run",
  scheduleStatus: "Status",
  currentBlocker: "Current Blocker",
  noPendingApprovals: "No pending approvals.",
  noArtifacts: "No outputs.",
  noToolCalls: "No tool call records.",
  refreshed: "Refreshed",
  lastSync: "Last Sync",
  lastUpdate: "Last Update",
  stopReason: "Stop Reason",
  stuckFor: "Stuck For",
  syncLabel: "Sync Status",
  healthy: "Healthy",
  stale: "Stale",
  taskContext: "Task Context",
  scheduleReminder: "Schedule Info",
  syncSummary: "Sync Summary",
  runSummary: "Run Info",
  blockerSummary: "No clear blocker, task can proceed.",
  approvalsLabel: "Pending Approvals",
  artifactsLabel: "Current Outputs",
  needsAction: "Needs Action",
  canProceed: "Can Proceed",
  syncExpired: "Sync Expired",
  argsLabel: "Args",
  resultLabel: "Result",
  errorLabel: "Error",
  none: "N/A",
  priorityHigh: "High",
  priorityMedium: "Medium",
  priorityLow: "Low",
  scheduleAtRisk: "At Risk",
  scheduleOnTrack: "On Track",
  scheduleUnscheduled: "Unscheduled",
  scheduleCompleted: "Completed",
  runRunning: "Running",
  runWaitingForApproval: "Waiting for Approval",
  runWaitingForInput: "Waiting for Input",
  runCompleted: "Completed",
  runFailed: "Failed",
  runCancelled: "Cancelled",
};

function getCopy(messages: Record<string, unknown>): Record<string, string> {
  const panelMessages = (messages.components as Record<string, Record<string, string>> | undefined)?.runSidePanel ?? {};
  return { ...DEFAULTS, ...panelMessages };
}

export function RunSidePanel({ taskShell, scheduleImpact, currentRun, reliability, approvals, artifacts, toolCalls }: RunSidePanelProps) {
  const { messages } = useI18n();
  const copy = getCopy(messages as Record<string, unknown>);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("context");
  const blockerText = taskShell.blockReason?.actionRequired ?? reliability.stopReason ?? copy.blockerSummary;
  const runStatusLabel = getRunStatusLabel(currentRun?.status, copy.noRun, copy);
  const runStatusTone = getRunStatusTone(currentRun?.status, reliability.isStale);
  const lastUpdatedAt = reliability.lastUpdatedAt ?? reliability.lastSyncedAt ?? reliability.refreshedAt;

  return (
    <aside className="space-y-3">
      <div className="rounded-[28px] border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(buttonVariants({ variant: activeTab === tab ? "secondary" : "ghost", size: "sm" }), "rounded-full")}
            >
              {copy[tab]}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4 text-sm">
          {activeTab === "context" ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <div id="current-blocker-panel" className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.currentBlocker}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={taskShell.blockReason?.actionRequired || reliability.stopReason ? "warning" : "info"}>
                    {taskShell.blockReason?.actionRequired || reliability.stopReason ? copy.needsAction : copy.canProceed}
                  </StatusBadge>
                </div>
                <p className="mt-2 leading-6">{blockerText}</p>
              </div>

              <div id="run-summary-panel" className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.taskContext}</p>
                <div className="mt-2 space-y-1.5">
                  <p><span className="text-foreground">{copy.priority}：</span>{getPriorityLabel(taskShell.priority, copy)}</p>
                  <p><span className="text-foreground">{copy.due}：</span>{formatDate(taskShell.dueAt, copy.none)}</p>
                </div>
              </div>

              <div className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.scheduleReminder}</p>
                <p className="mt-2"><span className="text-foreground">{copy.scheduleWindow}：</span>{formatScheduleWindow(taskShell.scheduledStartAt, taskShell.scheduledEndAt, copy.noScheduleWindow, copy.none)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.scheduleStatus}：</span>{getScheduleStatusLabel(scheduleImpact.status, copy)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{scheduleImpact.summary}</p>
              </div>

              <div className="rounded-2xl border bg-background/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{copy.runSummary}</p>
                  <StatusBadge tone={runStatusTone}>
                    {runStatusLabel}
                  </StatusBadge>
                  {reliability.isStale ? <StatusBadge tone="warning">{copy.syncExpired}</StatusBadge> : null}
                </div>
                <div className="mt-2 space-y-1.5">
                  <p><span className="text-foreground">{copy.syncLabel}：</span>{reliability.isStale ? copy.stale : copy.healthy}</p>
                  <p><span className="text-foreground">{copy.lastUpdate}：</span>{formatDateTime(lastUpdatedAt, copy.none)}</p>
                  {reliability.isStale ? <p><span className="text-foreground">{copy.lastSync}：</span>{formatDateTime(reliability.lastSyncedAt, copy.none)}</p> : null}
                  {reliability.stopReason ? <p><span className="text-foreground">{copy.stopReason}：</span>{reliability.stopReason}</p> : null}
                </div>
                {reliability.stuckFor ? <p className="mt-1"><span className="text-foreground">{copy.stuckFor}：</span>{reliability.stuckFor}</p> : null}
              </div>
            </div>
          ) : null}

          {activeTab === "tools" ? (
            <div className="space-y-3">
              {toolCalls.length === 0 ? (
                <p className="text-muted-foreground">{copy.noToolCalls}</p>
              ) : (
                toolCalls.map((tool) => (
                  <div key={tool.id} className="rounded-2xl border bg-background/80 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{tool.toolName}</p>
                      <StatusBadge>{tool.status}</StatusBadge>
                    </div>
                    {tool.argumentsSummary ? <p className="mt-2 text-muted-foreground">{copy.argsLabel}：{tool.argumentsSummary}</p> : null}
                    {tool.resultSummary ? <p className="mt-1 text-muted-foreground">{copy.resultLabel}：{tool.resultSummary}</p> : null}
                    {tool.errorSummary ? <p className="mt-1 text-red-700">{copy.errorLabel}：{tool.errorSummary}</p> : null}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "outputs" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="font-medium text-foreground">{copy.approvalsLabel}</p>
                {approvals.length === 0 ? (
                  <p className="text-muted-foreground">{copy.noPendingApprovals}</p>
                ) : (
                  approvals.map((approval) => (
                    <div key={approval.id} className="rounded-2xl border bg-background/80 p-3">
                      <p className="font-medium text-foreground">{approval.title}</p>
                      <p className="text-muted-foreground">{approval.status}</p>
                      {approval.summary ? <p className="mt-1 text-muted-foreground">{approval.summary}</p> : null}
                    </div>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{copy.artifactsLabel}</p>
                {artifacts.length === 0 ? (
                  <p className="text-muted-foreground">{copy.noArtifacts}</p>
                ) : (
                  artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-2xl border bg-background/80 p-3">
                      <p className="font-medium text-foreground">{artifact.title}</p>
                      <p className="text-muted-foreground">{artifact.type}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
