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
    return { label: copy.statusCompleted, tone: "success" as const };
  }

  if (!data.currentRun) {
    return { label: copy.statusNotStarted, tone: "neutral" as const };
  }

  if (
    data.currentRun.status === "Failed" ||
    data.currentRun.status === "Cancelled"
  ) {
    return { label: copy.statusInterrupted, tone: "critical" as const };
  }

  if (data.currentRun.status === "Completed") {
    return { label: copy.taskAwaitingReviewLabel, tone: "warning" as const };
  }

  return { label: copy.statusInProgress, tone: "info" as const };
}

export function getCurrentException(data: WorkPageClientProps["initialData"], copy: WorkbenchCopy) {
  if (data.reliability.isStale) {
    return copy.syncException;
  }

  switch (data.currentRun?.status) {
    case "WaitingForApproval":
      return data.taskShell.blockReason?.actionRequired ?? copy.waitingForApproval;
    case "WaitingForInput":
      return (
        data.currentRun.pendingInputPrompt ??
        data.taskShell.blockReason?.actionRequired ??
        copy.waitingForInput
      );
    case "Failed":
    case "Cancelled":
      return (
        data.reliability.stopReason ??
        data.taskShell.blockReason?.actionRequired ??
        copy.executionInterrupted
      );
    default:
      return isOverdueScheduleStatus(data.scheduleImpact.status)
        ? copy.overdueSchedule
        : null;
  }
}

export function getQuickPrompts(
  workbenchComposer: WorkbenchComposer,
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  currentIntervention?: WorkPageClientProps["initialData"]["currentIntervention"] | null,
  copy?: WorkbenchCopy,
) {
  switch (currentIntervention?.kind) {
    case "input":
      return [copy?.quickPromptInputA ?? "Answer the missing information directly", copy?.quickPromptInputB ?? "State immutable constraints first", copy?.quickPromptInputC ?? "Flag any assumptions"];
    case "approval":
      return [copy?.quickPromptApprovalA ?? "Explain why this approach", copy?.quickPromptApprovalB ?? "Suggest a safer alternative", copy?.quickPromptApprovalC ?? "Summarize next steps after approval"];
    case "retry":
      return [copy?.quickPromptRetryA ?? "Identify the failure cause first", copy?.quickPromptRetryB ?? "Propose a recovery plan", copy?.quickPromptRetryC ?? "Narrow the scope of this change"];
    case "review":
      return [copy?.quickPromptReviewA ?? "Summarize this round's output first", copy?.quickPromptReviewB ?? "Point out uncovered risks", copy?.quickPromptReviewC ?? "Suggest next steps"];
    case "observe":
      return [copy?.quickPromptObserveA ?? "Only add essential context", copy?.quickPromptObserveB ?? "Keep output concise", copy?.quickPromptObserveC ?? "Highlight any risks found"];
    default:
      break;
  }

  if (workbenchComposer.mode === "start") {
    return [copy?.quickPromptStartA ?? "Give a concise plan first", copy?.quickPromptStartB ?? "State key assumptions", copy?.quickPromptStartC ?? "Ask clarifying questions first"];
  }
  if (currentRun?.status === "Running") {
    return [copy?.quickPromptRunningA ?? "Only add essential context", copy?.quickPromptRunningB ?? "Keep output concise", copy?.quickPromptRunningC ?? "Highlight any risks found"];
  }
  if (currentRun?.status === "WaitingForApproval") {
    return [copy?.quickPromptWaitingApprovalA ?? "Explain the current blocker", copy?.quickPromptWaitingApprovalB ?? "Suggest a safer change", copy?.quickPromptWaitingApprovalC ?? "Summarize the next steps"];
  }
  return [copy?.quickPromptDefaultA ?? "Continue based on latest results", copy?.quickPromptDefaultB ?? "Tighten the next action", copy?.quickPromptDefaultC ?? "Record this decision"];
}

export function getCurrentPlanAction(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  taskPlan: WorkPageClientProps["initialData"]["taskPlan"],
  copy?: WorkbenchCopy,
) {
  if (taskPlan.state !== "ready" || !taskPlan.currentStepId) {
    return null;
  }

  if (!currentRun) {
    return { label: copy?.planActionStart ?? "Start from this step", href: "#next-action-hero" };
  }

  switch (currentRun.status) {
    case "WaitingForApproval":
      return { label: copy?.planActionApproval ?? "Handle current approval", href: "#next-action-hero" };
    case "WaitingForInput":
      return { label: copy?.planActionInput ?? "Continue after providing input", href: "#next-action-hero" };
    case "Running":
      return { label: copy?.planActionRunning ?? "View current progress", href: "#execution-stream" };
    case "Completed":
      return { label: copy?.planActionCompleted ?? "Confirm result", href: "#latest-result" };
    case "Failed":
    case "Cancelled":
      return { label: copy?.planActionRecover ?? "Recover from this step", href: "#next-action-hero" };
    default:
      return { label: copy?.planActionDefault ?? "View current action", href: "#next-action-hero" };
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
        eyebrow: isAgent ? copy.agentLabel : copy.userLabel,
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
  copy?: WorkbenchCopy,
) {
  const prefix = copy?.continueProcessingPrefix ?? "Continue: ";
  return currentRun?.pendingInputPrompt ?? `${prefix}${taskTitle}`;
}

export function getStartRunDefaultValue(taskTitle: string, copy?: WorkbenchCopy) {
  const prefix = copy?.continueProcessingPrefix ?? "Continue: ";
  return `${prefix}${taskTitle}`;
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
        taskShell.prompt ?? getStartRunDefaultValue(taskShell.title, copy),
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
        getComposerDefaultValue(taskShell.title, currentRun, copy),
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
        taskShell.prompt ?? getStartRunDefaultValue(taskShell.title, copy),
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
      defaultValue: taskShell.prompt ?? `${copy.recoverTaskPrefix}${taskShell.title}`,
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
