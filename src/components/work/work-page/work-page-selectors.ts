import type {
  CollaborationFeedItem,
  WorkbenchComposer,
  WorkbenchCopy,
  WorkPageClientProps,
} from "./work-page-types";
import {
  formatDateTime,
  getRunStatusLabel,
  isOverdueScheduleStatus,
} from "./work-page-formatters";
export function getTaskSummary(
  data: WorkPageClientProps["initialData"],
  copy: WorkbenchCopy,
) {
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

export function getTaskStatusMeta(
  data: WorkPageClientProps["initialData"],
  copy: WorkbenchCopy,
) {
  if (data.closure.isDone) {
    return { label: "已完成", tone: "success" as const };
  }

  if (!data.currentRun) {
    return { label: "待开始", tone: "neutral" as const };
  }

  if (
    data.currentRun.status === "Failed" ||
    data.currentRun.status === "Cancelled"
  ) {
    return { label: "已中断", tone: "critical" as const };
  }

  if (data.currentRun.status === "Completed") {
    return { label: copy.taskAwaitingReviewLabel, tone: "warning" as const };
  }

  return { label: "进行中", tone: "info" as const };
}

export function getCurrentException(data: WorkPageClientProps["initialData"]) {
  if (data.reliability.isStale) {
    return "同步异常，等待恢复";
  }

  switch (data.currentRun?.status) {
    case "WaitingForApproval":
      return data.taskShell.blockReason?.actionRequired ?? "等待审批";
    case "WaitingForInput":
      return (
        data.currentRun.pendingInputPrompt ??
        data.taskShell.blockReason?.actionRequired ??
        "等待补充说明"
      );
    case "Failed":
    case "Cancelled":
      return (
        data.reliability.stopReason ??
        data.taskShell.blockReason?.actionRequired ??
        "执行已中断，等待恢复"
      );
    default:
      return isOverdueScheduleStatus(data.scheduleImpact.status)
        ? "已超出原计划时间窗"
        : null;
  }
}

export function getQuickPrompts(
  workbenchComposer: WorkbenchComposer,
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  currentIntervention?: WorkPageClientProps["initialData"]["currentIntervention"] | null,
) {
  switch (currentIntervention?.kind) {
    case "input":
      return ["直接回答缺失信息", "先说明不可变约束", "如果有假设请标出来"];
    case "approval":
      return ["解释为什么这样做", "给出更安全的替代方案", "总结审批后的下一步"];
    case "retry":
      return ["先定位失败原因", "给出恢复方案", "缩小这轮变更范围"];
    case "review":
      return ["先总结这轮产出", "指出仍未覆盖的风险", "给出建议的下一步"];
    case "observe":
      return ["只补充必要背景", "保持输出简洁", "发现风险就重点提示"];
    default:
      break;
  }

  if (workbenchComposer.mode === "start") {
    return ["先给出简洁计划", "明确关键假设", "先提出澄清问题"];
  }
  if (currentRun?.status === "Running") {
    return ["只补充必要背景", "保持输出简洁", "发现风险就重点提示"];
  }
  if (currentRun?.status === "WaitingForApproval") {
    return ["解释当前阻塞", "给出更安全的改法", "总结接下来的步骤"];
  }
  return ["基于最新结果继续", "收紧下一步动作", "记录这次决策"];
}

export function getCurrentPlanAction(
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
export function buildConversationFeed(
  data: WorkPageClientProps["initialData"],
  copy: WorkbenchCopy,
): CollaborationFeedItem[] {
  return [...data.conversation]
    .sort((a, b) => (a.runtimeTs ?? "").localeCompare(b.runtimeTs ?? ""))
    .map((entry) => {
      const isAgent =
        entry.role.toLowerCase().includes("agent") ||
        entry.role.toLowerCase().includes("assistant");
      const kind: CollaborationFeedItem["kind"] = isAgent ? "agent" : "user";

      return {
        id: entry.id,
        kind,
        eyebrow: isAgent ? copy.agentLabel : "你",
        title: "",
        body: entry.content,
        meta: entry.runtimeTs ? formatDateTime(entry.runtimeTs) : null,
      };
    });
}

export function getScheduleSourceSummary(
  taskShell: WorkPageClientProps["initialData"]["taskShell"],
  copy: WorkbenchCopy,
) {
  if (taskShell.scheduledStartAt && taskShell.scheduledEndAt) {
    return `${copy.sourceSchedule}: ${formatDateTime(taskShell.scheduledStartAt)} → ${formatDateTime(taskShell.scheduledEndAt)}`;
  }

  return `${copy.sourceSchedule}: ${copy.noScheduleWindow}`;
}

export function getComposerDefaultValue(
  taskTitle: string,
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
) {
  return currentRun?.pendingInputPrompt ?? `继续处理：${taskTitle}`;
}

export function getStartRunDefaultValue(taskTitle: string) {
  return `继续处理：${taskTitle}`;
}

export function getFollowUpDefaultTitle(
  taskTitle: string,
  copy: WorkbenchCopy,
) {
  return `${taskTitle} - ${copy.followUpDefaultSuffix}`;
}

export function getPassiveHeroGuidance(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  closure: WorkPageClientProps["initialData"]["closure"],
  copy: WorkbenchCopy,
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

export function getWorkbenchComposer(
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
      defaultValue:
        taskShell.prompt ?? getStartRunDefaultValue(taskShell.title),
      statusHint: copy.noActiveRunYet,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "WaitingForInput") {
    return {
      mode: "response",
      description:
        currentIntervention?.description ?? copy.responseRequiredDescription,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.sendAndContinue,
      defaultValue:
        currentIntervention?.defaultMessage ??
        getComposerDefaultValue(taskShell.title, currentRun),
      statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)}`,
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
      statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)} · ${copy.noteQueuedForCheckpoint}`,
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
      statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)} · ${copy.noteQueuedForCheckpoint}`,
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
      defaultValue:
        taskShell.prompt ?? getStartRunDefaultValue(taskShell.title),
      statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)}`,
      submitVariant: "default",
    };
  }

  if (currentRun.status === "Failed" || currentRun.status === "Cancelled") {
    if (!closure.canRetry) {
      return null;
    }

    return {
      mode: "retry",
      description:
        currentIntervention?.description ?? copy.workbenchDescription,
      inputLabel: copy.taskArrangement,
      submitLabel: copy.retryRun,
      defaultValue: taskShell.prompt ?? `恢复任务：${taskShell.title}`,
      statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)}`,
      submitVariant: "default",
    };
  }

  return {
    mode: "note",
    description: currentIntervention?.description ?? copy.workbenchDescription,
    inputLabel: copy.conversationInput,
    submitLabel: copy.sendNoteToAgent,
    defaultValue: "",
    statusHint: `${copy.currentRun}: ${getRunStatusLabel(currentRun.status)}`,
    submitVariant: "outline",
  };
}
