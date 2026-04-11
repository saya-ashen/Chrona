"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import {
  acceptTaskResult,
  approveApproval,
  createFollowUpTask,
  editAndApproveApproval,
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
import { Field, inputClassName, textareaClassName } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { ConversationPanel } from "@/components/work/conversation-panel";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { RunSidePanel } from "@/components/work/run-side-panel";
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

type WorkstreamTab = "workstream" | "conversation";

type CollaborationComposer = {
  mode: "response" | "note";
  title: string;
  description: string;
  fieldLabel: string;
  submitLabel: string;
  defaultValue: string;
  statusHint: string;
};

type CollaborationCopy = {
  collaboration: string;
  responseRequiredDescription: string;
  agentMessage: string;
  sendToAgent: string;
  currentRun: string;
  operatorNote: string;
  sendNoteToAgent: string;
  noteQueuedForCheckpoint: string;
  noteWhileRunningDescription: string;
  noteWhileAwaitingApprovalDescription: string;
};

const DEFAULT_COPY = {
  pageDescription: "Keep execution moving here, keep planning edits in Schedule, and treat task detail as reference-only.",
  openSchedule: "Open Schedule",
  viewTaskDetail: "View task detail",
  runPrefix: "Run",
  noRun: "No run",
  duePrefix: "Due",
  interventionFocus: "Intervention focus",
  noBlockingAction: "No blocking action recorded.",
  plannedWindow: "Planned window",
  reliability: "Reliability",
  lastRefresh: "Last refresh",
  lastSync: "Last sync",
  stopReason: "Stop reason",
  stuckFor: "Stuck for",
  staleSync: "Sync stale",
  healthySync: "Sync healthy",
  nextAction: "Next Action",
  whyNow: "Why now",
  evidence: "Evidence",
  collaboration: "Collaboration",
  agentMessage: "Agent message",
  operatorNote: "Operator note",
  sendToAgent: "Send to Agent",
  sendNoteToAgent: "Send Note to Agent",
  resumeWithMessage: "Resume with Message",
  currentRun: "Current run",
  approve: "Approve",
  reject: "Reject",
  editedInstruction: "Edited instruction",
  editAndApprove: "Edit and Approve",
  retryPrompt: "Retry prompt",
  retryRun: "Retry Run",
  acceptResult: "Accept Result",
  markTaskDone: "Mark Task Done",
  createFollowUp: "Create Follow-up",
  followUpTitle: "Follow-up title",
  followUpDue: "Follow-up due date",
  reopenTask: "Re-open Task",
  latestFollowUp: "Latest follow-up",
  resultAccepted: "Result accepted",
  taskDone: "Task done",
  startRunDescription: "Start the first run here so the workbench becomes the live execution surface instead of a dead end.",
  runPrompt: "Run prompt",
  startRunHere: "Start Run Here",
  noActiveRunYet: "No active run yet",
  fallbackNoOperatorInput: "The run does not currently require operator input. Review the output and inspector state below.",
  fallbackStartFromTaskPage: "Start a run from the task page before sending agent instructions here.",
  sharedOutput: "Shared Output",
  sharedOutputDescription: "The latest useful result from this run should be visible without digging through logs.",
  usedByNextAction: "Used by next action",
  updated: "Updated",
  openArtifact: "Open artifact",
  executionWorkstream: "Execution Workstream",
  executionWorkstreamDescription: "Use the workstream by default, then switch to conversation only when you need deeper narrative evidence.",
  workstream: "Workstream",
  conversation: "Conversation",
  latestExecutionMilestones: "Latest execution milestones",
  conversationEvidence: "Conversation evidence",
  conversationEvidenceDescription: "Use the conversation view when the workstream summary is not enough.",
  messageRequired: "message is required",
  noteQueuedForCheckpoint: "Delivered to the runtime and shown again once the next sync lands.",
  responseRequiredDescription: "Reply directly to the agent so the blocked run can continue.",
  noteWhileRunningDescription: "Add context for the agent without interrupting the current run. The note will land at the next safe checkpoint.",
  noteWhileAwaitingApprovalDescription: "Leave context for the agent while the approval stays pending. The run will still wait for approval before continuing.",
  promptRequired: "prompt is required",
  noActiveRunToResume: "No active run to resume.",
  currentRunCannotAcceptMessages: "The current run is not accepting operator messages.",
  actionFailed: "Action failed",
} as const;

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function getNextActionLabel(status: string | null | undefined) {
  switch (status) {
    case "WaitingForInput":
      return "Provide Input";
    case "WaitingForApproval":
      return "Resolve Approval";
    case "Failed":
      return "Recover Run";
    case "Completed":
      return "Review Result";
    case "Running":
      return "Observe Progress";
    default:
      return "Start Execution";
  }
}

function getComposerDefaultValue(taskTitle: string, currentRun: WorkPageClientProps["initialData"]["currentRun"]) {
  return currentRun?.pendingInputPrompt ?? `Continue work on ${taskTitle}`;
}

function getStartRunDefaultValue(taskTitle: string) {
  return `Continue working on: ${taskTitle}`;
}

function getEvidenceToneClass(tone: "neutral" | "warning" | "critical") {
  if (tone === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-border bg-background text-muted-foreground";
}

function getCollaborationComposer(
  currentRun: WorkPageClientProps["initialData"]["currentRun"],
  currentIntervention: WorkPageClientProps["initialData"]["currentIntervention"],
  taskTitle: string,
  copy: CollaborationCopy,
): CollaborationComposer | null {
  if (!currentRun) {
    return null;
  }

  if (currentRun.status === "WaitingForInput") {
    return {
      mode: "response",
      title: copy.collaboration,
      description: currentIntervention?.description ?? copy.responseRequiredDescription,
      fieldLabel: copy.agentMessage,
      submitLabel: copy.sendToAgent,
      defaultValue: currentIntervention?.defaultMessage ?? getComposerDefaultValue(taskTitle, currentRun),
      statusHint: `${copy.currentRun}: ${currentRun.status}`,
    };
  }

  if (currentRun.status === "Running") {
    return {
      mode: "note",
      title: copy.collaboration,
      description: copy.noteWhileRunningDescription,
      fieldLabel: copy.operatorNote,
      submitLabel: copy.sendNoteToAgent,
      defaultValue: "",
      statusHint: `${copy.currentRun}: ${currentRun.status} · ${copy.noteQueuedForCheckpoint}`,
    };
  }

  if (currentRun.status === "WaitingForApproval") {
    return {
      mode: "note",
      title: copy.collaboration,
      description: copy.noteWhileAwaitingApprovalDescription,
      fieldLabel: copy.operatorNote,
      submitLabel: copy.sendNoteToAgent,
      defaultValue: "",
      statusHint: `${copy.currentRun}: ${currentRun.status} · ${copy.noteQueuedForCheckpoint}`,
    };
  }

  return null;
}

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.workPage ?? {}) };
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkstreamTab>("workstream");
  const [composerResetKey, setComposerResetKey] = useState(0);

  const refresh = useEffectEvent(async () => {
    const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const next = (await response.json()) as WorkPageClientProps["initialData"];
    startTransition(() => setData(next));
  });

  const runAction = useEffectEvent(async (action: () => Promise<void>) => {
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
  });

  useEffect(() => {
    if (!data.currentRun) {
      return;
    }

    const intervalMs = Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun]);

  const currentRun = data.currentRun;
  const canProvideInput = data.currentIntervention?.kind === "input";
  const hasPendingApprovals = data.currentIntervention?.kind === "approval" && (data.currentIntervention.approvals?.length ?? 0) > 0;
  const canRetryRecovery = currentRun ? ["Failed", "Cancelled"].includes(currentRun.status) : false;
  const collaborationComposer = getCollaborationComposer(
    currentRun,
    data.currentIntervention,
    data.taskShell.title,
    copy,
  );

  async function submitAgentMessage(inputText: string) {
    if (!currentRun) {
      throw new Error(copy.noActiveRunToResume);
    }

    await runAction(async () => {
      if (currentRun.status === "WaitingForInput") {
        await provideInput({ runId: currentRun.id, inputText });
        return;
      }

      if (currentRun.status === "Running" || currentRun.status === "WaitingForApproval") {
        await sendOperatorMessage({ runId: currentRun.id, message: inputText });
        return;
      }

      throw new Error(copy.currentRunCannotAcceptMessages);
    });

    setComposerResetKey((value) => value + 1);
  }

  async function handleComposerSubmit(formData: FormData) {
    const inputText = String(formData.get("message") ?? "").trim();

    if (!inputText) {
      throw new Error(copy.messageRequired);
    }

    await submitAgentMessage(inputText);
  }

  async function handleStartRunSubmit(formData: FormData) {
    const prompt = String(formData.get("prompt") ?? "").trim();

    if (!prompt) {
      throw new Error(copy.promptRequired);
    }

    await runAction(async () => {
      await startRun({ taskId: data.taskShell.id, prompt });
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <SurfaceCard className="sticky top-4 z-10" variant="highlight">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{data.taskShell.title}</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {copy.pageDescription}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <LocalizedLink href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {copy.openSchedule}
              </LocalizedLink>
              <LocalizedLink
                href={`/workspaces/${data.taskShell.workspaceId}/tasks/${data.taskShell.id}`}
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {copy.viewTaskDetail}
              </LocalizedLink>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone="info">{currentRun?.status ?? data.taskShell.status}</StatusBadge>
            <StatusBadge>{data.scheduleImpact.status}</StatusBadge>
            <StatusBadge>{data.taskShell.priority}</StatusBadge>
            <StatusBadge>{copy.duePrefix} {formatDate(data.taskShell.dueAt)}</StatusBadge>
            <StatusBadge>{data.reliability.isStale ? copy.staleSync : copy.healthySync}</StatusBadge>
            {data.closure.resultAccepted ? <StatusBadge>{copy.resultAccepted}</StatusBadge> : null}
            {data.closure.isDone ? <StatusBadge>{copy.taskDone}</StatusBadge> : null}
          </div>

          <div className="mt-4 grid gap-2 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground sm:grid-cols-3">
            <div>
              <p className="font-medium text-foreground">{copy.interventionFocus}</p>
              <p>{data.taskShell.blockReason?.actionRequired ?? copy.noBlockingAction}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">{copy.plannedWindow}</p>
              <p>
                {formatDate(data.scheduleImpact.scheduledStartAt)} to {formatDate(data.scheduleImpact.scheduledEndAt)}
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">{copy.reliability}</p>
              <p>{copy.lastRefresh}: {formatDateTime(data.reliability.refreshedAt)}</p>
              <p>{copy.lastSync}: {formatDateTime(data.reliability.lastSyncedAt ?? data.reliability.lastUpdatedAt)}</p>
              {data.reliability.stuckFor ? <p>{copy.stuckFor}: {data.reliability.stuckFor}</p> : null}
              {data.reliability.stopReason ? <p>{copy.stopReason}: {data.reliability.stopReason}</p> : null}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.nextAction}</SurfaceCardTitle>
            <SurfaceCardDescription>
              {data.currentIntervention?.title ?? getNextActionLabel(currentRun?.status)} — make the next intervention obvious and keep everything else secondary.
            </SurfaceCardDescription>
          </SurfaceCardHeader>

          <div className="mt-3 space-y-3">
            {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

            {data.currentIntervention ? (
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.whyNow}</p>
                <p className="mt-2">{data.currentIntervention.whyNow}</p>

                {data.currentIntervention.evidence.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.evidence}</p>
                    <div className="flex flex-wrap gap-2">
                      {data.currentIntervention.evidence.map((item) => {
                        const content = (
                          <>
                            <span className="font-medium">{item.label}</span>
                            <span className="line-clamp-1">{item.value}</span>
                          </>
                        );

                        if (item.href) {
                          return (
                            <a
                              key={`${item.label}-${item.value}`}
                              href={item.href}
                              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${getEvidenceToneClass(item.tone)}`}
                            >
                              {content}
                            </a>
                          );
                        }

                        return (
                          <span
                            key={`${item.label}-${item.value}`}
                            className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${getEvidenceToneClass(item.tone)}`}
                          >
                            {content}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {canProvideInput ? (
              <form
                key={`collaboration-${composerResetKey}-${currentRun?.id ?? "none"}-response`}
                action={handleComposerSubmit}
                className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{collaborationComposer?.title ?? copy.collaboration}</p>
                  <p className="text-sm text-muted-foreground">{collaborationComposer?.description ?? data.currentIntervention?.description}</p>
                </div>
                <Field label={collaborationComposer?.fieldLabel ?? copy.agentMessage}>
                  <textarea
                    name="message"
                    rows={5}
                    required
                    defaultValue={collaborationComposer?.defaultValue ?? getComposerDefaultValue(data.taskShell.title, currentRun)}
                    className={textareaClassName}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isPending}
                    className={buttonVariants({ variant: "default", size: "lg", className: "disabled:opacity-60" })}
                  >
                    {collaborationComposer?.submitLabel ?? copy.resumeWithMessage}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {collaborationComposer?.statusHint ?? `${copy.currentRun}: ${currentRun?.status ?? copy.noRun}`}
                  </p>
                </div>
              </form>
            ) : hasPendingApprovals ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{data.currentIntervention?.description}</p>
                {(data.currentIntervention?.approvals ?? []).map((approval) => (
                  <div key={approval.id} className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{approval.title}</p>
                      <p>{approval.summary ?? "Review the approval request before resuming the run."}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
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
                      <form
                        action={async (formData) => {
                          await runAction(async () => {
                            await editAndApproveApproval(formData);
                          });
                        }}
                        className="flex flex-wrap gap-2"
                      >
                        <input type="hidden" name="approvalId" value={approval.id} />
                        <input
                          type="text"
                          name="editedContent"
                          placeholder={copy.editedInstruction}
                          className={cn(inputClassName, "min-w-48")}
                        />
                        <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                          {copy.editAndApprove}
                        </button>
                      </form>
                    </div>
                  </div>
                ))}

                {collaborationComposer?.mode === "note" ? (
                  <form
                    key={`collaboration-${composerResetKey}-${currentRun?.id ?? "none"}-note-approval`}
                    action={handleComposerSubmit}
                    className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{collaborationComposer.title}</p>
                      <p className="text-sm text-muted-foreground">{collaborationComposer.description}</p>
                    </div>
                    <Field label={collaborationComposer.fieldLabel}>
                      <textarea
                        name="message"
                        rows={4}
                        required
                        defaultValue={collaborationComposer.defaultValue}
                        className={textareaClassName}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}
                      >
                        {collaborationComposer.submitLabel}
                      </button>
                      <p className="text-xs text-muted-foreground">{collaborationComposer.statusHint}</p>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : canRetryRecovery ? (
              <form
                action={async (formData) => {
                  const prompt = String(formData.get("prompt") ?? "").trim();
                  if (!prompt) {
                    throw new Error("retry prompt is required");
                  }

                  await runAction(async () => {
                    await retryRun({ taskId: data.taskShell.id, prompt });
                  });
                }}
                className="space-y-3"
              >
                <p className="text-sm text-muted-foreground">{data.currentIntervention?.description}</p>
                <Field label={copy.retryPrompt}>
                  <textarea
                    name="prompt"
                    rows={5}
                    required
                    defaultValue={data.taskShell.prompt ?? `Retry task: ${data.taskShell.title}`}
                    className={textareaClassName}
                  />
                </Field>
                <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", size: "lg", className: "disabled:opacity-60" })}>
                  {copy.retryRun}
                </button>
              </form>
            ) : currentRun?.status === "Running" ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-sm text-muted-foreground">
                  {data.currentIntervention?.description}
                </div>

                {collaborationComposer?.mode === "note" ? (
                  <form
                    key={`collaboration-${composerResetKey}-${currentRun.id}-note-running`}
                    action={handleComposerSubmit}
                    className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{collaborationComposer.title}</p>
                      <p className="text-sm text-muted-foreground">{collaborationComposer.description}</p>
                    </div>
                    <Field label={collaborationComposer.fieldLabel}>
                      <textarea
                        name="message"
                        rows={4}
                        required
                        defaultValue={collaborationComposer.defaultValue}
                        className={textareaClassName}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}
                      >
                        {collaborationComposer.submitLabel}
                      </button>
                      <p className="text-xs text-muted-foreground">{collaborationComposer.statusHint}</p>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : currentRun?.status === "Completed" ? (
              <div className="space-y-4 rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-sm text-muted-foreground">
                <p>{data.currentIntervention?.description}</p>

                <div className="flex flex-wrap gap-2 text-xs">
                  {data.closure.resultAccepted && data.closure.acceptedAt ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                      {copy.resultAccepted} · {formatDateTime(data.closure.acceptedAt)}
                    </span>
                  ) : null}
                  {data.closure.isDone && data.closure.doneAt ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">
                      {copy.taskDone} · {formatDateTime(data.closure.doneAt)}
                    </span>
                  ) : null}
                  {data.closure.latestFollowUp ? (
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                      {copy.latestFollowUp} · {data.closure.latestFollowUp.title}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {data.closure.canAcceptResult ? (
                    <form
                      action={async () => {
                        await runAction(async () => {
                          await acceptTaskResult({ taskId: data.taskShell.id });
                        });
                      }}
                    >
                      <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                        {copy.acceptResult}
                      </button>
                    </form>
                  ) : null}

                  {data.closure.canMarkDone ? (
                    <form
                      action={async () => {
                        await runAction(async () => {
                          await markTaskDone({ taskId: data.taskShell.id });
                        });
                      }}
                    >
                      <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", className: "disabled:opacity-60" })}>
                        {copy.markTaskDone}
                      </button>
                    </form>
                  ) : null}

                  {data.closure.canReopen ? (
                    <form
                      action={async () => {
                        await runAction(async () => {
                          await reopenTask({ taskId: data.taskShell.id });
                        });
                      }}
                    >
                      <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                        {copy.reopenTask}
                      </button>
                    </form>
                  ) : null}
                </div>

                {data.closure.canCreateFollowUp ? (
                  <form
                    action={async (formData) => {
                      const title = String(formData.get("title") ?? "").trim();
                      const dueAtValue = String(formData.get("dueAt") ?? "").trim();

                      if (!title) {
                        throw new Error("title is required");
                      }

                      await runAction(async () => {
                        await createFollowUpTask({
                          taskId: data.taskShell.id,
                          title,
                          dueAt: dueAtValue ? new Date(`${dueAtValue}T00:00:00.000Z`) : null,
                        });
                      });
                    }}
                    className="grid gap-3 rounded-2xl border border-border/60 bg-background p-4 md:grid-cols-[minmax(0,1fr)_180px_auto]"
                  >
                    <Field label={copy.followUpTitle}>
                      <input
                        type="text"
                        name="title"
                        required
                        defaultValue={`Follow up: ${data.taskShell.title}`}
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={copy.followUpDue}>
                      <input type="date" name="dueAt" className={inputClassName} />
                    </Field>
                    <div className="flex items-end">
                      <button type="submit" disabled={isPending} className={buttonVariants({ variant: "secondary", className: "w-full disabled:opacity-60" })}>
                        {copy.createFollowUp}
                      </button>
                    </div>
                  </form>
                ) : null}

                {!data.closure.canReopen && data.closure.canRetry ? (
                  <form
                    action={async (formData) => {
                      const prompt = String(formData.get("prompt") ?? "").trim();
                      if (!prompt) {
                        throw new Error("retry prompt is required");
                      }

                      await runAction(async () => {
                        await retryRun({ taskId: data.taskShell.id, prompt });
                      });
                    }}
                    className="space-y-3"
                  >
                    <Field label={copy.retryPrompt}>
                      <textarea
                        name="prompt"
                        rows={4}
                        required
                        defaultValue={data.taskShell.prompt ?? `Retry task: ${data.taskShell.title}`}
                        className={textareaClassName}
                      />
                    </Field>
                    <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline", className: "disabled:opacity-60" })}>
                      {copy.retryRun}
                    </button>
                  </form>
                ) : null}
              </div>
            ) : !currentRun ? (
              <form action={handleStartRunSubmit} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {copy.startRunDescription}
                </p>
                <Field label={copy.runPrompt}>
                  <textarea
                    name="prompt"
                    rows={5}
                    required
                    defaultValue={data.taskShell.prompt ?? getStartRunDefaultValue(data.taskShell.title)}
                    className={textareaClassName}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default", size: "lg", className: "disabled:opacity-60" })}>
                    {copy.startRunHere}
                  </button>
                  <p className="text-xs text-muted-foreground">{copy.noActiveRunYet}</p>
                </div>
              </form>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-sm text-muted-foreground">
                {currentRun
                  ? data.currentIntervention?.description ?? copy.fallbackNoOperatorInput
                  : copy.fallbackStartFromTaskPage}
              </div>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.sharedOutput}</SurfaceCardTitle>
            <SurfaceCardDescription>{copy.sharedOutputDescription}</SurfaceCardDescription>
          </SurfaceCardHeader>

          {!data.latestOutput.empty ? (
            <div className="mt-3 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge>{data.latestOutput.sourceLabel}</StatusBadge>
                  {data.currentIntervention && data.currentIntervention.kind !== "observe" ? (
                    <StatusBadge tone="info">{copy.usedByNextAction}</StatusBadge>
                  ) : null}
                  {data.latestOutput.timestamp ? <span>{copy.updated} {formatDateTime(data.latestOutput.timestamp)}</span> : null}
                </div>
              <p className="mt-3 font-medium text-foreground">{data.latestOutput.title}</p>
              <p className="mt-2 whitespace-pre-wrap">{data.latestOutput.body}</p>
              {data.latestOutput.href ? (
                <a href={data.latestOutput.href} className="mt-2 inline-flex text-sm text-primary hover:underline">
                  {copy.openArtifact}
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
              {data.latestOutput.body}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>{copy.executionWorkstream}</SurfaceCardTitle>
            <SurfaceCardDescription>{copy.executionWorkstreamDescription}</SurfaceCardDescription>
          </SurfaceCardHeader>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("workstream")}
              className={cn(
                buttonVariants({ variant: activeTab === "workstream" ? "secondary" : "outline", size: "sm" }),
                "rounded-full",
              )}
            >
              {copy.workstream}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("conversation")}
              className={cn(
                buttonVariants({ variant: activeTab === "conversation" ? "secondary" : "outline", size: "sm" }),
                "rounded-full",
              )}
            >
              {copy.conversation}
            </button>
          </div>

          <div className="mt-4">
            {activeTab === "workstream" ? (
               <ExecutionTimeline title={copy.latestExecutionMilestones} events={data.workstreamItems} />
             ) : (
               <ConversationPanel
                 embedded
                 title={copy.conversationEvidence}
                 description={copy.conversationEvidenceDescription}
                 entries={data.conversation}
               />
            )}
          </div>
        </SurfaceCard>
      </div>

      <RunSidePanel
        currentRun={currentRun}
        reliability={data.reliability}
        approvals={data.inspector.approvals}
        artifacts={data.inspector.artifacts}
        toolCalls={data.inspector.toolCalls}
      />
    </div>
  );
}
