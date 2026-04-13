"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  acceptTaskResult,
  approveApproval,
  createFollowUpTask,
  editAndApproveApproval,
  generateTaskPlan,
  markTaskDone,
  provideInput,
  rejectApproval,
  reopenTask,
  retryRun,
  sendOperatorMessage,
  startRun,
} from "@/app/actions/task-actions";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { inputClassName, textareaClassName } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { NextActionHero } from "@/components/work/next-action-hero";
import { TaskShell } from "@/components/work/task-shell";
import { WorkInspector } from "@/components/work/work-inspector";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

type WorkPageClientProps = {
  initialData: {
    taskShell: {
      id: string;
      workspaceId: string;
      title: string;
      runtimeModel: string | null;
      prompt: string | null;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string;
      blockReason: {
        actionRequired?: string;
        blockType?: string;
        scope?: string;
        since?: string;
      } | null;
    };
    currentRun:
        | {
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
          }
      | null;
    currentIntervention:
      | {
          kind: "idle" | "input" | "approval" | "retry" | "review" | "observe";
          title: string;
          description: string;
          whyNow: string;
          actionLabel: string;
          defaultMessage?: string;
          evidence: Array<{
            label: string;
            value: string;
            tone: "neutral" | "warning" | "critical";
            href?: string | null;
          }>;
          approvals?: Array<{ id: string; title: string; status: string; summary?: string }>;
        }
      | null;
    latestOutput: {
      kind: "artifact" | "message" | "empty";
      title: string;
      body: string;
      timestamp: string | null;
      href: string | null;
      empty: boolean;
      sourceLabel: string;
    };
    scheduleImpact: {
      status: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      summary: string;
    };
    reliability: {
      refreshedAt: string;
      lastSyncedAt: string | null;
      lastUpdatedAt: string | null;
      syncStatus: string | null;
      isStale: boolean;
      stuckFor: string | null;
      stopReason: string | null;
    };
    closure: {
      resultAccepted: boolean;
      acceptedAt: string | null;
      isDone: boolean;
      doneAt: string | null;
      canAcceptResult: boolean;
      canMarkDone: boolean;
      canCreateFollowUp: boolean;
      canRetry: boolean;
      canReopen: boolean;
      latestFollowUp:
        | {
            id: string;
            title: string;
            status: string;
            scheduleStatus: string;
            createdAt: string | null;
          }
        | null;
    };
    taskPlan: {
      state: "empty" | "ready";
      revision: "generated" | "updated" | null;
      generatedBy: string | null;
      isMock: boolean;
      summary: string | null;
      updatedAt: string | null;
      changeSummary: string | null;
      currentStepId: string | null;
      steps: Array<{
        id: string;
        title: string;
        objective: string;
        phase: string;
        status: "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";
        needsUserInput: boolean;
      }>;
    };
    workspaceRail?: {
      sections: Array<{
        id: string;
        title: string;
        items: Array<{
          taskId: string;
          title: string;
          statusLabel: string;
          tone: "active" | "waiting" | "done";
          isCurrent: boolean;
        }>;
      }>;
    };
    workstreamItems: Array<{
      id: string;
      eventType: string;
      title: string;
      summary: string;
      kind: string;
      badge: string;
      whyItMatters: string;
      linkedEvidenceLabel?: string | null;
      payload: Record<string, unknown>;
      runtimeTs?: string | null;
    }>;
    conversation: Array<{ id: string; role: string; content: string; runtimeTs?: string | null }>;
    inspector: {
      approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
      artifacts: Array<{ id: string; title: string; type: string; uri?: string | null; createdAt?: string | null }>;
      toolCalls: Array<{
        id: string;
        toolName: string;
        status: string;
        argumentsSummary?: string | null;
        resultSummary?: string | null;
        errorSummary?: string | null;
      }>;
    };
  };
};

type WorkbenchComposer = {
  mode: "start" | "response" | "note" | "continue" | "retry";
  description: string;
  inputLabel: string;
  submitLabel: string;
  defaultValue: string;
  placeholder?: string;
  statusHint: string;
  submitVariant?: "default" | "outline" | "secondary";
};

type CollaborationFeedItem = {
  id: string;
  kind: "decision" | "user" | "agent" | "event" | "result";
  eyebrow: string;
  title: string;
  body: string;
  meta?: string | null;
};

type WorkbenchCopy = {
  workbenchTitle: string;
  workbenchDescription: string;
  workbenchStatus: string;
  taskArrangement: string;
  taskArrangementHint: string;
  conversationInput: string;
  operatorNote: string;
  sendAndContinue: string;
  sendNoteToAgent: string;
  retryRun: string;
  continueRun: string;
  continueRunDescription: string;
  responseRequiredDescription: string;
  noteQueuedForCheckpoint: string;
  noteWhileRunningDescription: string;
  noteWhileAwaitingApprovalDescription: string;
  currentRun: string;
  noActiveRunYet: string;
};

const DEFAULT_COPY = {
  openSchedule: "打开日程",
  viewTaskDetail: "查看任务详情",
  runPrefix: "运行",
  noRun: "暂无运行",
  duePrefix: "截止",
  interventionFocus: "当前重点",
  noBlockingAction: "当前没有记录阻塞动作。",
  plannedWindow: "计划时间窗",
  reliability: "同步状态",
  lastRefresh: "最近刷新",
  lastSync: "最近同步",
  stopReason: "停止原因",
  stuckFor: "停滞时长",
  staleSync: "同步已过期",
  healthySync: "同步正常",
  workbenchTitle: "给 Agent 补充要求",
  workbenchDescription: "补充约束、修改方向、指定输出格式，或提供缺失背景。",
  workbenchStatus: "下一步",
  nextAction: "建议动作",
  whyNow: "为什么现在处理",
  evidence: "相关背景",
  taskArrangement: "给 Agent 补充要求",
  taskArrangementHint: "例如：先澄清任务目标，列出限制条件，并给我一版简短执行计划，输出用要点形式。",
  collaboration: "协作",
  agentMessage: "Agent 更新",
  conversationInput: "发送给 Agent 的内容",
  operatorNote: "人工备注",
  sendToAgent: "发送给 Agent",
  sendAndContinue: "启动并继续",
  sendNoteToAgent: "发送补充说明",
  resumeWithMessage: "带说明继续",
  currentRun: "当前运行",
  approve: "批准",
  reject: "拒绝",
  editedInstruction: "修改后的指令",
  editAndApprove: "修改后批准",
  retryPrompt: "重试提示词",
  retryRun: "重新执行",
  acceptResult: "确认结果",
  markTaskDone: "标记任务完成",
  createFollowUp: "创建后续任务",
  followUpTitle: "后续任务标题",
  followUpDue: "后续任务截止时间",
  reopenTask: "重新打开任务",
  latestFollowUp: "最新后续任务",
  resultAccepted: "结果已确认",
  taskDone: "任务已完成",
  continueRun: "继续下一轮执行",
  continueRunDescription: "这轮执行已经结束。先确认最新结果，再直接从这里继续下一轮，而不是切到新的流程里。",
  resultActionsTitle: "后续动作",
  followUpOptional: "可选：拆出后续任务",
  followUpOptionalDescription: "只有当这项工作真的需要拆成新轨道时，再创建后续任务。",
  runPrompt: "运行提示词",
  startRunHere: "立即启动",
  noActiveRunYet: "当前还没有活动运行",
  fallbackNoOperatorInput: "还没有任务记录。启动任务后，这里会按时间显示关键进展，例如开始执行、等待确认或产出更新。",
  fallbackStartFromTaskPage: "先启动运行，再从这里继续补充要求。",
  sharedOutput: "最新结果",
  sharedOutputDescription: "把最新可用结果放在工作区附近，避免你来回翻日志。",
  usedByNextAction: "下一步会用到",
  updated: "更新于",
  openArtifact: "打开产物",
  executionWorkstream: "任务记录",
  executionWorkstreamDescription: "背景记录默认收在这里；需要追查细节时再切换对话往来。",
  workstream: "任务记录",
  conversation: "对话往来",
  latestExecutionMilestones: "最近任务记录",
  conversationEvidence: "对话往来",
  conversationEvidenceDescription: "当里程碑摘要不够时，再展开查看完整对话。",
  composerRequired: "需要填写发送给 Agent 的内容",
  messageRequired: "消息不能为空",
  noteQueuedForCheckpoint: "消息会在下一个安全检查点送达，并在同步后显示。",
  responseRequiredDescription: "补充说明后，阻塞中的运行才能继续。",
  noteWhileRunningDescription: "运行进行中也可以补充背景，但不会强行打断当前执行。",
  noteWhileAwaitingApprovalDescription: "审批未完成前也可以补充背景，但运行仍会等待审批结果。",
  promptRequired: "提示词不能为空",
  noActiveRunToResume: "当前没有可继续的运行。",
  currentRunCannotAcceptMessages: "当前运行暂时不能接收人工消息。",
  actionFailed: "操作失败",
  keyboardHint: "Enter 提交 · Shift+Enter 换行",
  currentStage: "当前阶段",
  sourceSchedule: "来自日程",
  noScheduleWindow: "暂无计划时间窗",
  taskReadySummary: "任务还没有启动。现在最重要的是决定是否从这个工作台开始第一轮执行。",
  taskRunningSummary: "任务正在执行中。只有在需要纠偏或补充限制时再介入。",
  taskWaitingInputSummary: "Agent 正在等待你的补充说明，才能继续当前任务。",
  taskWaitingApprovalSummary: "Agent 正在等待你的决定，审批后才能继续。",
  taskCompletedSummary: "最新一轮已经完成。先确认结果，再决定是否继续推进。",
  taskAwaitingReviewLabel: "待确认",
  taskFailedSummary: "上一轮执行已中断。现在要决定是恢复、重试，还是改方向。",
  currentKeyDecision: "当前需要你决定",
  collaborationFlow: "对话记录",
  collaborationFlowDescription: "输入后，下面按时间顺序显示对话消息：Agent 在左，你在右。",
  latestResult: "最新结果",
  inputArea: "输入区",
  quickPrompts: "快捷补充",
  newTask: "新建任务",
  workspaceViews: "工作区入口",
  allTasks: "任务列表",
  openInbox: "收件箱",
  openMemory: "记忆库",
  currentTask: "当前任务",
  taskStages: "任务状态",
  taskLifecycle: "任务生命周期",
  collaborationStage: "当前协作阶段",
  lifecycleNotStarted: "未开始",
  lifecycleInProgress: "进行中",
  lifecycleCompleted: "已完成",
  latestDecision: "最新决策",
  openWorkbench: "打开工作台",
  workbenchCrumb: "工作台",
  decisionStatus: "当前状态",
  decisionPlan: "启动后 Agent 会",
  decisionOptions: "你现在可以",
  modifyBeforeStart: "先补充说明再启动",
  adjustSchedule: "调整日程",
  notNow: "暂不处理",
  resultEmptyTitle: "尚未生成结果",
  resultEmptyDescription: "启动后，这里会优先显示 Agent 的第一轮理解、执行建议、草稿，或待你确认的问题。",
  resultPreviewTitle: "启动后，这里通常会显示：",
  resultPreviewUnderstanding: "第一轮任务理解",
  resultPreviewPlan: "执行建议",
  resultPreviewDraft: "草稿或摘要",
  resultPreviewQuestions: "待你确认的问题",
  secondaryActions: "次操作",
  decisionReminder: "补充提醒",
  milestoneWaitingStart: "等待你决定是否启动",
  taskShellAria: "任务概览",
  nextActionHeroAria: "当前重点区域",
  latestResultAria: "最新结果区域",
  executionStreamAria: "任务记录区域",
  workInspectorAria: "工作检查区",
  scheduleCrumb: "日程",
  currentBlocker: "当前阻塞",
  deadline: "截止时间",
  nextActionBadge: "当前重点",
  latestResultEyebrow: "最新结果",
  taskPlan: "任务计划",
  planReadySummary: "计划会随当前运行状态更新。",
  planEmptySummary: "生成后会在这里显示当前步骤与恢复入口。",
  noTaskPlan: "还没有任务计划",
  generatePlaceholderPlan: "生成占位计划",
  currentStep: "当前步骤",
  resumeFromPlan: "重新规划后继续",
  pendingApprovals: "待处理审批",
  noPendingApprovals: "当前没有待处理审批。",
  currentArtifacts: "当前产出",
  noArtifacts: "当前没有产出。",
  toolLog: "工具记录",
  noToolLog: "当前没有工具调用记录。",
  toolArguments: "参数",
  toolResult: "结果",
  toolError: "错误",
  taskContext: "任务背景",
  priorityLabel: "优先级",
  dueAtLabel: "截止时间",
  scheduledWindowLabel: "计划时间窗",
  scheduleStatusLabel: "日程状态",
  runStatusLabel: "运行状态",
  syncStatusLabel: "同步状态",
  lastUpdatedLabel: "最近更新",
  lastSyncedLabel: "最近同步",
  stopReasonLabel: "停止原因",
  invalidFollowUpDate: "后续任务截止时间无效",
  invalidFollowUpTitle: "后续任务标题不能为空",
  noValue: "暂无",
  pendingStep: "待开始",
  inProgressStep: "进行中",
  waitingForUserStep: "等待你确认",
  doneStep: "已完成",
  blockedStep: "阻塞",
  closureStatusTitle: "任务生命周期",
  closureAcceptedAt: "结果确认时间",
  closureDoneAt: "任务完成时间",
  latestFollowUpStatus: "任务状态",
  latestFollowUpSchedule: "日程状态",
  latestFollowUpCreatedAt: "创建时间",
  approvalSummaryFallback: "Review the approval request before resuming the run.",
} as const;

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function isOverdueScheduleStatus(status: string | null | undefined) {
  return status === "AtRisk" || status === "Overdue";
}

function getTaskSummary(data: WorkPageClientProps["initialData"], copy: typeof DEFAULT_COPY) {
  switch (data.currentRun?.status) {
    case "WaitingForApproval":
      return copy.taskWaitingApprovalSummary;
    case "WaitingForInput":
      return copy.taskWaitingInputSummary;
    case "Running":
      return copy.taskRunningSummary;
    case "Completed":
      return copy.taskCompletedSummary;
    case "Failed":
    case "Cancelled":
      return copy.taskFailedSummary;
    default:
      return copy.taskReadySummary;
  }
}

function getTaskStatusMeta(data: WorkPageClientProps["initialData"], copy: typeof DEFAULT_COPY) {
  if (data.closure.isDone) {
    return { label: "已完成", tone: "success" as const };
  }

  if (!data.currentRun) {
    return { label: "待开始", tone: "neutral" as const };
  }

  if (data.currentRun.status === "Failed" || data.currentRun.status === "Cancelled") {
    return { label: "已中断", tone: "critical" as const };
  }

  if (data.currentRun.status === "Completed") {
    return { label: copy.taskAwaitingReviewLabel, tone: "warning" as const };
  }

  return { label: "进行中", tone: "info" as const };
}

function getCurrentException(data: WorkPageClientProps["initialData"]) {
  if (data.reliability.isStale) {
    return "同步异常，等待恢复";
  }

  switch (data.currentRun?.status) {
    case "WaitingForApproval":
      return data.taskShell.blockReason?.actionRequired ?? "等待审批";
    case "WaitingForInput":
      return data.currentRun.pendingInputPrompt ?? data.taskShell.blockReason?.actionRequired ?? "等待补充说明";
    case "Failed":
    case "Cancelled":
      return data.reliability.stopReason ?? data.taskShell.blockReason?.actionRequired ?? "执行已中断，等待恢复";
    default:
      return isOverdueScheduleStatus(data.scheduleImpact.status) ? "已超出原计划时间窗" : null;
  }
}

function getQuickPrompts(workbenchComposer: WorkbenchComposer, currentRun: WorkPageClientProps["initialData"]["currentRun"]) {
  if (workbenchComposer.mode === "start") return ["先给出简洁计划", "明确关键假设", "先提出澄清问题"];
  if (currentRun?.status === "Running") return ["只补充必要背景", "保持输出简洁", "发现风险就重点提示"];
  if (currentRun?.status === "WaitingForApproval") return ["解释当前阻塞", "给出更安全的改法", "总结接下来的步骤"];
  return ["基于最新结果继续", "收紧下一步动作", "记录这次决策"];
}

function getCurrentPlanAction(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  taskPlan: WorkPageClientProps["initialData"]["taskPlan"],
) {
  if (taskPlan.state !== "ready" || !taskPlan.currentStepId) {
    return null;
  }

  if (!currentRun) {
    return { label: "从这一步启动", href: "#next-action-hero" };
  }

  switch (currentRun.status) {
    case "WaitingForApproval":
      return { label: "处理当前确认", href: "#next-action-hero" };
    case "WaitingForInput":
      return { label: "补充说明后继续", href: "#next-action-hero" };
    case "Running":
      return { label: "查看当前进展", href: "#execution-stream" };
    case "Completed":
      return { label: "确认结果", href: "#latest-result" };
    case "Failed":
    case "Cancelled":
      return { label: "从这一步恢复", href: "#next-action-hero" };
    default:
      return { label: "查看当前动作", href: "#next-action-hero" };
  }
}

function getScheduleStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "AtRisk":
      return "有风险";
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

function getRunStatusLabel(status: string | null | undefined) {
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
    default:
      return "暂无运行";
  }
}

function buildConversationFeed(data: WorkPageClientProps["initialData"]): CollaborationFeedItem[] {
  return [...data.conversation]
    .sort((a, b) => (a.runtimeTs ?? "").localeCompare(b.runtimeTs ?? ""))
    .map((entry) => {
      const isAgent = entry.role.toLowerCase().includes("agent") || entry.role.toLowerCase().includes("assistant");

      return {
        id: entry.id,
        kind: isAgent ? "agent" : "user",
        eyebrow: isAgent ? "Agent" : "你",
        title: isAgent ? "Agent" : "你",
        body: entry.content,
        meta: entry.runtimeTs ? formatDateTime(entry.runtimeTs) : null,
      };
    });
}

function getScheduleSourceSummary(taskShell: WorkPageClientProps["initialData"]["taskShell"], copy: typeof DEFAULT_COPY) {
  if (taskShell.scheduledStartAt && taskShell.scheduledEndAt) {
    return `${copy.sourceSchedule}: ${formatDateTime(taskShell.scheduledStartAt)} → ${formatDateTime(taskShell.scheduledEndAt)}`;
  }

  return `${copy.sourceSchedule}: ${copy.noScheduleWindow}`;
}

function getComposerDefaultValue(taskTitle: string, currentRun: WorkPageClientProps["initialData"]["currentRun"]) {
  return currentRun?.pendingInputPrompt ?? `继续处理：${taskTitle}`;
}

function getStartRunDefaultValue(taskTitle: string) {
  return `继续处理：${taskTitle}`;
}

function getFollowUpDefaultTitle(taskTitle: string) {
  return `${taskTitle} - follow-up`;
}

function getPassiveHeroGuidance(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  closure: WorkPageClientProps["initialData"]["closure"],
  copy: typeof DEFAULT_COPY,
) {
  if (currentRun?.status === "Completed") {
    const actions = [
      closure.canAcceptResult ? copy.acceptResult : null,
      closure.canMarkDone ? copy.markTaskDone : null,
      closure.canCreateFollowUp ? copy.createFollowUp : null,
      closure.canReopen ? copy.reopenTask : null,
    ].filter((value): value is string => Boolean(value));

    return {
      description: copy.taskCompletedSummary,
      actions: actions.length > 0 ? actions.join(" / ") : copy.latestResult,
    };
  }

  if (currentRun?.status === "Failed" || currentRun?.status === "Cancelled") {
    const actions = [
      closure.canReopen ? copy.reopenTask : null,
      closure.canCreateFollowUp ? copy.createFollowUp : null,
    ].filter((value): value is string => Boolean(value));

    return {
      description: copy.taskFailedSummary,
      actions: actions.length > 0 ? actions.join(" / ") : copy.latestResult,
    };
  }

  if (closure.isDone) {
    return {
      description: copy.taskCompletedSummary,
      actions: closure.canReopen ? copy.reopenTask : copy.latestResult,
    };
  }

  return {
    description: copy.workbenchDescription,
    actions: copy.latestResult,
  };
}

export function parseDateInputForSubmission(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  const parsedDate = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay, 12));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== parsedYear
    || parsedDate.getUTCMonth() !== parsedMonth - 1
    || parsedDate.getUTCDate() !== parsedDay
  ) {
    return null;
  }

  return parsedDate;
}

function isSafeExternalHref(href: string) {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

function isInternalAppHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

function getWorkbenchComposer(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  currentIntervention: WorkPageClientProps["initialData"]["currentIntervention"],
  closure: WorkPageClientProps["initialData"]["closure"],
  taskShell: WorkPageClientProps["initialData"]["taskShell"],
  copy: WorkbenchCopy,
): WorkbenchComposer | null {
  if (!currentRun) {
    return {
      mode: "start",
      description: copy.workbenchDescription,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.sendAndContinue,
      defaultValue: taskShell.prompt ?? getStartRunDefaultValue(taskShell.title),
      statusHint: copy.noActiveRunYet,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "WaitingForInput") {
    return {
      mode: "response",
      description: currentIntervention?.description ?? copy.responseRequiredDescription,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.sendAndContinue,
      defaultValue: currentIntervention?.defaultMessage ?? getComposerDefaultValue(taskShell.title, currentRun),
      statusHint: `${copy.currentRun}: ${currentRun.status}`,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "Running") {
    return {
      mode: "note",
      description: copy.noteWhileRunningDescription,
      inputLabel: copy.conversationInput,
      submitLabel: copy.sendNoteToAgent,
      defaultValue: "",
      statusHint: `${copy.currentRun}: ${currentRun.status} · ${copy.noteQueuedForCheckpoint}`,
      submitVariant: "outline",
    };
  }

  if (currentRun.status === "WaitingForApproval") {
    return {
      mode: "note",
      description: copy.noteWhileAwaitingApprovalDescription,
      inputLabel: copy.conversationInput,
      submitLabel: copy.sendNoteToAgent,
      defaultValue: "",
      statusHint: `${copy.currentRun}: ${currentRun.status} · ${copy.noteQueuedForCheckpoint}`,
      submitVariant: "outline",
    };
  }

  if (currentRun.status === "Completed") {
    if (!closure.canRetry) {
      return null;
    }

    return {
      mode: "retry",
      description: copy.taskCompletedSummary,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.retryRun,
      defaultValue: taskShell.prompt ?? getStartRunDefaultValue(taskShell.title),
      statusHint: `${copy.currentRun}: ${currentRun.status}`,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "Failed" || currentRun.status === "Cancelled") {
    if (!closure.canRetry) {
      return null;
    }

    return {
      mode: "retry",
      description: currentIntervention?.description ?? copy.workbenchDescription,
        inputLabel: copy.taskArrangement,
        submitLabel: copy.retryRun,
        defaultValue: taskShell.prompt ?? `恢复任务：${taskShell.title}`,
        statusHint: `${copy.currentRun}: ${currentRun.status}`,
        submitVariant: "default",
      };
  }

  return {
    mode: "note",
    description: currentIntervention?.description ?? copy.workbenchDescription,
    inputLabel: copy.conversationInput,
    submitLabel: copy.sendNoteToAgent,
    defaultValue: "",
    statusHint: `${copy.currentRun}: ${currentRun.status}`,
    submitVariant: "outline",
  };
}

function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  const nativeEvent = event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
    isComposing?: boolean;
    keyCode?: number;
  };

  if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
    return;
  }

  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const router = useRouter();
  const { messages } = useI18n();
  const workPageMessages = messages.components?.workPage ?? {};
  const copy = {
    ...DEFAULT_COPY,
    ...workPageMessages,
  };
  const [data, setData] = useState(initialData);
  const [heroErrorMessage, setHeroErrorMessage] = useState<string | null>(null);
  const [resultErrorMessage, setResultErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const refreshEpochRef = useRef(0);

  const refresh = useCallback(async ({ silent = false, epoch = refreshEpochRef.current }: { silent?: boolean; epoch?: number } = {}) => {
    try {
      const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(copy.actionFailed);
      }

      const next = (await response.json()) as WorkPageClientProps["initialData"];

      if (epoch !== refreshEpochRef.current) {
        return true;
      }

      startTransition(() => setData(next));
      return true;
    } catch (error) {
      if (silent) {
        return false;
      }

      router.refresh();
      throw error instanceof Error ? error : new Error(copy.actionFailed);
    }
  }, [copy.actionFailed, data.taskShell.id, router]);

  const runAction = useCallback(async (action: () => Promise<void>, setScopedErrorMessage: (message: string | null) => void) => {
    try {
      setIsPending(true);
      setScopedErrorMessage(null);
      const actionEpoch = ++refreshEpochRef.current;
      await action();
      await refresh({ epoch: actionEpoch });
      return true;
    } catch (error) {
      setScopedErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
      return false;
    } finally {
      setIsPending(false);
    }
  }, [copy.actionFailed, refresh]);

  useEffect(() => {
    if (isPending || !data.currentRun || !["Running", "WaitingForInput", "WaitingForApproval"].includes(data.currentRun.status)) {
      return;
    }

    const intervalMs = Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun, isPending, refresh]);

  const currentRun = data.currentRun;
  const taskStatusMeta = getTaskStatusMeta(data, copy);
  const currentException = getCurrentException(data);
  const taskSummary = getTaskSummary(data, copy);
  const sourceSummary = getScheduleSourceSummary(data.taskShell, copy);
  const workbenchComposer = getWorkbenchComposer(
    currentRun,
    data.currentIntervention,
    data.closure,
    data.taskShell,
    copy,
  );
  const currentPlanAction = getCurrentPlanAction(currentRun, data.taskPlan);
  const quickPrompts = workbenchComposer ? getQuickPrompts(workbenchComposer, currentRun) : [];
  const collaborationFeed = useMemo(() => buildConversationFeed(data), [data]);
  const [composerValue, setComposerValue] = useState(workbenchComposer?.defaultValue ?? "");

  useEffect(() => {
    setComposerValue(workbenchComposer?.defaultValue ?? "");
  }, [workbenchComposer?.defaultValue, workbenchComposer?.mode, currentRun?.id]);

  async function submitWorkbenchInput(inputText: string) {
    const didSucceed = await runAction(async () => {
      if (!currentRun) {
        await startRun({ taskId: data.taskShell.id, prompt: inputText });
        return;
      }

      if (currentRun.status === "WaitingForInput") {
        await provideInput({ runId: currentRun.id, inputText });
        return;
      }

      if (currentRun.status === "Running" || currentRun.status === "WaitingForApproval") {
        await sendOperatorMessage({ runId: currentRun.id, message: inputText });
        return;
      }

      if (["Completed", "Failed", "Cancelled"].includes(currentRun.status)) {
        await retryRun({ taskId: data.taskShell.id, prompt: inputText });
        return;
      }

      throw new Error(copy.currentRunCannotAcceptMessages);
    }, setHeroErrorMessage);

    if (didSucceed) {
      setComposerValue("");
      setComposerResetKey((value) => value + 1);
    }
  }

  async function handleWorkbenchSubmit(formData: FormData) {
    const rawInputText = String(formData.get("message") ?? "");
    const inputText = rawInputText.trim();

    if (!inputText) {
      setHeroErrorMessage(copy.composerRequired);
      return;
    }

    await submitWorkbenchInput(inputText);
  }

  function handleGenerateTaskPlan() {
    void runAction(async () => {
      await generateTaskPlan({ taskId: data.taskShell.id });
    }, setHeroErrorMessage);
  }

  const blockerSummary = data.taskShell.blockReason?.actionRequired
    ?? data.reliability.stopReason
    ?? currentException
    ?? "当前没有明确阻塞，任务可以继续推进。";
  const runLabel = getRunStatusLabel(currentRun?.status);
  const scheduleLabel = getScheduleStatusLabel(data.scheduleImpact.status);
  const heroTitle = data.currentIntervention?.title ?? copy.nextAction;
  const passiveHeroGuidance = getPassiveHeroGuidance(currentRun, data.closure, copy);
  const heroDescription = data.currentIntervention?.description ?? workbenchComposer?.description ?? passiveHeroGuidance.description;
  const heroWhyNow = data.currentIntervention?.whyNow ?? taskSummary;
  const heroActionLabel = data.currentIntervention?.actionLabel ?? copy.nextAction;
  const heroEvidence = data.currentIntervention?.evidence ?? [];
  const heroModeLabel = currentRun ? getRunStatusLabel(currentRun.status) : copy.noActiveRunYet;

  const heroApprovals = (data.currentIntervention?.approvals ?? []).length > 0 ? (
    <div className="space-y-3">
      {(data.currentIntervention?.approvals ?? []).map((approval) => (
        <div key={approval.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-primary-foreground">{approval.title}</p>
            <StatusBadge tone="warning">{approval.status}</StatusBadge>
          </div>
          <p className="mt-2 text-sm text-primary-foreground/75">
            {approval.summary ?? copy.approvalSummaryFallback}
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <form
                action={async () => {
                  await runAction(async () => {
                    await approveApproval(approval.id);
                  }, setHeroErrorMessage);
                }}
              >
                <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", className: "disabled:opacity-60" })}>
                  {copy.approve}
                </button>
              </form>
              <form
                action={async () => {
                  await runAction(async () => {
                    await rejectApproval(approval.id);
                  }, setHeroErrorMessage);
                }}
              >
                <button type="submit" disabled={isPending} className={buttonVariants({ variant: "destructive", className: "disabled:opacity-60" })}>
                  {copy.reject}
                </button>
              </form>
            </div>
            <form
              action={async (formData) => {
                await runAction(async () => {
                  await editAndApproveApproval(formData);
                }, setHeroErrorMessage);
              }}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <input type="hidden" name="approvalId" value={approval.id} />
              <label htmlFor={`approval-edit-${approval.id}`} className="sr-only">
                {copy.editedInstruction}
              </label>
              <input
                id={`approval-edit-${approval.id}`}
                type="text"
                name="editedContent"
                placeholder={copy.editedInstruction}
                className={cn(inputClassName, "min-w-0 w-full border-white/12 bg-white/[0.06] text-primary-foreground placeholder:text-primary-foreground/45")}
              />
              <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "border-white/15 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08] disabled:opacity-60" })}>
                {copy.editAndApprove}
              </button>
            </form>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const heroComposer = workbenchComposer ? (
    <form
      key={`workbench-${composerResetKey}-${currentRun?.id ?? "none"}-${workbenchComposer.mode}`}
      action={handleWorkbenchSubmit}
      className="min-w-0 space-y-4"
    >
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">{copy.inputArea}</p>
        <p className="text-sm text-primary-foreground/78">{workbenchComposer.description || copy.workbenchDescription}</p>
      </div>
      {heroErrorMessage ? <p role="alert" className="rounded-md border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">{heroErrorMessage}</p> : null}
      <p className="text-xs text-primary-foreground/60">{copy.taskArrangementHint}</p>
      <textarea
        aria-label={workbenchComposer.inputLabel}
        name="message"
        rows={6}
        required
        value={composerValue}
        placeholder={workbenchComposer.placeholder}
        onChange={(event) => setComposerValue(event.target.value)}
        onKeyDown={handleComposerKeyDown}
        className={cn(textareaClassName, "min-h-32 w-full min-w-0 resize-y border-white/12 bg-black/20 text-primary-foreground placeholder:text-primary-foreground/35")}
      />
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={buttonVariants({ variant: "outline", size: "sm", className: "border-white/12 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08]" })}
              onClick={() => setComposerValue((current) => (current.trim() ? `${current.trim()}\n${prompt}` : prompt))}
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-primary-foreground/60">{workbenchComposer.statusHint} · {copy.keyboardHint}</p>
          <button
            type="submit"
            disabled={isPending}
            className={buttonVariants({ variant: workbenchComposer.submitVariant ?? "default", size: "lg", className: cn("disabled:opacity-60", workbenchComposer.submitVariant === "outline" ? "border-white/12 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08]" : "") })}
          >
            {workbenchComposer.submitLabel}
          </button>
        </div>
      </div>
    </form>
  ) : (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">{copy.inputArea}</p>
      <p className="text-sm leading-7 text-primary-foreground/78">{passiveHeroGuidance.description}</p>
      <p className="text-xs text-primary-foreground/60">{passiveHeroGuidance.actions}</p>
    </div>
  );

  const latestResultClosure = (
    data.closure.resultAccepted
    || data.closure.isDone
    || data.closure.canMarkDone
    || data.closure.canCreateFollowUp
    || data.closure.canReopen
    || data.closure.latestFollowUp
  ) ? (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{copy.closureStatusTitle}</p>

      {(data.closure.resultAccepted || data.closure.isDone) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.closure.resultAccepted ? (
            <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
              <p className="font-medium text-foreground">{copy.resultAccepted}</p>
              <p className="mt-2 text-muted-foreground">{copy.closureAcceptedAt}: {formatDateTime(data.closure.acceptedAt)}</p>
            </div>
          ) : null}
          {data.closure.isDone ? (
            <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
              <p className="font-medium text-foreground">{copy.taskDone}</p>
              <p className="mt-2 text-muted-foreground">{copy.closureDoneAt}: {formatDateTime(data.closure.doneAt)}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.closure.latestFollowUp ? (
        <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
          <p className="font-medium text-foreground">{copy.latestFollowUp}</p>
          <p className="mt-2 text-foreground">{data.closure.latestFollowUp.title}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge>{`${copy.latestFollowUpStatus}: ${data.closure.latestFollowUp.status}`}</StatusBadge>
            <StatusBadge>{`${copy.latestFollowUpSchedule}: ${getScheduleStatusLabel(data.closure.latestFollowUp.scheduleStatus)}`}</StatusBadge>
          </div>
          {data.closure.latestFollowUp.createdAt ? (
            <p className="mt-3 text-muted-foreground">{copy.latestFollowUpCreatedAt}: {formatDateTime(data.closure.latestFollowUp.createdAt)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {(data.closure.canMarkDone || data.closure.canReopen) ? (
          <div className="space-y-3 rounded-[22px] border border-border/60 bg-background/70 p-4">
            {data.closure.canMarkDone ? (
              <form
                action={async () => {
                  await runAction(async () => {
                    await markTaskDone({ taskId: data.taskShell.id });
                  }, setResultErrorMessage);
                }}
              >
                <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                  {copy.markTaskDone}
                </button>
              </form>
            ) : null}

            {data.closure.canReopen ? (
              <form
                action={async () => {
                  await runAction(async () => {
                    await reopenTask({ taskId: data.taskShell.id });
                  }, setResultErrorMessage);
                }}
              >
                <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                  {copy.reopenTask}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {data.closure.canCreateFollowUp ? (
          <form
            action={async (formData) => {
              const title = String(formData.get("title") ?? "").trim();
              const dueAtValue = String(formData.get("dueAt") ?? "").trim();

              await runAction(async () => {
                await createFollowUpTask({
                  taskId: data.taskShell.id,
                  title,
                  dueAt: (() => {
                    if (!title) {
                      throw new Error(copy.invalidFollowUpTitle);
                    }

                    if (!dueAtValue) {
                      return null;
                    }

                    const parsedDueAt = parseDateInputForSubmission(dueAtValue);

                    if (!parsedDueAt) {
                      throw new Error(copy.invalidFollowUpDate);
                    }

                    return parsedDueAt;
                  })(),
                });
              }, setResultErrorMessage);
            }}
            className="space-y-3 rounded-[22px] border border-border/60 bg-background/70 p-4"
          >
            <p className="text-sm font-medium text-foreground">{copy.followUpOptional}</p>
            <p className="text-sm text-muted-foreground">{copy.followUpOptionalDescription}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="follow-up-title" className="text-sm font-medium text-foreground">{copy.followUpTitle}</label>
                <input
                  id="follow-up-title"
                  type="text"
                  name="title"
                  required
                  defaultValue={getFollowUpDefaultTitle(data.taskShell.title)}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="follow-up-due" className="text-sm font-medium text-foreground">{copy.followUpDue}</label>
                <input id="follow-up-due" type="date" name="dueAt" className={inputClassName} />
              </div>
            </div>
            <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
              {copy.createFollowUp}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  ) : null;

  const latestResultActions = (
    data.closure.canAcceptResult
    || data.closure.canRetry
    || data.latestOutput.href
  ) ? (
    <>
      {data.closure.canAcceptResult ? (
        <form
          action={async () => {
            await runAction(async () => {
              await acceptTaskResult({ taskId: data.taskShell.id });
            }, setResultErrorMessage);
          }}
        >
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", className: "disabled:opacity-60" })}>
            {copy.acceptResult}
          </button>
        </form>
      ) : null}

      {data.closure.canRetry ? (
        <form
          action={async () => {
            await runAction(async () => {
              await retryRun({
                taskId: data.taskShell.id,
                prompt: data.taskShell.prompt ?? getStartRunDefaultValue(data.taskShell.title),
              });
            }, setResultErrorMessage);
          }}
        >
          <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
            {copy.retryRun}
          </button>
        </form>
      ) : null}

      {data.latestOutput.href && isInternalAppHref(data.latestOutput.href) ? (
        <LocalizedLink href={data.latestOutput.href} className={buttonVariants({ variant: "outline" })}>
          {copy.openArtifact}
        </LocalizedLink>
      ) : data.latestOutput.href && isSafeExternalHref(data.latestOutput.href) ? (
        <a href={data.latestOutput.href} className={buttonVariants({ variant: "outline" })}>
          {copy.openArtifact}
        </a>
      ) : null}
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <TaskShell
        title={data.taskShell.title}
        summary={taskSummary}
        taskStatus={taskStatusMeta}
        runLabel={runLabel}
        scheduleLabel={scheduleLabel}
        blockerSummary={blockerSummary}
        sourceSummary={sourceSummary}
        dueLabel={`${copy.duePrefix}: ${formatDate(data.taskShell.dueAt)}`}
        taskId={data.taskShell.id}
        workspaceId={data.taskShell.workspaceId}
        statusMeta={currentException ? <StatusBadge tone="warning">{currentException}</StatusBadge> : null}
        labels={{
          ariaLabel: copy.taskShellAria,
          breadcrumbRoot: copy.scheduleCrumb,
          breadcrumbCurrent: copy.workbenchCrumb,
          taskList: copy.allTasks,
          inbox: copy.openInbox,
          memory: copy.openMemory,
          openSchedule: copy.openSchedule,
          viewTaskDetail: copy.viewTaskDetail,
          currentBlocker: copy.currentBlocker,
          plannedWindow: copy.plannedWindow,
          deadline: copy.deadline,
        }}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_320px] xl:items-start">
        <div className="space-y-6">
          <NextActionHero
            title={heroTitle}
            description={heroDescription}
            whyNow={heroWhyNow}
            actionLabel={heroActionLabel}
            evidence={heroEvidence}
            approvals={heroApprovals}
            composer={heroComposer}
            modeLabel={heroModeLabel}
            labels={{
              ariaLabel: copy.nextActionHeroAria,
              badge: copy.nextActionBadge,
              whyNow: copy.whyNow,
              evidence: copy.evidence,
            }}
          />

          <LatestResultPanel
            output={data.latestOutput}
            updatedLabel={copy.updated}
            emptyTitle={copy.resultEmptyTitle}
            emptyDescription={copy.resultEmptyDescription}
            previewTitle={copy.resultPreviewTitle}
            previewItems={[
              copy.resultPreviewUnderstanding,
              copy.resultPreviewPlan,
              copy.resultPreviewDraft,
              copy.resultPreviewQuestions,
            ]}
            error={resultErrorMessage ? <p role="alert" className="rounded-md border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-700">{resultErrorMessage}</p> : null}
            closure={latestResultClosure}
            actions={latestResultActions}
            usedByNextAction={Boolean(data.currentIntervention && data.currentIntervention.kind !== "observe")}
            labels={{
              ariaLabel: copy.latestResultAria,
              eyebrow: copy.latestResultEyebrow,
              usedByNextAction: copy.usedByNextAction,
              actionsTitle: copy.resultActionsTitle,
            }}
          />

          <section aria-label={copy.executionStreamAria} id="execution-stream" className="rounded-[30px] border bg-card p-5 shadow-sm sm:p-6">
            <div className="border-b border-border/60 pb-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{copy.workstream}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{copy.executionWorkstream}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{copy.executionWorkstreamDescription}</p>
            </div>

            <div className="mt-5 space-y-6">
              <ExecutionTimeline title={copy.latestExecutionMilestones} events={data.workstreamItems} />

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{copy.conversationEvidence}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.conversationEvidenceDescription}</p>
                </div>

                {collaborationFeed.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                    {copy.fallbackNoOperatorInput}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {collaborationFeed.map((item) => {
                      const alignClass = item.kind === "user" ? "ml-auto" : "mr-auto";
                      const toneClass = item.kind === "user"
                        ? "border-primary/15 bg-primary/[0.05]"
                        : item.kind === "agent"
                          ? "border-emerald-200/70 bg-emerald-50/60"
                          : "border-border/60 bg-background/80";

                      return (
                        <article key={item.id} className={cn("max-w-[92%]", alignClass)}>
                          <div className={cn("rounded-[24px] border px-4 py-4 text-sm shadow-sm", toneClass)}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.eyebrow}</span>
                              {item.meta ? <span className="text-xs text-muted-foreground">{item.meta}</span> : null}
                            </div>
                            <p className="mt-2 font-medium text-foreground">{item.title}</p>
                            <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.body}</div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <WorkInspector
            plan={data.taskPlan}
            isPending={isPending}
            onGenerate={handleGenerateTaskPlan}
            currentAction={currentPlanAction}
            currentException={currentException}
            approvals={data.inspector.approvals}
            artifacts={data.inspector.artifacts}
            toolCalls={data.inspector.toolCalls}
            context={{
              priority: data.taskShell.priority,
              dueAt: data.taskShell.dueAt,
              scheduledStartAt: data.taskShell.scheduledStartAt,
              scheduledEndAt: data.taskShell.scheduledEndAt,
              scheduleStatus: scheduleLabel,
              scheduleSummary: data.scheduleImpact.summary,
              runStatus: runLabel,
              syncStatus: data.reliability.syncStatus,
              isStale: data.reliability.isStale,
              lastUpdatedAt: data.reliability.lastUpdatedAt ?? data.reliability.lastSyncedAt ?? data.reliability.refreshedAt,
              lastSyncedAt: data.reliability.lastSyncedAt,
              stopReason: data.reliability.stopReason,
              blockerSummary,
            }}
            labels={{
              ariaLabel: copy.workInspectorAria,
              sections: {
                plan: copy.taskPlan,
                approvals: copy.pendingApprovals,
                artifacts: copy.currentArtifacts,
                tools: copy.toolLog,
                context: copy.taskContext,
              },
              emptyValue: copy.noValue,
              emptyScheduleWindow: copy.noScheduleWindow,
              stepStatuses: {
                pending: { label: copy.pendingStep, tone: "neutral" },
                in_progress: { label: copy.inProgressStep, tone: "info" },
                waiting_for_user: { label: copy.waitingForUserStep, tone: "warning" },
                done: { label: copy.doneStep, tone: "success" },
                blocked: { label: copy.blockedStep, tone: "critical" },
              },
              planTitle: copy.taskPlan,
              planReadySummary: copy.planReadySummary,
              planEmptySummary: copy.planEmptySummary,
              planEmptyTitle: copy.noTaskPlan,
              generatePlan: copy.generatePlaceholderPlan,
              currentStep: copy.currentStep,
              currentBlocker: copy.currentBlocker,
              resumePlan: copy.resumeFromPlan,
              approvalsTitle: copy.pendingApprovals,
              noApprovals: copy.noPendingApprovals,
              artifactsTitle: copy.currentArtifacts,
              noArtifacts: copy.noArtifacts,
              toolsTitle: copy.toolLog,
              noTools: copy.noToolLog,
              toolArguments: copy.toolArguments,
              toolResult: copy.toolResult,
              toolError: copy.toolError,
              contextTitle: copy.taskContext,
              priority: copy.priorityLabel,
              dueAt: copy.dueAtLabel,
              scheduledWindow: copy.scheduledWindowLabel,
              scheduleStatus: copy.scheduleStatusLabel,
              runStatus: copy.runStatusLabel,
              syncStatus: copy.syncStatusLabel,
              staleSync: copy.staleSync,
              healthySync: copy.healthySync,
              lastUpdated: copy.lastUpdatedLabel,
              lastSynced: copy.lastSyncedLabel,
              stopReason: copy.stopReasonLabel,
            }}
          />
        </div>
      </div>
    </div>
  );
}
