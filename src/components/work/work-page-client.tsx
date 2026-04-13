"use client";

import { useEffect, useState } from "react";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

import { ConversationFeed } from "./work-page/conversation-feed";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page/work-page-copy";
import { HeroApprovals } from "./work-page/hero-approvals";
import { LatestResultClosure } from "./work-page/latest-result-closure";
import { useWorkPageController } from "./work-page/use-work-page-controller";
import { WorkConversationWorkbench } from "./work-page/work-conversation-workbench";
import { WorkbenchComposerCard } from "./work-page/workbench-composer-card";
import {
  getRunStatusLabel,
  getScheduleStatusLabel,
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
import type {
  WorkConversationSection,
  WorkPageClientProps,
} from "./work-page/work-page-types";

function renderWorkbenchSections(sections: WorkConversationSection[]) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {sections.map((section) =>
        section.tone === "accent" ? (
          <article
            key={section.id}
            className="overflow-hidden rounded-[24px] border border-slate-900/75 bg-[linear-gradient(180deg,rgba(15,23,42,0.97),rgba(15,23,42,0.93))] text-primary-foreground shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
          >
            <div className="border-b border-white/10 px-5 py-4 sm:px-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary-foreground/[0.62]">
                {section.eyebrow}
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight">{section.title}</h3>
            </div>

            <div className="px-5 py-5 sm:px-6">{section.content}</div>
          </article>
        ) : (
          <article
            key={section.id}
            className={cn(
              "border-t border-border/50 pt-6 first:border-t-0 first:pt-0",
            )}
          >
            <div className="mb-3 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/[0.85]">
                {section.eyebrow}
              </p>
              <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {section.title}
              </h3>
            </div>

            <div>{section.content}</div>
          </article>
        ),
      )}
    </div>
  );
}

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
  const quickPrompts = workbenchComposer
    ? getQuickPrompts(workbenchComposer, currentRun)
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
  const conversationSection: WorkConversationSection = {
    id: "conversation",
    eyebrow: copy.conversation,
    title: copy.conversationEvidence,
    content: (
      <section className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.conversationEvidenceDescription}
        </p>
        <ConversationFeed
          items={collaborationFeed}
          emptyText={copy.fallbackNoOperatorInput}
        />
      </section>
    ),
  };

  const fullFlowSections: WorkConversationSection[] = [
    {
      id: "latest-result",
      eyebrow: copy.latestResultEyebrow,
      title: copy.latestResult,
      content: (
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
      ),
    },
    {
      id: "timeline",
      eyebrow: copy.workstream,
      title: copy.latestExecutionMilestones,
      content: (
        <section id="execution-stream" aria-label={copy.executionStreamAria}>
          <ExecutionTimeline title={copy.latestExecutionMilestones} events={data.workstreamItems} />
        </section>
      ),
    },
  ];

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
          content: <div className="mx-auto max-w-4xl">{conversationSection.content}</div>,
        },
        {
          id: "full-flow",
          label: copy.fullFlowTab,
          content: renderWorkbenchSections(fullFlowSections),
        },
      ]}
      defaultTabId="conversation"
      composer={
        <WorkbenchComposerCard
          composer={workbenchComposer}
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
