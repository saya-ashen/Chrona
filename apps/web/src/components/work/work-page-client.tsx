"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@chrona/i18n/react";

import { WorkPageComposerDock } from "./work-page/work-page-composer-dock";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page/work-page-copy";
import { WorkPageHeaderCard } from "./work-page/work-page-header-card";
import { WorkPageMainTabs } from "./work-page/work-page-main-tabs";
import { WorkPageRightRail } from "./work-page/work-page-right-rail";
import { useWorkPageController } from "./work-page/use-work-page-controller";
import { formatDateTime, getSyncStatusLabel } from "./work-page/work-page-formatters";
import {
  getCurrentException,
  getCurrentPlanAction,
  getPassiveHeroGuidance,
  getQuickPrompts,
  getTaskSummary,
  getWorkComposer,
} from "./work-page/work-page-selectors";
import type { WorkPageClientProps } from "./work-page/work-page-types";

function getExecutionTone(status: string) {
  switch (status) {
    case "completed":
      return "secondary" as const;
    case "waiting_for_user":
    case "waiting_for_approval":
      return "secondary" as const;
    case "blocked":
      return "destructive" as const;
    case "running":
    case "started":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function getNodeViewStatus(
  step: WorkPageClientProps["initialData"]["taskPlan"]["nodes"][number],
  planExecution: WorkPageClientProps["initialData"]["planExecution"],
) {
  if (planExecution?.executedNodeIds.includes(step.id) || step.status === "done" || step.status === "skipped") return "completed" as const;
  if (planExecution?.currentNodeId === step.id || step.status === "active") return "running" as const;
  if (planExecution?.waitingNodeIds.includes(step.id) || step.status === "waiting") return "waiting" as const;
  if (planExecution?.blockedNodeIds.includes(step.id) || step.status === "blocked") return "blocked" as const;
  return "pending" as const;
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
    composerResetKey,
    submitWorkInput,
    actions,
  } = useWorkPageController(initialData, copy);

  const currentRun = data.currentRun;
  const currentException = getCurrentException(data, copy);
  const taskSummary = getTaskSummary(data, copy);
  const workComposer = getWorkComposer(
    currentRun,
    data.currentIntervention,
    data.closure,
    data.taskShell,
    copy,
    data.planExecution,
  );
  const currentPlanAction = getCurrentPlanAction(currentRun, data.taskPlan, copy);
  const currentPlanStep = data.taskPlan.nodes.find((step) => step.id === data.taskPlan.analytics.activeNodeIds[0]) ?? null;
  const quickPrompts = workComposer
    ? getQuickPrompts(workComposer, currentRun, data.currentIntervention, copy)
    : [];
  const passiveHeroGuidance = getPassiveHeroGuidance(currentRun, data.closure, copy);

  const [composerValue, setComposerValue] = useState(workComposer?.defaultValue ?? "");
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);

  useEffect(() => {
    setComposerValue(workComposer?.defaultValue ?? "");
  }, [workComposer?.defaultValue, workComposer?.mode, currentRun?.id]);

  const syncLabel = getSyncStatusLabel(data.reliability.syncStatus, copy) ?? copy.noValue;
  const blockerSummary =
    currentException ??
    data.reliability.stopReason ??
    data.taskShell.blockReason?.actionRequired ??
    copy.noBlockingAction;
  const suggestedAction =
    data.currentIntervention?.actionLabel ?? currentPlanAction?.label ?? copy.noSuggestedAction;
  const riskSummary = [
    data.reliability.isStale ? copy.staleSync : syncLabel,
    data.reliability.stuckFor ? `${copy.stuckFor}: ${data.reliability.stuckFor}` : null,
    data.reliability.lastSyncedAt
      ? `${copy.lastSyncedLabel}: ${formatDateTime(data.reliability.lastSyncedAt)}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const executionStatus = data.planExecution?.status ?? "no_plan";
  const nodeCount = data.taskPlan.nodes.length;
  const completedCount = data.taskPlan.nodes.filter(
    (step) => getNodeViewStatus(step, data.planExecution) === "completed",
  ).length;
  const waitingCount = data.taskPlan.nodes.filter((step) => {
    const status = getNodeViewStatus(step, data.planExecution);
    return status === "waiting" || status === "blocked";
  }).length;
  const rightRailSummary = heroErrorMessage ?? blockerSummary;
  const dockSummary =
    data.currentIntervention?.actionLabel ??
    currentPlanStep?.title ??
    workComposer?.statusHint ??
    passiveHeroGuidance.description;

  const [activeTab, setActiveTab] = useState<"latest" | "plan" | "timeline" | "info">("latest");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <WorkPageHeaderCard
        title={data.taskShell.title}
        executionStatus={executionStatus}
        executionTone={getExecutionTone(executionStatus)}
        syncLabel={syncLabel}
        isStale={data.reliability.isStale}
        description={passiveHeroGuidance.description || taskSummary}
        taskId={data.taskShell.id}
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pb-[5.5rem] xl:grid-cols-[minmax(0,1fr)_292px] 2xl:grid-cols-[minmax(0,1fr)_308px]">
        <WorkPageMainTabs
          data={data}
          copy={copy}
          currentRunId={currentRun?.id ?? null}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          completedCount={completedCount}
          nodeCount={nodeCount}
          waitingCount={waitingCount}
        />

        <WorkPageRightRail
          copy={copy}
          suggestedAction={suggestedAction}
          syncLabel={syncLabel}
          riskSummary={riskSummary}
          rightRailSummary={rightRailSummary}
        />
      </div>

      <WorkPageComposerDock
        isComposerExpanded={isComposerExpanded}
        onExpandChange={setIsComposerExpanded}
        dockSummary={dockSummary}
        workComposer={workComposer}
        data={data}
        currentStepTitle={currentPlanStep?.title ?? null}
        composerValue={composerValue}
        onComposerChange={setComposerValue}
        onSubmit={submitWorkInput}
        quickPrompts={quickPrompts}
        errorMessage={heroErrorMessage}
        isPending={isPending}
        passiveDescription={passiveHeroGuidance.description}
        passiveActions={passiveHeroGuidance.actions}
        copy={copy}
        composerResetKey={composerResetKey}
        runId={currentRun?.id ?? null}
        executionStatus={executionStatus}
        onStartExecution={() => actions.startExecution()}
      />
    </div>
  );
}
