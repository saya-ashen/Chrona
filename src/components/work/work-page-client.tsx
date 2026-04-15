"use client";

import { useEffect, useState } from "react";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
import { useI18n } from "@/i18n/client";

import { ConversationFeed } from "./work-page/conversation-feed";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page/work-page-copy";
import { LatestResultClosure } from "./work-page/latest-result-closure";
import { useWorkPageController } from "./work-page/use-work-page-controller";
import { WorkConversationWorkbench } from "./work-page/work-conversation-workbench";
import { WorkbenchComposerCard } from "./work-page/workbench-composer-card";
import {
  formatDateTime,
  getRunStatusLabel,
  getScheduleStatusLabel,
  getSyncStatusLabel,
  parseDateInputForSubmission,
} from "./work-page/work-page-formatters";
import {
  buildConversationFeed,
  getCurrentException,
  getCurrentPlanAction,
  getPassiveHeroGuidance,
  getQuickPrompts,
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
    submitWorkbenchInput,
    actions,
  } = useWorkPageController(initialData, copy);

  const currentRun = data.currentRun;
  const taskStatusMeta = getTaskStatusMeta(data, copy);
  const currentException = getCurrentException(data);
  const taskSummary = getTaskSummary(data, copy);
  const workbenchComposer = getWorkbenchComposer(
    currentRun,
    data.currentIntervention,
    data.closure,
    data.taskShell,
    copy,
  );
  const currentPlanAction = getCurrentPlanAction(currentRun, data.taskPlan);
  const currentPlanStep = data.taskPlan.steps.find(
    (step) => step.id === data.taskPlan.currentStepId,
  ) ?? null;
  const quickPrompts = workbenchComposer
    ? getQuickPrompts(workbenchComposer, currentRun, data.currentIntervention)
    : [];
  const collaborationFeed = buildConversationFeed(data, copy);
  const passiveHeroGuidance = getPassiveHeroGuidance(
    currentRun,
    data.closure,
    copy,
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

  const runLabel = getRunStatusLabel(currentRun?.status);
  const scheduleLabel = getScheduleStatusLabel(data.scheduleImpact.status);
  const syncLabel = getSyncStatusLabel(data.reliability.syncStatus, copy) ?? copy.noValue;
  const blockerSummary =
    currentException ??
    data.reliability.stopReason ??
    data.taskShell.blockReason?.actionRequired ??
    copy.noBlockingAction;
  const suggestedAction =
    data.currentIntervention?.actionLabel ?? currentPlanAction?.label ?? copy.noSuggestedAction;
  const recentOutputSummary = data.latestOutput.empty
    ? copy.noRecentOutput
    : data.latestOutput.title || data.latestOutput.body || copy.noRecentOutput;
  const latestEventSummary = data.workstreamItems.at(-1)?.title ?? copy.fallbackNoOperatorInput;
  const riskSummary = [
    data.reliability.isStale ? copy.staleSync : syncLabel,
    data.reliability.stuckFor ? `${copy.stuckFor}: ${data.reliability.stuckFor}` : null,
    data.reliability.lastSyncedAt
      ? `${copy.lastSyncedLabel}: ${formatDateTime(data.reliability.lastSyncedAt)}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const fullFlowContent = (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,360px)] xl:items-start">
      <section aria-label={copy.executionRecordMain} className="min-w-0 space-y-6">
        <article
          id="execution-stream"
          aria-label={copy.executionStreamAria}
          className="rounded-[24px] border border-border/70 bg-background/[0.9] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-5"
        >
          <ExecutionTimeline
            title={copy.latestExecutionMilestones}
            events={data.workstreamItems}
            currentRunId={currentRun?.id ?? null}
          />
        </article>
      </section>

      <aside aria-label={copy.executionRecordSidebar} className="space-y-4 xl:sticky xl:top-0">
        <section className="rounded-[24px] border border-border/70 bg-muted/[0.2] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy.taskCockpit}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{copy.taskCockpitDescription}</p>

          <div className="mt-4 space-y-4">
            <section className="rounded-2xl border border-border/70 bg-background/[0.86] p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.currentBlocker}
              </p>
              <p className="mt-2 text-sm text-foreground">{blockerSummary}</p>
            </section>

            <section className="rounded-2xl border border-border/70 bg-background/[0.86] p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.nextAction}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">{suggestedAction}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.currentIntervention?.description ?? taskSummary}
              </p>
            </section>

            <section className="rounded-2xl border border-border/70 bg-background/[0.86] p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.recentOutput}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">{recentOutputSummary}</p>
              {!data.latestOutput.empty && data.latestOutput.timestamp ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.updated} {formatDateTime(data.latestOutput.timestamp)}
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border/70 bg-background/[0.86] p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.riskAndSync}
              </p>
              <p className="mt-2 text-sm text-foreground">{riskSummary || syncLabel}</p>
            </section>
          </div>
        </section>

        <section className="rounded-[24px] border border-border/70 bg-background/[0.9] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy.executionSnapshot}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{copy.executionSnapshotDescription}</p>

          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.currentStage}
              </dt>
              <dd className="mt-1 font-medium text-foreground">{runLabel}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.currentFocusSummary}
              </dt>
              <dd className="mt-1 text-foreground">{data.currentIntervention?.title ?? taskSummary}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.latestEvent}
              </dt>
              <dd className="mt-1 text-foreground">{latestEventSummary}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/85">
                {copy.scheduleStatusLabel}
              </dt>
              <dd className="mt-1 text-foreground">{scheduleLabel}</dd>
            </div>
          </dl>
        </section>

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
              onAcceptResult={actions.acceptResult}
              onRetry={actions.retryResult}
              onMarkTaskDone={actions.markTaskDone}
              onReopenTask={actions.reopenTask}
              onCreateFollowUp={actions.createFollowUpTask}
            />
          }
          usedByNextAction={Boolean(
            data.currentIntervention && data.currentIntervention.kind !== "observe",
          )}
          labels={{
            ariaLabel: copy.latestResultAria,
            eyebrow: copy.latestResultEyebrow,
            usedByNextAction: copy.usedByNextAction,
            actionsTitle: copy.resultActionsTitle,
          }}
        />
      </aside>
    </div>
  );

  return (
    <WorkConversationWorkbench
      conversationHeader={{
        eyebrow: copy.currentTask,
        title: data.taskShell.title,
        summary: taskSummary,
        badges: [taskStatusMeta.label, runLabel, scheduleLabel],
      }}
      tabs={[
        {
          id: "conversation",
          label: copy.conversationTab,
          content: (
            <div className="mx-auto max-w-4xl">
              <ConversationFeed
                items={collaborationFeed}
                emptyText={copy.fallbackNoOperatorInput}
              />
            </div>
          ),
        },
        {
          id: "full-flow",
          label: copy.fullFlowTab,
          content: fullFlowContent,
        },
      ]}
      defaultTabId="conversation"
      composer={
        <WorkbenchComposerCard
          composer={workbenchComposer}
          currentIntervention={data.currentIntervention}
          currentStepTitle={currentPlanStep?.title ?? null}
          composerValue={composerValue}
          onComposerChange={setComposerValue}
          onSubmit={submitWorkbenchInput}
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
      planRail={
        <TaskPlanSidePanel
          plan={data.taskPlan}
          copy={copy}
          isPending={isPending}
          onGenerate={actions.generateTaskPlan}
          currentAction={currentPlanAction}
          currentException={currentException}
        />
      }
      labels={{
        workbenchAria: copy.conversationWorkbenchAria,
        planRailAria: copy.planRailAria,
        tabsAria: copy.workbenchViewTabs,
      }}
    />
  );
}

export { parseDateInputForSubmission };
