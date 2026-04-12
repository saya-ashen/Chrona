"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  acceptTaskResult,
  approveApproval,
  editAndApproveApproval,
  generateTaskPlan,
  provideInput,
  rejectApproval,
  retryRun,
  sendOperatorMessage,
  startRun,
} from "@/app/actions/task-actions";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { inputClassName, textareaClassName } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { CollaborationStream } from "@/components/work/collaboration-stream";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { RunSidePanel } from "@/components/work/run-side-panel";
import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
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

function getTaskStatusMeta(data: WorkPageClientProps["initialData"]) {
  if (data.closure.isDone) {
    return { label: "已完成", tone: "success" as const };
  }

  if (!data.currentRun) {
    return { label: "待开始", tone: "neutral" as const };
  }

  if (data.currentRun.status === "Failed" || data.currentRun.status === "Cancelled") {
    return { label: "已中断", tone: "critical" as const };
  }

  return { label: "进行中", tone: "info" as const };
}

function getCurrentPhaseLabel(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  closure: WorkPageClientProps["initialData"]["closure"],
) {
  if (closure.isDone) {
    return "收尾完成";
  }

  switch (currentRun?.status) {
    case "Running":
    case "Failed":
    case "Cancelled":
      return "执行中";
    case "WaitingForApproval":
    case "WaitingForInput":
    case "Completed":
      return "等待确认";
    default:
      return "理解任务";
  }
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
    return { label: "从这一步启动", href: "#current-key-decision" };
  }

  switch (currentRun.status) {
    case "WaitingForApproval":
      return { label: "处理当前确认", href: "#pending-approvals" };
    case "WaitingForInput":
      return { label: "补充说明后继续", href: "#work-composer" };
    case "Running":
      return { label: "查看当前进展", href: "#collaboration-flow" };
    case "Completed":
      return { label: "确认结果", href: "#latest-result" };
    case "Failed":
    case "Cancelled":
      return { label: "从这一步恢复", href: "#work-composer" };
    default:
      return { label: "查看当前动作", href: "#current-key-decision" };
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

function getContinueRunPlaceholder(taskTitle: string) {
  return `基于最新结果继续推进：${taskTitle}`;
}

function getWorkbenchComposer(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  currentIntervention: WorkPageClientProps["initialData"]["currentIntervention"],
  taskShell: WorkPageClientProps["initialData"]["taskShell"],
  copy: WorkbenchCopy,
): WorkbenchComposer {
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
    return {
      mode: "continue",
      description: copy.continueRunDescription,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.continueRun,
      defaultValue: "",
      placeholder: getContinueRunPlaceholder(taskShell.title),
      statusHint: `${copy.currentRun}: ${currentRun.status}`,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "Failed" || currentRun.status === "Cancelled") {
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
  const { messages } = useI18n();
  const workPageMessages = messages.components?.workPage ?? {};
  const copy = {
    ...DEFAULT_COPY,
    ...workPageMessages,
    openSchedule: DEFAULT_COPY.openSchedule,
    viewTaskDetail: DEFAULT_COPY.viewTaskDetail,
    duePrefix: DEFAULT_COPY.duePrefix,
    workbenchTitle: DEFAULT_COPY.workbenchTitle,
    workbenchDescription: DEFAULT_COPY.workbenchDescription,
    workbenchStatus: DEFAULT_COPY.workbenchStatus,
    nextAction: DEFAULT_COPY.nextAction,
    whyNow: DEFAULT_COPY.whyNow,
    evidence: DEFAULT_COPY.evidence,
    taskArrangement: DEFAULT_COPY.taskArrangement,
    taskArrangementHint: DEFAULT_COPY.taskArrangementHint,
    conversationInput: DEFAULT_COPY.conversationInput,
    sendAndContinue: DEFAULT_COPY.sendAndContinue,
    sendNoteToAgent: DEFAULT_COPY.sendNoteToAgent,
    currentRun: DEFAULT_COPY.currentRun,
    approve: DEFAULT_COPY.approve,
    reject: DEFAULT_COPY.reject,
    editedInstruction: DEFAULT_COPY.editedInstruction,
    editAndApprove: DEFAULT_COPY.editAndApprove,
    retryRun: DEFAULT_COPY.retryRun,
    acceptResult: DEFAULT_COPY.acceptResult,
    markTaskDone: DEFAULT_COPY.markTaskDone,
    createFollowUp: DEFAULT_COPY.createFollowUp,
    followUpTitle: DEFAULT_COPY.followUpTitle,
    followUpDue: DEFAULT_COPY.followUpDue,
    reopenTask: DEFAULT_COPY.reopenTask,
    startRunHere: DEFAULT_COPY.startRunHere,
    noActiveRunYet: DEFAULT_COPY.noActiveRunYet,
    resultActionsTitle: DEFAULT_COPY.resultActionsTitle,
    sharedOutput: DEFAULT_COPY.sharedOutput,
    usedByNextAction: DEFAULT_COPY.usedByNextAction,
    updated: DEFAULT_COPY.updated,
    executionWorkstream: DEFAULT_COPY.executionWorkstream,
    workstream: DEFAULT_COPY.workstream,
    conversation: DEFAULT_COPY.conversation,
    latestExecutionMilestones: DEFAULT_COPY.latestExecutionMilestones,
    conversationEvidence: DEFAULT_COPY.conversationEvidence,
    keyboardHint: DEFAULT_COPY.keyboardHint,
    currentStage: DEFAULT_COPY.currentStage,
    sourceSchedule: DEFAULT_COPY.sourceSchedule,
    taskReadySummary: DEFAULT_COPY.taskReadySummary,
    taskRunningSummary: DEFAULT_COPY.taskRunningSummary,
    taskWaitingInputSummary: DEFAULT_COPY.taskWaitingInputSummary,
    taskWaitingApprovalSummary: DEFAULT_COPY.taskWaitingApprovalSummary,
    taskCompletedSummary: DEFAULT_COPY.taskCompletedSummary,
    taskFailedSummary: DEFAULT_COPY.taskFailedSummary,
    currentKeyDecision: DEFAULT_COPY.currentKeyDecision,
    collaborationFlow: DEFAULT_COPY.collaborationFlow,
    collaborationFlowDescription: DEFAULT_COPY.collaborationFlowDescription,
    latestResult: DEFAULT_COPY.latestResult,
    inputArea: DEFAULT_COPY.inputArea,
    allTasks: DEFAULT_COPY.allTasks,
    openInbox: DEFAULT_COPY.openInbox,
    openMemory: DEFAULT_COPY.openMemory,
    taskStages: DEFAULT_COPY.taskStages,
    taskLifecycle: DEFAULT_COPY.taskLifecycle,
    collaborationStage: DEFAULT_COPY.collaborationStage,
    lifecycleNotStarted: DEFAULT_COPY.lifecycleNotStarted,
    lifecycleInProgress: DEFAULT_COPY.lifecycleInProgress,
    lifecycleCompleted: DEFAULT_COPY.lifecycleCompleted,
    workbenchCrumb: DEFAULT_COPY.workbenchCrumb,
    decisionStatus: DEFAULT_COPY.decisionStatus,
    decisionPlan: DEFAULT_COPY.decisionPlan,
    decisionOptions: DEFAULT_COPY.decisionOptions,
    modifyBeforeStart: DEFAULT_COPY.modifyBeforeStart,
    adjustSchedule: DEFAULT_COPY.adjustSchedule,
    notNow: DEFAULT_COPY.notNow,
    resultEmptyTitle: DEFAULT_COPY.resultEmptyTitle,
    resultEmptyDescription: DEFAULT_COPY.resultEmptyDescription,
    resultPreviewTitle: DEFAULT_COPY.resultPreviewTitle,
    resultPreviewUnderstanding: DEFAULT_COPY.resultPreviewUnderstanding,
    resultPreviewPlan: DEFAULT_COPY.resultPreviewPlan,
    resultPreviewDraft: DEFAULT_COPY.resultPreviewDraft,
    resultPreviewQuestions: DEFAULT_COPY.resultPreviewQuestions,
    secondaryActions: DEFAULT_COPY.secondaryActions,
    decisionReminder: DEFAULT_COPY.decisionReminder,
  };
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const next = (await response.json()) as WorkPageClientProps["initialData"];
    startTransition(() => setData(next));
  }, [data.taskShell.id]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    try {
      setIsPending(true);
      setErrorMessage(null);
      await action();
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsPending(false);
    }
  }, [copy.actionFailed, refresh]);

  useEffect(() => {
    if (!data.currentRun) {
      return;
    }

    const intervalMs = Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun, refresh]);

  const currentRun = data.currentRun;
  const taskStatusMeta = getTaskStatusMeta(data);
  const phaseLabel = getCurrentPhaseLabel(currentRun, data.closure);
  const currentException = getCurrentException(data);
  const taskSummary = getTaskSummary(data, copy);
  const sourceSummary = getScheduleSourceSummary(data.taskShell, copy);
  const workbenchComposer = getWorkbenchComposer(
    currentRun,
    data.currentIntervention,
    data.taskShell,
    copy,
  );
  const currentPlanAction = getCurrentPlanAction(currentRun, data.taskPlan);
  const quickPrompts = getQuickPrompts(workbenchComposer, currentRun);
  const collaborationFeed = useMemo(() => buildConversationFeed(data), [data]);
  const collaborationStreamItems = collaborationFeed.map((item) => ({
    id: item.id,
    kind: item.kind,
    eyebrow: item.eyebrow,
    title: item.title,
    body: item.body,
    meta: item.meta,
  }));
  const [composerValue, setComposerValue] = useState(workbenchComposer.defaultValue);

  useEffect(() => {
    setComposerValue(workbenchComposer.defaultValue);
  }, [workbenchComposer.defaultValue, workbenchComposer.mode, currentRun?.id]);

  async function submitWorkbenchInput(inputText: string) {
    await runAction(async () => {
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
    });

    setComposerResetKey((value) => value + 1);
  }

  async function handleWorkbenchSubmit(formData: FormData) {
    const inputText = String(formData.get("message") ?? "").trim();

    if (!inputText) {
      throw new Error(copy.composerRequired);
    }

    await submitWorkbenchInput(inputText);
  }

  function handleGenerateTaskPlan() {
    void runAction(async () => {
      await generateTaskPlan({ taskId: data.taskShell.id });
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px] 2xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <div className="space-y-4 xl:order-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <LocalizedLink href="/schedule" className="font-medium text-foreground hover:underline">日程</LocalizedLink>
              <span>/</span>
              <span className="max-w-[260px] truncate">{data.taskShell.title}</span>
              <span>/</span>
              <span className="font-medium text-foreground">{copy.workbenchCrumb}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <LocalizedLink href="/tasks" className={buttonVariants({ variant: "outline", size: "sm" })}>{copy.allTasks}</LocalizedLink>
                <LocalizedLink href="/inbox" className={buttonVariants({ variant: "ghost", size: "sm" })}>{copy.openInbox}</LocalizedLink>
                <LocalizedLink href="/memory" className={buttonVariants({ variant: "ghost", size: "sm" })}>{copy.openMemory}</LocalizedLink>
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{data.taskShell.title}</h1>
                <p className="text-sm text-muted-foreground">{taskSummary}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <LocalizedLink href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>{copy.openSchedule}</LocalizedLink>
                <LocalizedLink href={`/workspaces/${data.taskShell.workspaceId}/tasks/${data.taskShell.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{copy.viewTaskDetail}</LocalizedLink>
              </div>
            </div>
          </div>

          <SurfaceCard variant="highlight">
            <SurfaceCardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SurfaceCardTitle>{copy.taskStages}</SurfaceCardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{sourceSummary}</span>
                  <span>{copy.duePrefix}: {formatDate(data.taskShell.dueAt)}</span>
                </div>
              </div>
            </SurfaceCardHeader>

            <div className={cn("mt-2 grid gap-3", currentException ? "md:grid-cols-3" : "md:grid-cols-2")}>
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium text-muted-foreground">任务状态</p>
                <div className="mt-2">
                  <StatusBadge tone={taskStatusMeta.tone}>{taskStatusMeta.label}</StatusBadge>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium text-muted-foreground">{copy.currentStage}</p>
                <p className="mt-2 text-sm font-medium text-foreground">{phaseLabel}</p>
              </div>

              {currentException ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <p className="text-xs font-medium text-amber-700">当前异常</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{currentException}</p>
                </div>
              ) : null}
            </div>
          </SurfaceCard>

        <CollaborationStream
          title={copy.collaborationFlow}
          description={copy.collaborationFlowDescription}
          emptyState={copy.fallbackNoOperatorInput}
          composerTitle={copy.inputArea}
          composerLabel={copy.taskArrangement}
          composerHint={workbenchComposer.description || copy.workbenchDescription}
          composerSectionId="current-key-decision"
          fixedHeightClassName="h-[760px]"
          items={collaborationStreamItems}
          composer={(
            <form
              key={`workbench-${composerResetKey}-${currentRun?.id ?? "none"}-${workbenchComposer.mode}`}
              action={handleWorkbenchSubmit}
              className="min-w-0 space-y-3"
            >
              {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
              <p className="text-xs text-muted-foreground">{copy.taskArrangementHint}</p>
              <textarea
                aria-label={workbenchComposer.inputLabel}
                name="message"
                rows={6}
                required
                value={composerValue}
                placeholder={workbenchComposer.placeholder}
                onChange={(event) => setComposerValue(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                className={cn(textareaClassName, "min-h-32 w-full min-w-0 resize-y")}
              />
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-wrap gap-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      onClick={() => setComposerValue((current) => (current.trim() ? `${current.trim()}\n${prompt}` : prompt))}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                  <p className="text-xs text-muted-foreground">{workbenchComposer.statusHint} · {copy.keyboardHint}</p>
                  <button
                    type="submit"
                    disabled={isPending}
                    className={buttonVariants({ variant: workbenchComposer.submitVariant ?? "default", size: "lg", className: "disabled:opacity-60" })}
                  >
                    {workbenchComposer.submitLabel}
                  </button>
                </div>
              </div>
            </form>
          )}
        />

        {(data.currentIntervention?.approvals ?? []).length > 0 ? (
          <SurfaceCard id="pending-approvals">
            <SurfaceCardHeader>
              <SurfaceCardTitle>待确认卡</SurfaceCardTitle>
            </SurfaceCardHeader>

            <div className="mt-3 space-y-4">
              {(data.currentIntervention?.approvals ?? []).map((approval) => (
                <div key={approval.id} className="rounded-2xl border border-amber-200/90 bg-amber-50/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{approval.title}</p>
                    <StatusBadge tone="warning">{approval.status}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{approval.summary ?? "Review the approval request before resuming the run."}</p>

                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <form
                        action={async () => {
                          await runAction(async () => {
                            await approveApproval(approval.id);
                          });
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
                          });
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
                        });
                      }}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <input type="hidden" name="approvalId" value={approval.id} />
                      <input
                        type="text"
                        name="editedContent"
                        placeholder={copy.editedInstruction}
                        className={cn(inputClassName, "min-w-0 w-full")}
                      />
                      <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                        {copy.editAndApprove}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </SurfaceCard>
        ) : null}

        <SurfaceCard id="latest-result">
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.latestResult}</SurfaceCardTitle>
          </SurfaceCardHeader>

          <div className="mt-3 rounded-2xl border border-sky-200/90 bg-sky-50/85 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">{data.latestOutput.empty ? copy.resultEmptyTitle : data.latestOutput.title}</p>
              {!data.latestOutput.empty && data.latestOutput.timestamp ? (
                <span className="text-xs text-muted-foreground">{copy.updated} {formatDateTime(data.latestOutput.timestamp)}</span>
              ) : null}
            </div>

            {data.latestOutput.empty ? (
              <div className="mt-3 text-sm text-muted-foreground">
                <p>{copy.resultEmptyDescription}</p>
                <div className="mt-3 rounded-2xl bg-card/70 p-3">
                  <p className="text-xs font-medium text-foreground">{copy.resultPreviewTitle}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>{copy.resultPreviewUnderstanding}</li>
                    <li>{copy.resultPreviewPlan}</li>
                    <li>{copy.resultPreviewDraft}</li>
                    <li>{copy.resultPreviewQuestions}</li>
                  </ul>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{data.latestOutput.body}</p>
              </div>
            ) : (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge>{data.latestOutput.sourceLabel}</StatusBadge>
                  {data.currentIntervention && data.currentIntervention.kind !== "observe" ? (
                    <StatusBadge tone="info">{copy.usedByNextAction}</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{data.latestOutput.body}</p>
              </div>
            )}

            {!data.latestOutput.empty ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.closure.canAcceptResult ? (
                  <form
                    action={async () => {
                      await runAction(async () => {
                        await acceptTaskResult({ taskId: data.taskShell.id });
                      });
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
                      });
                    }}
                  >
                    <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                      {copy.retryRun}
                    </button>
                  </form>
                ) : null}

                {data.latestOutput.href ? (
                  <a href={data.latestOutput.href} className={buttonVariants({ variant: "outline" })}>
                    {copy.openArtifact}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.executionWorkstream}</SurfaceCardTitle>
          </SurfaceCardHeader>

          <div className="mt-1 text-xs text-muted-foreground">{copy.executionWorkstreamDescription}</div>
          <div className="mt-4">
            <ExecutionTimeline title={copy.latestExecutionMilestones} events={data.workstreamItems} />
          </div>
        </SurfaceCard>

        </div>

        <div className="xl:order-1 xl:sticky xl:top-4 xl:self-start">
          <RunSidePanel
            taskShell={data.taskShell}
            scheduleImpact={data.scheduleImpact}
            currentRun={currentRun}
            reliability={data.reliability}
            approvals={data.inspector.approvals}
            artifacts={data.inspector.artifacts}
            toolCalls={data.inspector.toolCalls}
          />
        </div>

        <div className="xl:order-3 xl:sticky xl:top-4 xl:self-start">
          <TaskPlanSidePanel
            plan={data.taskPlan}
            isPending={isPending}
            onGenerate={handleGenerateTaskPlan}
            currentAction={currentPlanAction}
            currentException={currentException}
          />
        </div>
      </div>
    </div>
  );
}
