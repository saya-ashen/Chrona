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

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "暂无";
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "暂无";
}

function formatScheduleWindow(start: string | null | undefined, end: string | null | undefined, fallback: string) {
  if (start && end) {
    return `${formatDateTime(start)} - ${formatDateTime(end)}`;
  }

  return fallback;
}

function getPriorityLabel(priority: string) {
  switch (priority) {
    case "High":
      return "高";
    case "Medium":
      return "中";
    case "Low":
      return "低";
    default:
      return priority || "暂无";
  }
}

function getScheduleStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "AtRisk":
    case "Overdue":
      return "已超时";
    case "OnTrack":
      return "按计划进行";
    case "Unscheduled":
      return "未安排";
    case "Completed":
      return "已完成";
    default:
      return status || "暂无";
  }
}

function getRunStatusLabel(status: string | null | undefined, fallback: string) {
  switch (status) {
    case "Running":
      return "执行中";
    case "WaitingForApproval":
      return "等待审批";
    case "WaitingForInput":
      return "等待补充说明";
    case "Completed":
      return "已完成";
    case "Failed":
      return "执行中断";
    case "Cancelled":
      return "已取消";
    case null:
    case undefined:
      return fallback;
    default:
      return status;
  }
}

export function RunSidePanel({ taskShell, scheduleImpact, currentRun, reliability, approvals, artifacts, toolCalls }: RunSidePanelProps) {
  const { messages } = useI18n();
  const panelMessages = messages.components?.runSidePanel ?? {};
  const copy = {
    context: "背景",
    tools: "工具记录",
    outputs: "产出",
    priority: "优先级",
    due: "截止时间",
    scheduleWindow: "计划时间窗",
    noScheduleWindow: "暂无计划时间窗",
    noRun: "暂无运行",
    scheduleStatus: "当前状态",
    currentBlocker: "当前阻塞",
    noPendingApprovals: "当前没有待处理审批。",
    noArtifacts: "当前没有产出。",
    noToolCalls: "当前没有工具调用记录。",
    refreshed: "最近刷新",
    lastSync: "最近同步",
    lastUpdate: "最近更新",
    stopReason: "停止原因",
    stuckFor: "停滞时长",
    sync: "同步状态",
    healthy: "正常",
    stale: "过期",
    taskContext: "任务背景",
    scheduleReminder: "日程信息",
    syncSummary: "同步情况",
    runSummary: "当前执行",
    blockerSummary: "任务尚未开始执行，如需继续，请重新启动或调整日程。",
    approvals: "待处理审批",
    artifacts: "当前产出",
    ...panelMessages,
  };
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("context");

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
            <div className="space-y-3 text-muted-foreground">
              <div className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.taskContext}</p>
                <p className="mt-2"><span className="text-foreground">{copy.priority}：</span>{getPriorityLabel(taskShell.priority)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.due}：</span>{formatDate(taskShell.dueAt)}</p>
              </div>

              <div className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.scheduleReminder}</p>
                <p className="mt-2"><span className="text-foreground">{copy.scheduleWindow}：</span>{formatScheduleWindow(taskShell.scheduledStartAt, taskShell.scheduledEndAt, copy.noScheduleWindow)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.scheduleStatus}：</span>{getScheduleStatusLabel(scheduleImpact.status)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{scheduleImpact.summary}</p>
              </div>

              <div className="rounded-2xl border bg-background/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{copy.runSummary}</p>
                  <StatusBadge tone={reliability.isStale ? "warning" : "info"}>
                    {getRunStatusLabel(currentRun?.status, copy.noRun)}
                  </StatusBadge>
                </div>
                <p className="mt-2"><span className="text-foreground">{copy.sync}：</span>{reliability.isStale ? copy.stale : copy.healthy}</p>
                <p className="mt-1"><span className="text-foreground">{copy.refreshed}：</span>{formatDateTime(reliability.refreshedAt)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.lastSync}：</span>{formatDateTime(reliability.lastSyncedAt)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.lastUpdate}：</span>{formatDateTime(reliability.lastUpdatedAt)}</p>
                <p className="mt-1"><span className="text-foreground">{copy.stopReason}：</span>{reliability.stopReason ?? "暂无"}</p>
                {reliability.stuckFor ? <p className="mt-1"><span className="text-foreground">{copy.stuckFor}：</span>{reliability.stuckFor}</p> : null}
              </div>

              <div className="rounded-2xl border bg-background/80 p-3">
                <p className="text-sm font-medium text-foreground">{copy.currentBlocker}</p>
                <p className="mt-2">{taskShell.blockReason?.actionRequired ?? copy.blockerSummary}</p>
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
                    {tool.argumentsSummary ? <p className="mt-2 text-muted-foreground">参数：{tool.argumentsSummary}</p> : null}
                    {tool.resultSummary ? <p className="mt-1 text-muted-foreground">结果：{tool.resultSummary}</p> : null}
                    {tool.errorSummary ? <p className="mt-1 text-red-700">错误：{tool.errorSummary}</p> : null}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "outputs" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="font-medium text-foreground">{copy.approvals}</p>
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
                <p className="font-medium text-foreground">{copy.artifacts}</p>
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
