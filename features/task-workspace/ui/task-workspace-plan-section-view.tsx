"use client";

import { Badge, Button } from "@shared/ui";
import { TaskWorkspaceInspector } from "@features/execution-monitoring/ui";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import { TaskWorkspaceOperationPanel } from "./task-workspace-operation-panel";
import { PlanNodeDetailCard, PlanReviewSummaryCard, StageBarCard } from "./task-workspace-plan-detail-components";
import { PlanGenerationProgressPanel, PlanSetupPanel } from "./task-workspace-plan-setup-panel";
import { RunLaunchPanel } from "./task-workspace-run-launch-panel";
import { ResultLifecyclePanel, RequestResultChangesCard } from "./task-workspace-result-lifecycle-panel";
import { PlanReviewDecisionPanel } from "./task-workspace-plan-review-panel";
import { ExecutionFocusHeader, ExecutionNavigator } from "./task-workspace-execution-navigation";
import type { TaskWorkspacePlanSectionProps } from "./task-workspace-plan-section-contract";
import type { TaskWorkspacePlanSectionRuntime } from "./task-workspace-plan-section-runtime";
import { recoveryActionButtonVariant } from "./task-workspace-plan-utils";

type PlanSectionViewProps = {
  props: TaskWorkspacePlanSectionProps;
  runtime: TaskWorkspacePlanSectionRuntime;
};

export function TaskWorkspacePlanSectionView({ props, runtime }: PlanSectionViewProps) {
  const { displayState, copy, stateMessage, recoveryIssue, recoveryActions, recoveryCurrentNodeId } = runtime;
  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className={displayState.layout === "result_focus" ? "relative flex flex-col overflow-visible rounded-3xl border border-border/80 bg-muted/45 xl:min-h-0 xl:flex-1 xl:overflow-y-auto" : "relative flex flex-col overflow-visible rounded-3xl border border-border/80 bg-muted/35 xl:min-h-0 xl:flex-1 xl:overflow-hidden"}
      data-workspace-layout={displayState.layout}
      data-workspace-primary-surface={displayState.primarySurface}
      data-workspace-primary-action={displayState.primaryAction}
    >
      <PlanSectionAlerts
        stateMessage={stateMessage}
        recoveryIssue={recoveryIssue}
        recoveryActions={recoveryActions}
        onRecoveryAction={() => runtime.focusNodeActions(recoveryCurrentNodeId)}
      />
      {displayState.panels.stageBar ? <StageBarCard stage={displayState.stage} displayMode={displayState.mode} /> : null}
      <PlanSectionBody props={props} runtime={runtime} />
    </section>
  );
}

function PlanSectionAlerts({ stateMessage, recoveryIssue, recoveryActions, onRecoveryAction }: Pick<TaskWorkspacePlanSectionRuntime, "stateMessage" | "recoveryIssue" | "recoveryActions"> & { onRecoveryAction: () => void }) {
  return (
    <>
      {stateMessage ? <div className="mx-4 mt-4 rounded-xl border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning-foreground" role="status">{stateMessage}</div> : null}
      {recoveryIssue ? (
        <div className="mx-4 mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <p className="font-semibold">{recoveryIssue.message}</p>
          {recoveryActions.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{recoveryActions.map((action) => <Button key={action.type} type="button" size="sm" variant={recoveryActionButtonVariant(action.type)} disabled={!action.enabled} onClick={onRecoveryAction}>{action.label}</Button>)}</div> : null}
        </div>
      ) : null}
    </>
  );
}

function PlanSectionBody({ props, runtime }: PlanSectionViewProps) {
  const { displayState, hasGraphExecutionStarted } = runtime;
  if (displayState.layout === "brief_focus") return <PlanBriefFocus props={props} runtime={runtime} />;
  if (displayState.layout === "result_focus") return <PlanResultFocus props={props} runtime={runtime} />;
  if (displayState.mode === "reviewing_plan") return <PlanReviewFocus props={props} runtime={runtime} />;
  if (displayState.mode === "ready_to_run" && displayState.runPreview && !hasGraphExecutionStarted) return <PlanReadyToRun props={props} runtime={runtime} />;
  if (displayState.mode === "running" && displayState.runningExecution && props.graphPlan) return <PlanRunningFocus props={props} runtime={runtime} />;
  return <PlanWorkspace props={props} runtime={runtime} />;
}

function PlanBriefFocus({ props, runtime }: PlanSectionViewProps) {
  return runtime.displayState.mode === "planning" ? <PlanGenerationProgressPanel /> : <PlanSetupPanel readiness={runtime.displayState.readiness} pageData={props.pageData} onGeneratePlan={() => props.onGeneratePlan()} onEditBrief={() => props.onEditBrief?.()} />;
}

function PlanResultFocus({ props, runtime }: PlanSectionViewProps) {
  return <div className="min-h-[560px] flex-1 p-3 xl:min-h-0"><div className="flex min-h-0 flex-col gap-3">
    <ResultLifecycle props={props} runtime={runtime} />
    <ResultChanges props={props} runtime={runtime} />
    <ResultInspector props={props} runtime={runtime} />
  </div></div>;
}

function ResultLifecycle({ props, runtime }: PlanSectionViewProps) {
  const review = runtime.displayState.resultReview;
  const ready = props.currentExecution?.planOutput?.finalization.status === "Ready";
  if (!runtime.displayState.panels.resultLifecycle || !review || (review.phase !== "accepted" && !ready)) return null;
  return <ResultLifecyclePanel taskId={props.pageData.task.id} review={review} copy={runtime.copy} goalKnowledge={props.pageData.task.goalKnowledge} onAcceptResult={ready ? props.onAcceptResult : undefined} onRequestChanges={() => { runtime.setResultChangeError(null); runtime.setIsRequestingResultChanges(true); }} isAcceptingResult={props.isAcceptingResult ?? false} acceptResultError={props.acceptResultError} createGoalAction={props.createGoalAction} />;
}

function ResultChanges({ runtime }: PlanSectionViewProps) {
  if (!runtime.isRequestingResultChanges || runtime.displayState.resultReview?.phase !== "pending_acceptance") return null;
  return <RequestResultChangesCard copy={runtime.copy} instruction={runtime.resultChangeInstruction} onInstructionChange={runtime.setResultChangeInstruction} onCancel={() => { runtime.setIsRequestingResultChanges(false); runtime.setResultChangeError(null); }} onSubmit={() => void runtime.submitResultChanges()} isSubmitting={runtime.isSubmittingResultChanges} error={runtime.resultChangeError} />;
}

function ResultInspector({ props, runtime }: PlanSectionViewProps) {
  return <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-sm" data-ui-surface-kind="ai-authored" data-testid="final-result-surface"><TaskWorkspaceInspector key={runtime.commandCenterScopeKey} taskId={props.pageData.task.id} consoleView={runtime.consoleView} commandCenter={runtime.isGeneratingPlan ? null : (props.commandCenter ?? null)} commandCenterActionHandlers={runtime.commandCenterActionHandlers} runtimeEvents={props.runtimeEvents} liveActivity={props.liveActivity ?? []} currentExecution={props.currentExecution} onRetryFinalization={props.onRetryFinalization} isRetryingFinalization={props.isRetryingFinalization ?? false} finalizationRetryError={props.finalizationRetryError} showHeader={false} copy={runtime.copy} onAction={runtime.focusNodeActions} /></div>;
}

function PlanReviewFocus({ props, runtime }: PlanSectionViewProps) {
  const { copy, graphMode, setGraphMode, setSelectedNode } = runtime;
  return <div className="grid min-h-[560px] flex-1 gap-3 overflow-y-auto p-3 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
    <section aria-label={copy.executionFlow ?? "Execution flow"} className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/70 xl:min-h-0"><TaskWorkspacePlanContent label={props.label} graphPlan={props.graphPlan} isGraphPlanPending={props.isGraphPlanPending} plan={props.plan} acceptPlanError={null} planWorkbenchMode="review" planGenerationStatus={props.planGenerationStatus} graphMode={graphMode} onGraphModeChange={setGraphMode} onGeneratePlan={() => props.onGeneratePlan()} onSelectedNodeChange={setSelectedNode} /></section>
    <PlanReviewDecision props={props} runtime={runtime} />
  </div>;
}

function PlanReviewDecision({ props, runtime }: PlanSectionViewProps) {
  if (!props.plan || !props.graphPlan) return null;
  return <PlanReviewDecisionPanel copy={runtime.copy} plan={props.plan} graphPlan={props.graphPlan} canAcceptPlan={props.canAcceptPlan} isGeneratingPlan={runtime.isGeneratingPlan} visibleGenerationInstruction={runtime.visibleGenerationInstruction} acceptPlanError={props.acceptPlanError} revisionInstruction={runtime.regenerationInstruction} selectedNode={runtime.selectedNode} onInstructionChange={runtime.setRegenerationInstruction} onAcceptPlan={() => void props.onApplyPlan(props.plan!)} onRevisePlan={(selectedNodeId) => { const userInstruction = runtime.regenerationInstruction.trim(); runtime.setSubmittedRevisionInstruction(userInstruction || null); runtime.setRegenerationInstruction(""); props.onGeneratePlan({ userInstruction, selectedNodeId }); }} />;
}

function PlanReadyToRun({ props, runtime }: PlanSectionViewProps) {
  const { displayState, copy, graphMode, setGraphMode, setSelectedNode } = runtime;
  const preview = displayState.runPreview!;
  return <div className="grid min-h-[560px] flex-1 gap-4 overflow-y-auto p-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch xl:overflow-hidden">
    <section aria-label={copy.acceptedPlanAria} className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/70 xl:h-full xl:min-h-0" data-testid="accepted-plan-surface">
      <PlanAcceptedHeader copy={copy} preview={preview} />
      <div className="min-h-[32rem] flex-1 xl:min-h-0" data-plan-graph-height-contract="fill"><TaskWorkspacePlanContent label={props.label} graphPlan={props.graphPlan} isGraphPlanPending={props.isGraphPlanPending} plan={props.plan} acceptPlanError={null} planWorkbenchMode="accepted" planGenerationStatus={props.planGenerationStatus} graphMode={graphMode} onGraphModeChange={setGraphMode} onGeneratePlan={() => props.onGeneratePlan()} onSelectedNodeChange={setSelectedNode} /></div>
      {runtime.selectedNode ? <details className="shrink-0 border-t border-border bg-card/65 xl:pointer-events-none" open><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground xl:pointer-events-none">{copy.inspectedNodeLabel}: {runtime.selectedNode.title}</summary><div className="border-t border-border/60 p-3"><PlanNodeDetailCard node={runtime.selectedNode} copy={copy} /></div></details> : null}
    </section>
    <RunLaunchPanel launch={preview} onStart={() => void props.onDispatchExecutionAction({ action: "start_manual" })} onEditTask={props.onEditBrief} />
  </div>;
}

function PlanAcceptedHeader({ copy, preview }: { copy: TaskWorkspacePlanSectionRuntime["copy"]; preview: NonNullable<TaskWorkspacePlanSectionRuntime["displayState"]["runPreview"]> }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-card/70 px-4 py-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-lg font-semibold text-foreground">{copy.acceptedPlanTitle}</h2><Badge variant="secondary">{copy.acceptedPlanBadge}</Badge><Badge variant="outline">{preview.planVersionLabel}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{copy.acceptedPlanDescription}</p></div><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{preview.stepCount} {copy.stepsUnit}</span>{preview.estimatedMinutes ? <span>· {copy.launchAbout} {preview.estimatedMinutes} {copy.launchMinutes}</span> : null}<span>· {preview.expectedStops.length} {copy.launchStopsShort}</span></div></div>;
}

function PlanRunningFocus({ props, runtime }: PlanSectionViewProps) {
  const runningExecution = runtime.displayState.runningExecution!;
  return <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden"><ExecutionFocusHeader view={runningExecution} workState={runtime.displayState.workState} copy={runtime.copy} /><div className="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[minmax(17rem,0.42fr)_minmax(36rem,1.58fr)]"><ExecutionNavigator graphPlan={props.graphPlan!} view={runningExecution} inspectedNode={runtime.selectedNode} copy={runtime.copy} onInspect={runtime.setSelectedNode} onReturnToCurrent={() => runtime.setSelectedNode(null)} /><PlanInspector props={props} runtime={runtime} isExecutionRunning executionResultState={runningExecution.resultState} showOperationPanel={runtime.operationState.status !== "execution-running"} /></div></div>;
}

function PlanWorkspace({ props, runtime }: PlanSectionViewProps) {
  const compact = runtime.graphMode === "compact";
  return <div className={compact ? "grid min-h-[560px] flex-1 gap-4 p-4 xl:min-h-0 xl:grid-cols-[minmax(20rem,0.58fr)_minmax(36rem,1.42fr)]" : "grid min-h-[560px] flex-1 gap-4 p-4 xl:min-h-0 xl:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.68fr)]"}>
    <section aria-label={runtime.copy.executionFlow ?? "Execution flow"} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background/70"><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><TaskWorkspacePlanContent label={props.label} graphPlan={props.graphPlan} isGraphPlanPending={props.isGraphPlanPending} plan={props.plan} acceptPlanError={props.acceptPlanError} planGenerationStatus={props.planGenerationStatus} graphMode={runtime.graphMode} onGraphModeChange={runtime.setGraphMode} onGeneratePlan={() => props.onGeneratePlan()} onSelectedNodeChange={runtime.setSelectedNode} />{runtime.displayState.panels.planReviewSummary || runtime.displayState.panels.runPreview ? <div className="space-y-3 border-t border-border bg-card/65 p-3">{runtime.displayState.panels.planReviewSummary && runtime.displayState.planReviewSummary ? <PlanReviewSummaryCard summary={runtime.displayState.planReviewSummary} /> : null}</div> : null}</div>{runtime.selectedNode && runtime.displayState.panels.selectedNodeDetails ? <div className="shrink-0 border-t border-border bg-card/65 p-3"><PlanNodeDetailCard node={runtime.selectedNode} copy={runtime.copy} /></div> : null}</section>
    <PlanInspector props={props} runtime={runtime} />
  </div>;
}

function PlanInspector({ props, runtime, isExecutionRunning, executionResultState, showOperationPanel = true }: PlanSectionViewProps & { isExecutionRunning?: boolean; executionResultState?: "waiting" | "available"; showOperationPanel?: boolean }) {
  return <TaskWorkspaceInspector key={runtime.commandCenterScopeKey} taskId={props.pageData.task.id} consoleView={runtime.consoleView} commandCenter={runtime.isGeneratingPlan ? null : (props.commandCenter ?? null)} commandCenterActionHandlers={runtime.commandCenterActionHandlers} runtimeEvents={props.runtimeEvents} liveActivity={props.liveActivity ?? []} currentExecution={props.currentExecution} isExecutionRunning={isExecutionRunning} executionResultState={executionResultState} copy={runtime.copy} onAction={runtime.focusNodeActions} operationPanel={showOperationPanel ? <PlanOperationPanel props={props} runtime={runtime} /> : undefined} />;
}

function PlanOperationPanel({ props, runtime }: PlanSectionViewProps) {
  const showOperation = runtime.displayState.panels.operationPanel || runtime.hasGraphExecutionStarted;
  return <div className="space-y-2">{showOperation ? <TaskWorkspaceOperationPanel taskId={props.pageData.task.id} state={runtime.operationState} workState={runtime.displayState.workState} copy={runtime.copy} onGeneratePlan={() => props.onGeneratePlan()} onStartPlan={() => void props.onDispatchExecutionAction({ action: "start_manual" })} onRestartPlan={runtime.restartPlanFromBeginning} onRegeneratePlan={runtime.regeneratePlanForRecovery} hasAcceptedPlan={runtime.isPlanAccepted} onTaskPrimaryAction={runtime.primaryActionDispatch ? () => void props.onDispatchExecutionAction(runtime.primaryActionDispatch!) : undefined} /> : null}{runtime.recoveryError ? <p role="alert" className="text-xs text-destructive">{runtime.recoveryError}</p> : null}</div>;
}
