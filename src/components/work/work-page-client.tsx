"use client";

import { useEffect, useMemo, useState } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { NextActionHero } from "@/components/work/next-action-hero";
import { TaskShell } from "@/components/work/task-shell";
import { WorkInspector } from "@/components/work/work-inspector";
import { useI18n } from "@/i18n/client";

import { ConversationFeed } from "./work-page/conversation-feed";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page/work-page-copy";
import { HeroApprovals } from "./work-page/hero-approvals";
import { LatestResultClosure } from "./work-page/latest-result-closure";
import { useWorkPageController } from "./work-page/use-work-page-controller";
import { WorkbenchComposerCard } from "./work-page/workbench-composer-card";
import {
  formatDate,
  getApprovalStatusLabel,
  getArtifactTypeLabel,
  getRunStatusLabel,
  getScheduleStatusLabel,
  getSyncStatusLabel,
  getToolCallStatusLabel,
  isInternalAppHref,
  isSafeExternalHref,
} from "./work-page/work-page-formatters";
import {
  buildConversationFeed,
  getCurrentException,
  getCurrentPlanAction,
  getPassiveHeroGuidance,
  getQuickPrompts,
  getScheduleSourceSummary,
  getTaskStatusMeta,
  getTaskSummary,
  getWorkbenchComposer,
} from "./work-page/work-page-selectors";
import type { WorkPageClientProps } from "./work-page/work-page-types";

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const { messages } = useI18n();
  const workPageMessages = messages.components?.workPage ?? {};
  const copy = {
    ...DEFAULT_WORK_PAGE_COPY,
    ...workPageMessages,
  };

  const {
    data,
    isPending,
    heroErrorMessage,
    resultErrorMessage,
    composerResetKey,
    actions,
  } = useWorkPageController(initialData, copy);

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
  const quickPrompts = workbenchComposer
    ? getQuickPrompts(workbenchComposer, currentRun)
    : [];
  const collaborationFeed = buildConversationFeed(data, copy);
  const passiveHeroGuidance = getPassiveHeroGuidance(
    currentRun,
    data.closure,
    copy,
  );

  const inspectorApprovals = useMemo(
    () =>
      data.inspector.approvals.map((approval) => ({
        ...approval,
        status: getApprovalStatusLabel(approval.status),
      })),
    [data.inspector.approvals],
  );

  const inspectorArtifacts = useMemo(
    () =>
      data.inspector.artifacts.map((artifact) => ({
        ...artifact,
        type: getArtifactTypeLabel(artifact.type),
      })),
    [data.inspector.artifacts],
  );

  const inspectorToolCalls = useMemo(
    () =>
      data.inspector.toolCalls.map((tool) => ({
        ...tool,
        status: getToolCallStatusLabel(tool.status),
      })),
    [data.inspector.toolCalls],
  );

  const [composerValue, setComposerValue] = useState(
    workbenchComposer?.defaultValue ?? "",
  );

  useEffect(() => {
    setComposerValue(workbenchComposer?.defaultValue ?? "");
  }, [
    workbenchComposer?.defaultValue,
    workbenchComposer?.mode,
    currentRun?.id,
  ]);

  const blockerSummary =
    data.taskShell.blockReason?.actionRequired ??
    data.reliability.stopReason ??
    currentException ??
    "当前没有明确阻塞，任务可以继续推进。";

  const runLabel = getRunStatusLabel(currentRun?.status);
  const scheduleLabel = getScheduleStatusLabel(data.scheduleImpact.status);
  const heroTitle = data.currentIntervention?.title ?? copy.nextAction;
  const heroDescription =
    data.currentIntervention?.description ??
    workbenchComposer?.description ??
    passiveHeroGuidance.description;
  const heroWhyNow = data.currentIntervention?.whyNow ?? taskSummary;
  const heroActionLabel =
    data.currentIntervention?.actionLabel ?? copy.nextAction;
  const heroEvidence = data.currentIntervention?.evidence ?? [];
  const heroModeLabel = currentRun
    ? getRunStatusLabel(currentRun.status)
    : copy.noActiveRunYet;

  const latestResultActions =
    data.closure.canAcceptResult ||
    data.closure.canRetry ||
    data.latestOutput.href ? (
      <>
        {data.closure.canAcceptResult ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => void actions.acceptResult()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {copy.acceptResult}
          </button>
        ) : null}

        {data.closure.canRetry ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => void actions.retryResult()}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {copy.retryRun}
          </button>
        ) : null}

        {data.latestOutput.href && isInternalAppHref(data.latestOutput.href) ? (
          <LocalizedLink
            href={data.latestOutput.href}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
          >
            {copy.openArtifact}
          </LocalizedLink>
        ) : null}

        {data.latestOutput.href &&
        !isInternalAppHref(data.latestOutput.href) &&
        isSafeExternalHref(data.latestOutput.href) ? (
          <a
            href={data.latestOutput.href}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
          >
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
        statusMeta={currentException ? <span>{currentException}</span> : null}
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
            approvals={
              <HeroApprovals
                approvals={data.currentIntervention?.approvals ?? []}
                isPending={isPending}
                copy={copy}
                onApprove={actions.approveApproval}
                onReject={actions.rejectApproval}
                onEditAndApprove={actions.editAndApproveApproval}
              />
            }
            composer={
              <WorkbenchComposerCard
                composer={workbenchComposer}
                composerValue={composerValue}
                onComposerChange={setComposerValue}
                onSubmit={actions.submitWorkbenchInput}
                quickPrompts={quickPrompts}
                errorMessage={heroErrorMessage}
                isPending={isPending}
                passiveDescription={passiveHeroGuidance.description}
                passiveActions={passiveHeroGuidance.actions}
                copy={copy}
                composerResetKey={composerResetKey}
                runId={currentRun?.id ?? null}
              />
            }
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
            error={
              resultErrorMessage ? (
                <p
                  role="alert"
                  className="rounded-md border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-700"
                >
                  {resultErrorMessage}
                </p>
              ) : null
            }
            closure={
              <LatestResultClosure
                data={data}
                copy={copy}
                isPending={isPending}
                onMarkTaskDone={actions.markTaskDone}
                onReopenTask={actions.reopenTask}
                onCreateFollowUp={actions.createFollowUp}
              />
            }
            actions={latestResultActions}
            usedByNextAction={Boolean(
              data.currentIntervention &&
                data.currentIntervention.kind !== "observe",
            )}
            labels={{
              ariaLabel: copy.latestResultAria,
              eyebrow: copy.latestResultEyebrow,
              usedByNextAction: copy.usedByNextAction,
              actionsTitle: copy.resultActionsTitle,
            }}
          />

          <section
            aria-label={copy.executionStreamAria}
            id="execution-stream"
            className="rounded-[30px] border bg-card p-5 shadow-sm sm:p-6"
          >
            <div className="border-b border-border/60 pb-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {copy.workstream}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {copy.executionWorkstream}
              </h2>
            </div>

            <div className="mt-5 space-y-6">
              <ExecutionTimeline
                title={copy.latestExecutionMilestones}
                events={data.workstreamItems}
              />

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {copy.conversationEvidence}
                  </h3>
                </div>

                <ConversationFeed
                  items={collaborationFeed}
                  emptyText={copy.fallbackNoOperatorInput}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <WorkInspector
            plan={data.taskPlan}
            isPending={isPending}
            onGenerate={actions.generateTaskPlan}
            currentAction={currentPlanAction}
            currentException={currentException}
            approvals={inspectorApprovals}
            artifacts={inspectorArtifacts}
            toolCalls={inspectorToolCalls}
            context={{
              priority: data.taskShell.priority,
              dueAt: data.taskShell.dueAt,
              scheduledStartAt: data.taskShell.scheduledStartAt,
              scheduledEndAt: data.taskShell.scheduledEndAt,
              scheduleStatus: scheduleLabel,
              scheduleSummary: data.scheduleImpact.summary,
              runStatus: runLabel,
              syncStatus: getSyncStatusLabel(data.reliability.syncStatus, copy),
              isStale: data.reliability.isStale,
              lastUpdatedAt:
                data.reliability.lastUpdatedAt ??
                data.reliability.lastSyncedAt ??
                data.reliability.refreshedAt,
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
                waiting_for_user: {
                  label: copy.waitingForUserStep,
                  tone: "warning",
                },
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
