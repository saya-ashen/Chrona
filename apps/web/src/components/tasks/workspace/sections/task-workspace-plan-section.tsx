"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { ExecutionActionInput, PlanExecutionResult, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskAction } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { CommandCenterCopy } from "../../../../../../../features/execution-monitoring/ui/task-workspace-execution-overview";
import { useActionSpecRenderConfig } from "../../../../../../../features/execution-monitoring/ui/action-tab";
import { TaskWorkspaceInspector } from "../../../../../../../features/execution-monitoring/ui/task-workspace-inspector";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import { TaskWorkspaceOperationPanel } from "./task-workspace-operation-panel";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import {
  createTaskWorkspaceExecutionConsoleView,
  type TaskExecutionDispatchResult,
} from "../../../../../../../features/task-workspace";
import {
  deriveTaskWorkspaceDisplayState,
  dispatchInputForPrimaryAction,
  FOLLOW_UP_INTENTS,
  resolveTaskWorkspaceOperationState,
} from "../../../../../../../features/task-workspace";
import type { RunningExecutionView, TaskPageData, TaskPlanGenerationStatus, TaskWorkspaceDisplayState, WorkspaceActivityItem } from "../../../../../../../features/task-workspace";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

function isCompletedGraphNode(status: string) {
  return status === "done" || status === "completed" || status === "skipped";
}

function isSyntheticStartingNodeWithoutExecutionEvidence(node: TaskPlanGraphPlan["nodes"][number]) {
  return node.metadata?.launchState === "starting";
}

function hasStartedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  return (graphPlan?.nodes ?? []).some((node) => {
    if (isSyntheticStartingNodeWithoutExecutionEvidence(node)) return false;
    return node.status !== "idle" && node.status !== "pending" && node.status !== "ready";
  });
}

function hasNodeActionPayload(node: PlanNodeDataModel | null) {
  if (!node) return false;
  if ((node.availableActions?.length ?? 0) > 0) return true;
  if ((node.interactiveFields?.length ?? 0) === 0) return false;
  const submittedInput = node.inputFields && Object.values(node.inputFields).some((value) => value.trim());
  return !(node.status === "done" || node.status === "skipped") || !submittedInput;
}

function isCompletedTaskStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? "";
  return normalized === "done" || normalized === "completed" || normalized === "complete";
}

function hasCompletedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  const nodes = graphPlan?.nodes ?? [];
  return nodes.length > 0 && nodes.every((node) => isCompletedGraphNode(node.status));
}

export function derivePreferredGraphMode(input: {
  currentMode: "full" | "compact";
  isGeneratingPlan: boolean;
  hasGraphExecutionStarted: boolean;
  hasTaskCompleted: boolean;
}): "full" | "compact" {
  if (input.isGeneratingPlan) return "full";
  if (input.hasGraphExecutionStarted || input.hasTaskCompleted) return "compact";
  return input.currentMode;
}

export function recoveryActionButtonVariant(actionType: TaskAction["type"]): "default" | "outline" | "destructive" {
  if (actionType === "cancel" || actionType === "cancel_execution") return "destructive";
  if (actionType === "retry_sync" || actionType === "repair_inconsistency" || actionType === "replan_from_node") return "default";
  return "outline";
}

function graphNodeIdForAction(action: TaskAction | null | undefined, pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null) {
  return action?.targetNodeId
    ?? pageData.task.executionSummary?.currentNodeId
    ?? graphPlan?.currentStepId
    ?? graphPlan?.nodes.find((node) => node.status === "failed" || node.status === "blocked")?.id
    ?? null;
}

type WorkspaceCopy = Record<string, string | undefined>;

function NodeDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

function PlanNodeDetailCard({ node, copy }: { node: PlanNodeDataModel | null; copy: WorkspaceCopy }) {
  if (!node) return null;
  const dependencies = node.dependencies?.join(", ") ?? null;
  const requiredInfo = node.requiredInfo?.join(", ") ?? null;
  return (
    <Card size="sm" className="gap-3 border-primary/20 bg-primary-soft/25 py-3" role="region" aria-label={copy.nodeDetailOverlayAria ?? "Selected node details"}>
      <CardHeader className="gap-2 px-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{copy.nodeDetailOverlayTitle ?? "Node details"}</p>
            <CardTitle className="mt-1 truncate text-sm">{node.title}</CardTitle>
          </div>
          <Badge variant="outline">{node.statusLabel ?? node.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3">
        <NodeDetailRow label="Objective" value={node.objective} />
        <NodeDetailRow label="Summary" value={node.summary} />
        <NodeDetailRow label="Next action" value={node.nextAction} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <NodeDetailRow label="Mode" value={node.executionMode ?? node.interactionType ?? null} />
          <NodeDetailRow label="Executor" value={node.executor} />
          <NodeDetailRow label="Estimate" value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
          <NodeDetailRow label="Depends on" value={dependencies} />
        </div>
        {node.availableActions?.length ? (
          <div className="space-y-1.5 rounded-lg border border-border/55 bg-background/70 p-2" data-ui-surface-kind="runtime-control">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick actions</p>
            <div className="flex flex-wrap gap-1.5">
              {node.availableActions.map((action) => (
                <Button key={action.id} type="button" size="sm" variant={action.emphasis === "primary" ? "default" : action.emphasis === "danger" ? "destructive" : "outline"} className="h-7 px-2 text-xs">
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {node.options?.length || node.branchLabels?.length ? (
          <div className="space-y-1.5 rounded-lg border border-border/55 bg-muted/25 p-2" data-ui-surface-kind="runtime-control">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision options</p>
            <div className="flex flex-wrap gap-1.5">
              {[...(node.options ?? []), ...(node.branchLabels ?? [])].map((option) => <Badge key={option} variant="outline">{option}</Badge>)}
            </div>
          </div>
        ) : null}
        <NodeDetailRow label="Required info" value={requiredInfo} />
      </CardContent>
    </Card>
  );
}

function StageBarCard({ stage, displayMode }: { stage: TaskWorkspaceDisplayState["stage"]; displayMode: TaskWorkspaceDisplayState["mode"] }) {
  const visibleStage = displayMode === "reviewing_plan" ? "review" : stage.stage;
  const stages: Array<{ id: typeof stage.stage; label: string }> = [
    { id: "brief", label: "Brief" },
    { id: "plan", label: "Plan" },
    { id: "review", label: "Review" },
    { id: "run", label: "Run" },
    { id: "result", label: "Result" },
  ];
  const activeIndex = stages.findIndex((item) => item.id === visibleStage);
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-border/70 px-4 py-2 lg:flex-row lg:items-center lg:justify-between" data-ui-surface-kind="runtime-control">
      <ol className="flex min-w-0 items-center gap-1.5 text-xs" aria-label="Task stage">
        {stages.map((item, index) => (
          <li key={item.id} className="flex min-w-0 items-center gap-1.5">
            <span
              aria-current={index === activeIndex ? "step" : undefined}
              className={index === activeIndex
                ? "rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
                : index < activeIndex
                  ? "rounded-full bg-primary/10 px-3 py-1.5 font-medium text-foreground"
                  : "px-2 py-1.5 text-muted-foreground"}
            >
              {item.label}
            </span>
            {index < stages.length - 1 ? <span className="text-border" aria-hidden>—</span> : null}
          </li>
        ))}
      </ol>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="shrink-0 font-semibold text-foreground">{stage.statusLabel}</span>
        <span className="truncate text-muted-foreground">{stage.nextActionLabel}</span>
        {stage.currentNodeLabel ? <Badge variant="outline" className="hidden max-w-52 truncate bg-background xl:inline-flex">{stage.currentNodeLabel}</Badge> : null}
      </div>
    </div>
  );
}

export function PlanSetupPanel({
  readiness,
  pageData,
  onGeneratePlan,
  onEditBrief,
}: {
  readiness: TaskWorkspaceDisplayState["readiness"];
  pageData: TaskPageData;
  onGeneratePlan: () => void;
  onEditBrief: () => void;
}) {
  const requiredReady = readiness.checks.filter((check) => check.level === "required" && check.state === "passed").length;
  const requiredTotal = readiness.checks.filter((check) => check.level === "required").length;
  const improvements = readiness.checks.filter((check) => check.level === "recommended" && check.state !== "passed");
  const provider = pageData.availableAiClients?.find((client) => client.id === pageData.task.aiClientId)
    ?? pageData.availableAiClients?.[0];
  const isBlocked = readiness.status === "blocked";
  const title = isBlocked
    ? "Connect an AI provider to create a plan"
    : readiness.status === "ready"
      ? "Ready to create a plan"
      : "You can create a plan now";
  const description = isBlocked
    ? "Your task brief is saved. Connect an AI provider, then return here to create a draft plan."
    : improvements.length > 0
      ? "Chrona has enough information for a draft. Adding the details below will make the plan easier to review."
      : "Chrona has enough information to propose reviewable steps for this task.";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="plan-setup-panel" data-plan-setup-layout="full-width">
      <header className="border-b border-border/70 px-5 py-5 lg:px-7 lg:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Plan setup</p>
            <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-foreground lg:text-3xl">{title}</h2>
            <p className="text-sm leading-6 text-muted-foreground lg:text-base">{description}</p>
          </div>
          <Badge variant={isBlocked ? "destructive" : readiness.status === "ready" ? "secondary" : "outline"}>
            {isBlocked ? "Action required" : readiness.status === "ready" ? "Ready" : "Optional details"}
          </Badge>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.75fr)]">
        <div className="min-w-0 space-y-7 px-5 py-6 lg:px-7 lg:py-7 xl:border-r xl:border-border/70">
            <section aria-labelledby="plan-setup-brief-heading">
              <div className="flex items-center justify-between gap-3">
                <h3 id="plan-setup-brief-heading" className="text-sm font-semibold text-foreground">Task brief</h3>
                <Button type="button" size="sm" variant="ghost" onClick={onEditBrief}>Edit task brief</Button>
              </div>
              <dl className="mt-3 grid overflow-hidden rounded-xl border border-border/70 bg-background/60 lg:grid-cols-2">
                <div className="border-b border-border/60 px-4 py-4 lg:col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">Goal</dt>
                  <dd className="mt-1 text-base font-medium text-foreground">{pageData.task.title}</dd>
                </div>
                <div className="border-b border-border/60 px-4 py-4 lg:border-b-0 lg:border-r">
                  <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                  <dd className="mt-1 line-clamp-4 text-sm leading-6 text-foreground">{pageData.task.description?.trim() || "Not added yet"}</dd>
                </div>
                <div className="px-4 py-4">
                  <dt className="text-xs font-medium text-muted-foreground">AI provider</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{provider?.name ?? pageData.task.executionRuntime ?? "Not connected"}</dd>
                </div>
              </dl>
            </section>

            {improvements.length > 0 ? (
              <section aria-labelledby="plan-quality-heading">
                <h3 id="plan-quality-heading" className="text-sm font-semibold text-foreground">Improve plan quality</h3>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {improvements.map((check) => (
                    <div key={check.id} className="flex min-h-28 flex-col justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">{check.label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.helperText}</p>
                      </div>
                      <Button type="button" size="sm" variant="outline" className="self-start" onClick={onEditBrief}>Add detail</Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

        <aside className="bg-muted/30 px-5 py-6 lg:px-7 lg:py-7" aria-label="Plan creation action">
          <div className="sticky top-4 space-y-6 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Create draft plan</p>
              <p className="text-lg font-semibold text-foreground">{requiredReady}/{requiredTotal} required checks ready</p>
              <p className="text-sm leading-6 text-muted-foreground">Creating a plan only prepares a draft. Nothing runs until the plan is reviewed and accepted.</p>
            </div>
            <div className="space-y-2">
              {readiness.primaryAction === "configure_provider" ? (
                <Button asChild size="lg" className="w-full">
                  <LocalizedLink href="/settings?panel=ai-clients">Connect AI provider</LocalizedLink>
                </Button>
              ) : (
                <Button type="button" size="lg" className="w-full" onClick={onGeneratePlan}>Generate plan</Button>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={onEditBrief}>Edit task brief</Button>
            </div>
            <div className="border-t border-border/70 pt-4">
              <p className="text-sm font-medium text-foreground">You stay in control</p>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                <li>Review every proposed step.</li>
                <li>Check human stops and expected output.</li>
                <li>Accept the plan before execution can begin.</li>
              </ul>
            </div>
          </div>
        </aside>
        </div>

      <details className="border-t border-border/70 px-5 py-4 lg:px-7">
        <summary className="cursor-pointer text-sm font-medium text-foreground">What happens next</summary>
        <ol className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
          <li>1. Chrona creates a draft plan.</li>
          <li>2. You review steps and checkpoints.</li>
          <li>3. Nothing runs before plan acceptance.</li>
          <li>4. Execution follows the task automation settings.</li>
        </ol>
      </details>
    </div>
  );
}

function PlanGenerationProgressPanel() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-10" data-testid="plan-generation-progress">
      <div className="w-full max-w-3xl space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="mt-1 size-5 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-label="Plan generation running" />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Creating draft plan</p>
            <h2 className="font-heading text-2xl font-semibold text-foreground">Chrona is preparing a reviewable plan</h2>
            <p className="text-sm leading-6 text-muted-foreground">The draft will replace this progress view after validation and persistence. Nothing executes during plan generation.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {(items.length > 0 ? items : [empty]).map((item) => <li key={item}>- {item}</li>)}
      </ul>
    </div>
  );
}

function PlanReviewSummaryCard({ summary }: { summary: NonNullable<TaskWorkspaceDisplayState["planReviewSummary"]> }) {
  return (
    <Card size="sm" className="border-transparent bg-brand-peach/80 py-4" data-ui-surface-kind="product-authored">
      <CardHeader className="px-4 pb-1">
        <CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Plan review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-xs">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="bg-background/75">{summary.stepCount} plan steps</Badge>
          <Badge variant="outline" className="bg-background/75">{summary.aiStepCount} AI steps</Badge>
          <Badge variant="outline" className="bg-background/75">{summary.checkpointCount} checkpoints</Badge>
          {summary.estimatedMinutes ? <Badge variant="outline" className="bg-background/75">~{summary.estimatedMinutes} min</Badge> : null}
        </div>
        {summary.changeSummary ? (
          <div className="rounded-2xl border border-background/70 bg-background/60 p-3">
            <p className="font-semibold text-foreground">Plan diff review</p>
            <p className="mt-1 text-foreground/70">{summary.changeSummary}</p>
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-3">
          <SummaryList title="Will produce" items={summary.outputIntents} empty="Task result" />
          <SummaryList title="Needs you" items={summary.needsUser} empty="No planned manual stop" />
          <SummaryList title="Potential risks" items={summary.risks} empty="No obvious risk flagged" />
        </div>
      </CardContent>
    </Card>
  );
}

function formatLaunchTime(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function RunLaunchPanel({
  launch,
  onStart,
  onEditTask,
}: {
  launch: NonNullable<TaskWorkspaceDisplayState["runPreview"]>;
  onStart: () => void;
  onEditTask?: () => void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const scheduledStart = formatLaunchTime(launch.scheduledStartAt, locale);
  const scheduledEnd = formatLaunchTime(launch.scheduledEndAt, locale);
  const isBlocked = launch.readiness === "blocked";
  const isScheduled = launch.readiness === "scheduled";
  const title = isBlocked ? copy.launchBlockedTitle : isScheduled ? copy.launchScheduledTitle : copy.launchReadyTitle;
  const description = isBlocked
    ? copy.launchBlockedDescription
    : isScheduled
      ? copy.launchScheduledDescription
      : launch.startMode === "automatic"
        ? copy.launchAutomaticDescription
        : copy.launchManualDescription;

  return (
    <aside className="space-y-3 xl:sticky xl:top-3 xl:self-start" aria-label={copy.launchPanelAria} data-ui-surface-kind="runtime-control">
      <Card className={isBlocked ? "gap-3 border-destructive/35 bg-destructive/5 py-4 shadow-sm" : "gap-3 border-primary/30 bg-primary/5 py-4 shadow-sm"}>
        <CardHeader className="gap-2 px-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{copy.launchEyebrow}</p>
            <Badge variant={isBlocked ? "destructive" : isScheduled ? "secondary" : "default"}>{title}</Badge>
          </div>
          <CardTitle className="font-heading text-xl tracking-[-0.025em]">{title}</CardTitle>
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          {isBlocked && launch.blockerSummary ? (
            <div className="rounded-xl border border-destructive/25 bg-background/80 px-3 py-2 text-sm text-destructive" role="alert">
              {launch.blockerSummary}
            </div>
          ) : null}

          <dl className="divide-y divide-border/65 border-y border-border/65 text-sm">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">{copy.launchStartsLabel}</dt><dd className="font-medium text-foreground">{isScheduled && scheduledStart ? `${scheduledStart}${scheduledEnd ? ` – ${scheduledEnd}` : ""}` : copy.launchImmediateValue}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">{copy.launchRunsWithLabel}</dt><dd className="font-medium text-foreground">{launch.providerLabel} · {launch.runtimeLabel}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">{copy.launchFirstStepLabel}</dt><dd className="font-medium text-foreground">{launch.firstStepLabel}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">{copy.launchResultLabel}</dt><dd className="font-medium text-foreground">{copy.launchResultValue}</dd></div>
          </dl>

          <section aria-labelledby="launch-stops-title" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id="launch-stops-title" className="text-sm font-semibold text-foreground">{copy.launchStopsTitle}</h3>
              <Badge variant="outline">{launch.expectedStops.length}</Badge>
            </div>
            {launch.expectedStops.length > 0 ? (
              <ul className="space-y-2">
                {launch.expectedStops.map((stop) => (
                  <li key={stop.id} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary" className="mt-0.5 shrink-0">{stop.kind === "approval" ? copy.launchApprovalStop : copy.launchInputStop}</Badge>
                    <span className="leading-5 text-foreground">{stop.label}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{copy.launchNoStops}</p>}
          </section>

          {isBlocked ? (
            launch.recoveryAction === "connect_provider" ? (
              <Button type="button" className="w-full" onClick={onEditTask} disabled={!onEditTask}>{copy.launchConnectProvider}</Button>
            ) : (
              <Button type="button" className="w-full" onClick={onEditTask} disabled={!onEditTask}>{copy.launchEditTask}</Button>
            )
          ) : (
            <Button type="button" size="lg" className="w-full" onClick={onStart} disabled={!launch.canStartManually}>
              {isScheduled ? copy.launchStartNow : copy.launchStartRun}
            </Button>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            {isBlocked ? copy.launchBlockedBoundary : isScheduled ? copy.launchScheduledBoundary : copy.launchManualBoundary}
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}


function ResultReviewCard({
  review,
  onAcceptResult,
  onRequestChanges,
  isAcceptingResult = false,
  acceptResultError,
}: {
  review: NonNullable<TaskWorkspaceDisplayState["resultReview"]>;
  onAcceptResult?: () => Promise<void> | void;
  onRequestChanges?: () => void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-4" data-ui-surface-kind="runtime-control">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-semibold tracking-[-0.02em] text-foreground">{review.title}</h3>
            <Badge variant="outline" className="bg-background">Result review</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{review.description}</p>
          {acceptResultError ? <p role="alert" className="text-xs font-medium text-destructive">{acceptResultError}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2" aria-label="Result review actions">
          {review.actions.map((action) => {
            const isAccept = action.id === "accept_result";
            const isRequestChanges = action.id === "request_changes";
            return (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={action.emphasis === "primary" ? "default" : "outline"}
                disabled={isAccept ? isAcceptingResult || !onAcceptResult : false}
                onClick={isAccept ? () => void onAcceptResult?.() : isRequestChanges ? onRequestChanges : undefined}
              >
                {isAccept && isAcceptingResult ? "Accepting result..." : action.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FollowUpComposerCard({ textareaRef }: { textareaRef?: Ref<HTMLTextAreaElement> }) {
  return (
    <Card size="sm" className="border-transparent bg-card py-4" data-ui-surface-kind="product-authored">
      <CardHeader className="px-4 pb-1"><CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Continue from result</CardTitle></CardHeader>
      <CardContent className="space-y-3 px-4 text-xs">
        <Textarea ref={textareaRef} placeholder="Ask a follow-up, request a result update, rerun a step, or create a linked follow-up task." className="min-h-24 rounded-2xl bg-background" />
        <div className="flex flex-wrap gap-1.5" aria-label="Follow-up intent">
          {FOLLOW_UP_INTENTS.map((intent) => <Badge key={intent.id} variant="outline" title={intent.description}>{intent.label}</Badge>)}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanReviewDecisionPanel({
  copy,
  plan,
  graphPlan,
  canAcceptPlan,
  isGeneratingPlan,
  visibleGenerationInstruction,
  acceptPlanError,
  revisionInstruction,
  selectedNode,
  onInstructionChange,
  onAcceptPlan,
  onRevisePlan,
}: {
  copy: WorkspaceCopy;
  plan: TaskPlanReadModel;
  graphPlan: TaskPlanGraphPlan;
  canAcceptPlan?: boolean;
  isGeneratingPlan: boolean;
  visibleGenerationInstruction: string | null;
  acceptPlanError: string | null;
  revisionInstruction: string;
  selectedNode: PlanNodeDataModel | null;
  onInstructionChange: (value: string) => void;
  onAcceptPlan: () => void;
  onRevisePlan: (selectedNodeId: string | null) => void;
}) {
  const [isRevising, setIsRevising] = useState(false);
  const [revisionScope, setRevisionScope] = useState<"plan" | "step">("plan");
  const humanSteps = graphPlan.nodes.filter((node) => Boolean(node.requiresHumanInput || node.checkpoint || ["checkpoint", "user_input"].includes(node.type ?? node.kind ?? "task"))).length;
  const estimatedMinutes = graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);

  return (
    <aside className="space-y-2 xl:sticky xl:top-3 xl:self-start" aria-label="Plan review decision">
      <Card className="gap-2 border-primary/25 bg-primary/5 py-3 shadow-sm" data-ui-surface-kind="runtime-control">
        <CardHeader className="gap-1.5 px-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">Plan ready for review</Badge>
            <span className="text-xs text-muted-foreground">Revision {plan.revision}</span>
          </div>
          <CardTitle className="text-base">Review before continuing</CardTitle>
          <p className="text-xs leading-5 text-muted-foreground">Confirm that the steps, assumptions, and user checkpoints match your intent.</p>
        </CardHeader>
        <CardContent className="space-y-2 px-3">
          <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-background/75 p-2 text-center">
            <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Steps</dt><dd className="mt-1 font-semibold">{graphPlan.nodes.length}</dd></div>
            <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Time</dt><dd className="mt-1 font-semibold">{estimatedMinutes > 0 ? `~${estimatedMinutes}m` : "—"}</dd></div>
            <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Needs you</dt><dd className="mt-1 font-semibold">{humanSteps}</dd></div>
          </dl>
          <div className="rounded-lg border border-border/60 bg-background/75 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">What happens next: </span>
            Accepting saves this plan. Execution does not start until you continue from the next step.
          </div>
          <div className="grid gap-2">
            <Button type="button" className="w-full" onClick={onAcceptPlan} disabled={!canAcceptPlan || isGeneratingPlan}>
              {copy.acceptPlan ?? copy.accept ?? "Accept plan"}
            </Button>
            <Button type="button" className="w-full" variant="outline" onClick={() => setIsRevising((value) => !value)} aria-expanded={isRevising}>
              {isRevising ? "Cancel changes" : "Request changes"}
            </Button>
          </div>
          {acceptPlanError ? <p className="text-xs text-destructive" role="alert">{acceptPlanError}</p> : null}
        </CardContent>
      </Card>

      {selectedNode ? <PlanNodeDetailCard node={selectedNode} copy={copy} /> : null}

      {isRevising ? (
        <Card size="sm" className="border-border bg-background py-3" role="region" aria-label={copy.planRevisionTitle ?? "Plan revision"}>
          <CardHeader className="gap-1 px-3">
            <CardTitle className="text-sm">What should Chrona change?</CardTitle>
            <p className="text-xs text-muted-foreground">Choose the scope explicitly. Selecting a step for inspection does not change it.</p>
          </CardHeader>
          <CardContent className="space-y-3 px-3">
            {visibleGenerationInstruction ? (
              <div className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-2 text-xs"><div className="font-medium text-muted-foreground">{copy.instructionLabel ?? "Last revision request"}</div><div className="mt-1 text-foreground">{visibleGenerationInstruction}</div></div>
            ) : null}
            <div className="grid gap-2" role="radiogroup" aria-label="Revision scope">
              <Button type="button" size="sm" variant={revisionScope === "plan" ? "secondary" : "ghost"} className="justify-start" role="radio" aria-checked={revisionScope === "plan"} onClick={() => setRevisionScope("plan")}>Entire plan</Button>
              <Button type="button" size="sm" variant={revisionScope === "step" ? "secondary" : "ghost"} className="justify-start" role="radio" aria-checked={revisionScope === "step"} disabled={!selectedNode} onClick={() => setRevisionScope("step")}>{selectedNode ? `Selected step: ${selectedNode.title}` : "Select a step to revise it"}</Button>
            </div>
            <label className="block space-y-1.5 text-xs font-medium text-foreground">
              <span>{copy.instructionAria ?? "Plan revision message"}</span>
              <Textarea value={revisionInstruction} onChange={(event) => onInstructionChange(event.target.value)} placeholder={copy.instructionPlaceholder ?? "Tell Chrona what to change in this draft plan..."} rows={4} />
            </label>
            <Button type="button" className="w-full" onClick={() => onRevisePlan(revisionScope === "step" ? selectedNode?.id ?? null : null)} disabled={isGeneratingPlan || !revisionInstruction.trim()}>
              {isGeneratingPlan ? (copy.generating ?? "Revising...") : "Generate revised plan"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </aside>
  );
}

type TaskWorkspacePlanSectionProps = {
  label: string;
  commandCenterCopy?: Partial<CommandCenterCopy>;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  commandCenter?: NonNullable<TaskPageData["commandCenter"]> | null;
  liveActivity?: WorkspaceActivityItem[];
  currentExecution?: PlanExecutionResult | null;
  generationUserInstruction?: string | null;
  onGeneratePlan: (request?: PlanGenerationRequest) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  onAcceptResult?: () => Promise<void> | void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
  onEditBrief?: () => void;
};

function executionNodeState(node: PlanNodeDataModel, view: RunningExecutionView) {
  if (node.id === view.currentStep?.id) return "current" as const;
  if (node.status === "done" || node.status === "completed") return "completed" as const;
  if (node.status === "blocked" || node.status === "failed") return "blocked" as const;
  if (node.status === "waiting" || node.status === "waiting_for_user" || node.status === "waiting_for_approval") return "waiting" as const;
  return "upcoming" as const;
}

function ExecutionFocusHeader({
  view,
  workState,
  copy,
}: {
  view: RunningExecutionView;
  workState: TaskWorkspaceDisplayState["workState"];
  copy: WorkspaceCopy;
}) {
  const progress = view.progress;
  const completedPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const needsAttention = workState.state === "waiting_for_input" || workState.state === "waiting_for_approval";
  return (
    <section
      aria-label={copy.executionFocusAria ?? "Current execution focus"}
      className={needsAttention ? "border-b border-warning/40 bg-warning/10 px-4 py-4" : "border-b border-primary/25 bg-primary-soft/20 px-4 py-4"}
      data-testid="execution-focus-header"
      data-current-step-id={view.currentStep?.id ?? ""}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={needsAttention ? "secondary" : "default"}>{workState.label}</Badge>
            {view.currentStep?.ordinal ? <span className="text-xs font-medium text-muted-foreground">{copy.executionStep ?? "Step"} {view.currentStep.ordinal} {copy.executionOf ?? "of"} {progress.total}</span> : null}
            {view.currentStep?.executorLabel ? <Badge variant="outline">{view.currentStep.executorLabel}</Badge> : null}
          </div>
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">{view.currentStep?.label ?? (copy.executionStarting ?? "Starting execution")}</h2>
            {view.currentStep?.objective ? <p className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground">{view.currentStep.objective}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{progress.completed} {copy.executionCompletedShort ?? "completed"}</span>
            {progress.active > 0 ? <span>{progress.active} {copy.executionActiveShort ?? "running"}</span> : null}
            {progress.waiting > 0 ? <span>{progress.waiting} {copy.executionWaitingShort ?? "waiting"}</span> : null}
            {progress.blocked > 0 ? <span>{progress.blocked} {copy.executionBlockedShort ?? "blocked"}</span> : null}
            <span>{progress.remaining} {copy.executionRemainingShort ?? "remaining"}</span>
            <span>{completedPercent}%</span>
          </div>
        </div>
        <div className="min-w-[15rem] max-w-sm rounded-xl border border-border/70 bg-background/85 px-3 py-2.5 shadow-sm" data-testid="current-runtime-activity">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{copy.currentActivity ?? "Current activity"}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{view.currentActivity.label}</p>
        </div>
      </div>
    </section>
  );
}

function ExecutionNavigator({
  graphPlan,
  view,
  inspectedNode,
  copy,
  onInspect,
  onReturnToCurrent,
}: {
  graphPlan: TaskPlanGraphPlan;
  view: RunningExecutionView;
  inspectedNode: PlanNodeDataModel | null;
  copy: WorkspaceCopy;
  onInspect: (node: PlanNodeDataModel) => void;
  onReturnToCurrent: () => void;
}) {
  const inspectingOther = Boolean(inspectedNode && inspectedNode.id !== view.currentStep?.id);
  return (
    <section aria-label={copy.executionNavigatorAria ?? "Execution navigator"} className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/75" data-testid="execution-navigator">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground">{copy.executionNavigatorTitle ?? "Execution progress"}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{view.progress.completed}/{view.progress.total} {copy.executionStepsComplete ?? "steps complete"}</p>
          </div>
          {inspectingOther ? <Button type="button" variant="outline" size="sm" onClick={onReturnToCurrent}>{copy.returnToCurrentStep ?? "Return to current step"}</Button> : null}
        </div>
        {inspectingOther ? <p className="mt-2 text-xs text-muted-foreground">{copy.inspectingStep ?? "Inspecting"}: <span className="font-medium text-foreground">{inspectedNode?.title}</span> · {copy.executionCurrentlyOn ?? "Execution is currently on"}: <span className="font-medium text-foreground">{view.currentStep?.label}</span></p> : null}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {graphPlan.nodes.map((node, index) => {
          const state = executionNodeState(node, view);
          const isInspected = inspectedNode?.id === node.id;
          const stateLabel = state === "current"
            ? (copy.executionCurrentStep ?? "Running")
            : state === "completed"
              ? (copy.executionCompletedStep ?? "Completed")
              : state === "blocked"
                ? (copy.executionBlockedStep ?? "Blocked")
                : state === "waiting"
                  ? (copy.executionWaitingStep ?? "Waiting")
                  : (copy.executionUpcomingStep ?? "Upcoming");
          return (
            <li key={node.id}>
              <button
                type="button"
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${state === "current" ? "border-primary/45 bg-primary/10" : isInspected ? "border-foreground/35 bg-muted/60" : "border-transparent hover:border-border hover:bg-muted/40"}`}
                onClick={() => onInspect(node)}
                aria-current={state === "current" ? "step" : undefined}
                data-execution-node-state={state}
                data-inspected={isInspected ? "true" : "false"}
              >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${state === "completed" ? "bg-success/15 text-success" : state === "current" ? "bg-primary text-primary-foreground" : state === "blocked" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>{state === "completed" ? "✓" : index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{node.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{stateLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function TaskWorkspacePlanSection({
  label,
  graphPlan,
  isGraphPlanPending,
  pageData,
  commandCenter,
  plan,
  planGenerationStatus,
  canAcceptPlan,
  acceptPlanError,
  generationUserInstruction,
  runtimeEvents,
  liveActivity = [],
  currentExecution,
  onGeneratePlan,
  onApplyPlan,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
  onAcceptResult,
  isAcceptingResult = false,
  acceptResultError,
  onEditBrief,
}: TaskWorkspacePlanSectionProps) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [submittedRevisionInstruction, setSubmittedRevisionInstruction] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<PlanNodeDataModel | null>(null);
  const followUpComposerRef = useRef<HTMLTextAreaElement>(null);
  const [graphMode, setGraphMode] = useState<"full" | "compact">("full");
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const consoleView = useMemo(
    () => createTaskWorkspaceExecutionConsoleView({
      pageData,
      graphPlan,
      selectedNode,
      copy,
    }),
    [pageData, graphPlan, selectedNode, copy],
  );
  const stateMessage =
    consoleView.states.errorMessage ??
    (consoleView.states.isPermissionLimited
      ? consoleView.task.runnabilitySummary
      : null) ??
    (consoleView.states.isStale
      ? consoleView.states.treatment.guidance
      : null) ??
    (planGenerationStatus === "generating"
      ? (copy.generatingFreshPlan ?? "Generating a fresh plan. The graph will update when the run completes.")
      : null);
  const recoveryActions = pageData.reconciliation?.repairActions ?? [];
  const recoveryIssue = pageData.reconciliation?.issues.find((issue) => issue.severity === "error") ?? null;
  const recoveryCurrentNodeId = pageData.reconciliation?.currentNodeId ?? undefined;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const isPlanAccepted = plan?.status === "accepted";
  const hasGraphExecutionStarted = hasStartedGraphExecution(graphPlan);
  const hasTaskCompleted = isCompletedTaskStatus(pageData.task.status) || hasCompletedGraphExecution(graphPlan);
  useEffect(() => {
    setGraphMode((currentMode) => derivePreferredGraphMode({
      currentMode,
      isGeneratingPlan,
      hasGraphExecutionStarted,
      hasTaskCompleted,
    }));
  }, [hasGraphExecutionStarted, hasTaskCompleted, isGeneratingPlan]);
  useEffect(() => {
    setSubmittedRevisionInstruction(null);
  }, [plan?.id, plan?.revision]);
  const currentOperationNode = consoleView.nodeDetail.currentNode;
  const taskPrimaryAction = pageData.task.executionSummary?.primaryAction ?? null;
  const primaryActionNodeId = graphNodeIdForAction(taskPrimaryAction, pageData, graphPlan);
  const primaryActionDispatch = taskPrimaryAction
    ? dispatchInputForPrimaryAction(taskPrimaryAction, primaryActionNodeId)
    : null;
  const shouldUseTaskPrimaryAction = Boolean(
    isPlanAccepted &&
    !hasTaskCompleted &&
    taskPrimaryAction?.enabled &&
    taskPrimaryAction.type !== "none" &&
    taskPrimaryAction.type !== "start"
  );
  const hasCurrentOperationControls = Boolean(currentOperationNode?.checkpoint) && hasNodeActionPayload(currentOperationNode) && !consoleView.nodeDetail.disabledActionReason;
  const shouldShowCurrentOperation = Boolean(currentOperationNode && (hasCurrentOperationControls || currentOperationNode.status === "blocked"));
  const persistedGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const visibleGenerationInstruction = submittedRevisionInstruction ?? persistedGenerationInstruction;
  const commandCenterScopeKey = pageData.task.currentWorkBlock?.id ?? pageData.task.id;
  const currentOperationAction = useActionSpecRenderConfig({
    node: currentOperationNode,
    disabledActionReason: consoleView.nodeDetail.disabledActionReason,
    onDispatchExecutionAction,
    onSubmitCheckpointAction,
  });
  const apiCurrentOperationSpec = currentExecution?.ui?.currentOperationSpec ?? null;
  const commandCenterActionHandlers = useMemo(() => ({
    "submit-checkpoint": async (params: Record<string, unknown>) => {
      if (!onSubmitCheckpointAction) throw new Error("Checkpoint actions are not available for this view.");
      const checkpointId = typeof params.checkpointId === "string"
        ? params.checkpointId
        : currentExecution?.checkpoint?.id;
      const actionId = typeof params.actionId === "string" ? params.actionId : null;
      if (!checkpointId || !actionId) throw new Error("Checkpoint action payload is incomplete.");
      const rawValues = (params.values ?? {}) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(rawValues).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
      ) as Record<string, string>;
      const payloadValue = Object.values(values)[0];
      return onSubmitCheckpointAction({
        checkpointId,
        action: actionId as SubmitCheckpointActionInput["action"],
        ...(payloadValue ? { payload: payloadValue } : {}),
      });
    },
  }), [currentExecution?.checkpoint?.id, onSubmitCheckpointAction]);
  const currentOperationSpec = apiCurrentOperationSpec ?? currentOperationAction.spec;
  const currentOperationHandlers = useMemo(() => ({
    ...commandCenterActionHandlers,
    ...currentOperationAction.handlers,
  }), [commandCenterActionHandlers, currentOperationAction.handlers]);
  const operationState = resolveTaskWorkspaceOperationState({
    plan,
    planGenerationStatus,
    canAcceptPlan,
    acceptPlanError,
    generationUserInstruction,
    graphPlan,
    pageData,
    currentNode: currentOperationNode,
    selectedNode,
    hasTaskCompleted,
    hasGraphExecutionStarted,
    hasCurrentOperationControls,
    shouldShowCurrentOperation: shouldShowCurrentOperation && Boolean(currentOperationNode),
    currentOperationSpec,
    currentOperationHandlers,
    onCurrentOperationStateChange: currentOperationAction.onStateChange,
    shouldUseTaskPrimaryAction,
    taskPrimaryAction,
    runtimeEvents,
  });
  const displayState = deriveTaskWorkspaceDisplayState({
    pageData,
    graphPlan,
    operationState,
    currentNode: currentOperationNode,
    inspectedNode: selectedNode,
  });
  const focusNodeActions = (nodeId?: string) => {
    if (!nodeId) return;

    const actionsPanel = document.getElementById("task-workspace-node-actions");
    if (typeof actionsPanel?.scrollIntoView === "function") {
      actionsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  const planReviewDecisionPanel = plan && graphPlan ? (
    <PlanReviewDecisionPanel
      copy={copy}
      plan={plan}
      graphPlan={graphPlan}
      canAcceptPlan={canAcceptPlan}
      isGeneratingPlan={isGeneratingPlan}
      visibleGenerationInstruction={visibleGenerationInstruction}
      acceptPlanError={acceptPlanError}
      revisionInstruction={regenerationInstruction}
      selectedNode={selectedNode}
      onInstructionChange={setRegenerationInstruction}
      onAcceptPlan={() => void onApplyPlan(plan)}
      onRevisePlan={(selectedNodeId) => {
        const userInstruction = regenerationInstruction.trim();
        setSubmittedRevisionInstruction(userInstruction || null);
        setRegenerationInstruction("");
        onGeneratePlan({ userInstruction, selectedNodeId });
      }}
    />
  ) : null;

  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className={displayState.layout === "result_focus"
        ? "relative flex flex-col overflow-visible rounded-3xl border border-border/80 bg-background/70 xl:min-h-0 xl:flex-1 xl:overflow-y-auto"
        : "relative flex flex-col overflow-visible rounded-3xl border border-border/80 bg-background/70 xl:min-h-0 xl:flex-1 xl:overflow-hidden"}
      data-workspace-layout={displayState.layout}
      data-workspace-primary-surface={displayState.primarySurface}
      data-workspace-primary-action={displayState.primaryAction}
    >
      {stateMessage ? (
        <div className="mx-4 mt-4 rounded-xl border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning-foreground" role="status">
          {stateMessage}
        </div>
      ) : null}
      {recoveryIssue ? (
        <div className="mx-4 mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <p className="font-semibold">{recoveryIssue.message}</p>
          {recoveryActions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recoveryActions.map((action) => (
                <Button key={action.type} type="button" size="sm" variant={recoveryActionButtonVariant(action.type)} disabled={!action.enabled} onClick={() => focusNodeActions(recoveryCurrentNodeId)}>
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {displayState.panels.stageBar ? <StageBarCard stage={displayState.stage} displayMode={displayState.mode} /> : null}
      {displayState.layout === "brief_focus" ? (
        displayState.mode === "planning" ? (
          <PlanGenerationProgressPanel />
        ) : (
          <PlanSetupPanel
            readiness={displayState.readiness}
            pageData={pageData}
            onGeneratePlan={() => onGeneratePlan()}
            onEditBrief={() => onEditBrief?.()}
          />
        )
      ) : displayState.layout === "result_focus" ? (
        <div className="min-h-[560px] flex-1 p-4 xl:min-h-0">
          <TaskWorkspaceInspector
            key={commandCenterScopeKey}
            taskId={pageData.task.id}
            consoleView={consoleView}
            commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
            commandCenterActionHandlers={commandCenterActionHandlers}
            runtimeEvents={runtimeEvents}
            liveActivity={liveActivity}
            currentExecution={currentExecution}
            showHeader={false}
            operationPlacement="after"
            copy={copy}
            onAction={focusNodeActions}
            operationPanel={(
              <div className="space-y-4 border-t border-border/70 pt-4">
                {displayState.panels.resultReview && displayState.resultReview ? <ResultReviewCard review={displayState.resultReview} onAcceptResult={onAcceptResult} onRequestChanges={() => followUpComposerRef.current?.focus()} isAcceptingResult={isAcceptingResult} acceptResultError={acceptResultError} /> : null}
                {displayState.panels.followUpComposer ? <FollowUpComposerCard textareaRef={followUpComposerRef} /> : null}
              </div>
            )}
          />
        </div>
      ) : displayState.mode === "reviewing_plan" ? (
        <div className="grid min-h-[560px] flex-1 gap-3 overflow-y-auto p-3 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <section aria-label={copy.executionFlow ?? "Execution flow"} className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/70 xl:min-h-0">
            <TaskWorkspacePlanContent
              label={label}
              graphPlan={graphPlan}
              isGraphPlanPending={isGraphPlanPending}
              plan={plan}
              acceptPlanError={null}
              planWorkbenchMode="review"
              planGenerationStatus={planGenerationStatus}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
              onGeneratePlan={() => onGeneratePlan()}
              onSelectedNodeChange={setSelectedNode}
            />
          </section>
          {planReviewDecisionPanel}
        </div>
      ) : displayState.mode === "ready_to_run" && displayState.runPreview && !hasGraphExecutionStarted ? (
        <div className="grid min-h-[560px] flex-1 gap-4 overflow-y-auto p-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch xl:overflow-hidden">
          <section aria-label={copy.acceptedPlanAria} className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/70 xl:h-full xl:min-h-0" data-testid="accepted-plan-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-card/70 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-lg font-semibold text-foreground">{copy.acceptedPlanTitle}</h2>
                  <Badge variant="secondary">{copy.acceptedPlanBadge}</Badge>
                  <Badge variant="outline">{displayState.runPreview.planVersionLabel}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{copy.acceptedPlanDescription}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{displayState.runPreview.stepCount} {copy.stepsUnit}</span>
                {displayState.runPreview.estimatedMinutes ? <span>· {copy.launchAbout} {displayState.runPreview.estimatedMinutes} {copy.launchMinutes}</span> : null}
                <span>· {displayState.runPreview.expectedStops.length} {copy.launchStopsShort}</span>
              </div>
            </div>
            <div className="min-h-[32rem] flex-1 xl:min-h-0" data-plan-graph-height-contract="fill">
              <TaskWorkspacePlanContent
                label={label}
                graphPlan={graphPlan}
                isGraphPlanPending={isGraphPlanPending}
                plan={plan}
                acceptPlanError={null}
                planWorkbenchMode="accepted"
                planGenerationStatus={planGenerationStatus}
                graphMode={graphMode}
                onGraphModeChange={setGraphMode}
                onGeneratePlan={() => onGeneratePlan()}
                onSelectedNodeChange={setSelectedNode}
              />
            </div>
            {selectedNode ? (
              <details className="shrink-0 border-t border-border bg-card/65">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">{copy.inspectedNodeLabel}: {selectedNode.title}</summary>
                <div className="border-t border-border/60 p-3"><PlanNodeDetailCard node={selectedNode} copy={copy} /></div>
              </details>
            ) : null}
          </section>
          <RunLaunchPanel
            launch={displayState.runPreview}
            onStart={() => void onDispatchExecutionAction({ action: "start_manual" })}
            onEditTask={onEditBrief}
          />
        </div>
      ) : displayState.mode === "running" && displayState.runningExecution && graphPlan ? (
        <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden">
          <ExecutionFocusHeader view={displayState.runningExecution} workState={displayState.workState} copy={copy} />
          <div className="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[minmax(17rem,0.42fr)_minmax(36rem,1.58fr)]">
            <ExecutionNavigator
              graphPlan={graphPlan}
              view={displayState.runningExecution}
              inspectedNode={selectedNode}
              copy={copy}
              onInspect={setSelectedNode}
              onReturnToCurrent={() => setSelectedNode(null)}
            />
            <TaskWorkspaceInspector
              key={commandCenterScopeKey}
              taskId={pageData.task.id}
              consoleView={consoleView}
              commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
              commandCenterActionHandlers={commandCenterActionHandlers}
              runtimeEvents={runtimeEvents}
              liveActivity={liveActivity}
              currentExecution={currentExecution}
              isExecutionRunning
              executionOutputState={displayState.runningExecution.outputState}
              copy={copy}
              onAction={focusNodeActions}
              operationPanel={operationState.status !== "execution-running" ? (
                <TaskWorkspaceOperationPanel
                  taskId={pageData.task.id}
                  state={operationState}
                  workState={displayState.workState}
                  copy={copy}
                  onGeneratePlan={() => onGeneratePlan()}
                  onStartPlan={() => void onDispatchExecutionAction({ action: "start_manual" })}
                  onRestartPlan={() => void onDispatchExecutionAction({ action: "restart_from_beginning" })}
                  onTaskPrimaryAction={primaryActionDispatch ? () => void onDispatchExecutionAction(primaryActionDispatch) : undefined}
                />
              ) : null}
            />
          </div>
        </div>
      ) : (
        <div className={graphMode === "compact"
          ? "grid min-h-[560px] flex-1 gap-4 p-4 xl:min-h-0 xl:grid-cols-[minmax(0,0.42fr)_minmax(36rem,1.58fr)]"
          : "grid min-h-[560px] flex-1 gap-4 p-4 xl:min-h-0 xl:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.68fr)]"}>
          <section
            aria-label={copy.executionFlow ?? "Execution flow"}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background/70"
          >
            <div className="min-h-0 flex-1">
              <TaskWorkspacePlanContent
                label={label}
                graphPlan={graphPlan}
                isGraphPlanPending={isGraphPlanPending}
                plan={plan}
                acceptPlanError={acceptPlanError}
                planGenerationStatus={planGenerationStatus}
                graphMode={graphMode}
                onGraphModeChange={setGraphMode}
                onGeneratePlan={() => onGeneratePlan()}
                onSelectedNodeChange={setSelectedNode}
              />
              {displayState.panels.planReviewSummary || displayState.panels.runPreview ? (
                <div className="space-y-3 border-t border-border bg-card/65 p-3">
                  {displayState.panels.planReviewSummary && displayState.planReviewSummary ? <PlanReviewSummaryCard summary={displayState.planReviewSummary} /> : null}
                </div>
              ) : null}
            </div>
            {selectedNode && displayState.panels.selectedNodeDetails ? (
              <div className="shrink-0 border-t border-border bg-card/65 p-3">
                <PlanNodeDetailCard node={selectedNode} copy={copy} />
              </div>
            ) : null}
          </section>
          <TaskWorkspaceInspector
            key={commandCenterScopeKey}
            taskId={pageData.task.id}
            consoleView={consoleView}
            commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
            commandCenterActionHandlers={commandCenterActionHandlers}
            runtimeEvents={runtimeEvents}
            liveActivity={liveActivity}
            currentExecution={currentExecution}
            isPlanCompact={graphMode === "compact"}
            copy={copy}
            onAction={focusNodeActions}
            operationPanel={(
              <div className="space-y-2">
                {displayState.panels.operationPanel || hasGraphExecutionStarted ? (
                  <TaskWorkspaceOperationPanel
                    taskId={pageData.task.id}
                    state={operationState}
                    workState={displayState.workState}
                    copy={copy}
                    onGeneratePlan={() => onGeneratePlan()}
                    onStartPlan={() => void onDispatchExecutionAction({ action: "start_manual" })}
                    onRestartPlan={() => void onDispatchExecutionAction({ action: "restart_from_beginning" })}
                    onTaskPrimaryAction={primaryActionDispatch ? () => void onDispatchExecutionAction(primaryActionDispatch) : undefined}
                  />
                ) : null}
                {displayState.panels.resultReview && displayState.resultReview ? <ResultReviewCard review={displayState.resultReview} onAcceptResult={onAcceptResult} onRequestChanges={() => followUpComposerRef.current?.focus()} isAcceptingResult={isAcceptingResult} acceptResultError={acceptResultError} /> : null}
                {displayState.panels.followUpComposer ? <FollowUpComposerCard textareaRef={followUpComposerRef} /> : null}
              </div>
            )}
          />
        </div>
      )}
    </section>
  );
}
