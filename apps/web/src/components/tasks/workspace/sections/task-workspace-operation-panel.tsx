"use client";
import type { ReactNode } from "react";
import { deriveUserFacingFailure, type WorkStateView } from "@chrona/domain";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpecRenderer } from "@/components/tasks/workspace/catalog/spec-renderer";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { ProviderApprovalBanner } from "../../../../../../../features/execution-monitoring/ui/provider-approval-banner";
import type { TaskWorkspaceOperationState } from "../../../../../../../features/task-workspace";

type WorkspaceCopy = Record<string, string | undefined>;

type TaskWorkspaceOperationPanelProps = {
  taskId: string;
  state: TaskWorkspaceOperationState;
  workState: WorkStateView;
  copy: WorkspaceCopy;
  onGeneratePlan: () => void;
  onStartPlan: () => void;
  onRestartPlan?: () => void;
  onTaskPrimaryAction?: () => void;
  revisionPanel?: ReactNode;
};

function operationToneClass(tone: TaskWorkspaceOperationState["tone"]) {
  switch (tone) {
    case "success":
      return "border-success/30 bg-success/10";
    case "warning":
      return "border-warning/40 bg-warning/15";
    case "critical":
      return "border-destructive/40 bg-destructive/10";
    case "neutral":
      return "border-border/70 bg-background/80";
    case "info":
    default:
      return "border-primary/25 bg-primary-soft/25";
  }
}

function formatRuntimeEvent(event: TaskWorkspaceOperationState["runtimeEvents"][number]) {
  const value = event.event;
  switch (value.type) {
    case "assistant_text_delta":
      return `Assistant: ${value.text}`;
    case "reasoning_delta":
      return `Reasoning: ${value.text}`;
    case "tool_started":
      return `Tool: ${value.label}`;
    case "tool_completed":
      return value.error ? `Tool: ${value.label} failed` : `Tool: ${value.label} completed`;
    case "approval_required":
      return "Approval required";
    case "run_status":
      return `Status: ${value.message ?? value.status}`;
    case "raw_event":
      return value.message ? `Progress: ${value.message}` : `Event: ${value.rawEventType ?? "Runtime event"}`;
  }
}

function SelectedNodeCue({ node, copy }: { node: PlanNodeDataModel | null; copy: WorkspaceCopy }) {
  if (!node) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs">
      <div className="font-semibold text-muted-foreground">{copy.selectedNode ?? "Selected node"}</div>
      <div className="mt-0.5 font-medium text-foreground">{node.title}</div>
    </div>
  );
}

function taskActionButtonLabel(state: Extract<TaskWorkspaceOperationState, { status: "task-action" }>) {
  return state.taskPrimaryAction.label;
}

function taskActionButtonVariant(state: Extract<TaskWorkspaceOperationState, { status: "task-action" }>) {
  return state.tone === "critical" ? "destructive" : "default";
}

function stateHelpText(workState: WorkStateView) {
  if (workState.state === "waiting_for_input" || workState.state === "waiting_for_approval") return `Next: ${workState.nextActionLabel}`;
  if (workState.blocker) return `${workState.blocker.reason} · Scope: ${workState.blocker.scope}`;
  if (workState.currentNodeLabel) return `Current step: ${workState.currentNodeLabel}`;
  return workState.nextActionLabel;
}

function DecisionRecoveryCard({ workState }: { workState: WorkStateView }) {
  if (!["waiting_for_input", "waiting_for_approval", "blocked", "failed", "cancelled"].includes(workState.state)) return null;
  const failure = deriveUserFacingFailure({
    state: workState.state as "waiting_for_input" | "waiting_for_approval" | "blocked" | "failed" | "cancelled",
    reason: workState.blocker?.reason ?? null,
    scope: workState.blocker?.scope ?? null,
    currentNodeId: workState.currentNodeId,
    currentNodeLabel: workState.currentNodeLabel,
    diagnosticRef: workState.currentNodeId,
  });
  return (
    <div className="rounded-2xl border border-foreground/15 bg-background/75 px-3 py-3 text-sm" data-testid="current-operation-decision-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">{workState.label}</p>
          <p className="text-muted-foreground">{failure.summary}</p>
          <p className="text-muted-foreground">{stateHelpText(workState)}</p>
        </div>
        <Badge variant={failure.category === "approval" || failure.category === "input" ? "secondary" : "destructive"}>{failure.category}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="font-medium text-muted-foreground">Retained</dt><dd>{failure.retainedProgress.join(" ")}</dd></div>
        <div><dt className="font-medium text-muted-foreground">Retry from</dt><dd>{failure.retryFrom ?? "Current execution"}</dd></div>
        {failure.duplicateSideEffectRisk ? <div className="sm:col-span-2"><dt className="font-medium text-muted-foreground">Before retrying</dt><dd>{failure.duplicateSideEffectRisk}</dd></div> : null}
      </dl>
      {failure.technicalDetail ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Diagnostics</summary>
          <div className="mt-2 rounded-lg bg-muted/60 p-2 font-mono text-xs text-muted-foreground">
            {failure.technicalDetail}{failure.diagnosticRef ? ` · ${failure.diagnosticRef}` : ""}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function TaskWorkspaceOperationPanel({
  taskId,
  state,
  workState,
  copy,
  onGeneratePlan,
  onStartPlan,
  onRestartPlan,
  onTaskPrimaryAction,
  revisionPanel,
}: TaskWorkspaceOperationPanelProps) {
  const latestEvents = state.runtimeEvents.slice(-4).map(formatRuntimeEvent);
  const isRunning = state.status === "execution-running";
  return (
    <Card
      role="region"
      aria-label={copy.currentOperation ?? "Current operation"}
      className={`shrink-0 gap-3 rounded-[1.25rem] py-3 ${operationToneClass(state.tone)}`}
      data-operation-state={state.status}
    >
      <CardHeader className="gap-3 px-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 gap-3">
          {isRunning ? <span className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-label="Current operation running" /> : null}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{copy.currentOperation ?? "Current operation"}</p>
              {state.statusLabel ? <Badge variant="outline">{state.statusLabel}</Badge> : null}
            </div>
            <CardTitle className="text-base">{state.title}</CardTitle>
            <p className="max-w-3xl text-sm text-muted-foreground">{state.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {state.status === "plan-empty" ? (
            <Button type="button" onClick={onGeneratePlan}>{copy.generatePlan ?? "Generate plan"}</Button>
          ) : null}
          {state.status === "plan-generating" ? (
            <Button type="button" disabled>{copy.generating ?? "Generating..."}</Button>
          ) : null}
          {state.status === "plan-ready-to-run" ? (
            <>
              {state.hasGraphExecutionStarted ? (
                <Button type="button" variant="outline" onClick={onRestartPlan} disabled={!onRestartPlan}>{copy.restartPlanAction ?? "Restart from beginning"}</Button>
              ) : null}
              <Button type="button" onClick={onStartPlan}>{state.hasGraphExecutionStarted ? (copy.continuePlanAction ?? "Continue plan") : (copy.startPlanAction ?? "Start plan")}</Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-3">
        <DecisionRecoveryCard workState={workState} />
        <ProviderApprovalBanner taskId={taskId} />
        {state.status === "task-action" ? (
          <div className="flex flex-col gap-2 rounded-xl border border-destructive/25 bg-background/80 px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between" data-testid="current-operation-primary-action">
            <div className="min-w-0 text-xs">
              <p className="font-semibold text-destructive">{workState.state === "failed" || state.statusLabel === "run_failed" ? "Failed" : workState.label}</p>
              <p className="mt-0.5 line-clamp-2 text-muted-foreground">{state.description}</p>
            </div>
            <Button
              type="button"
              variant={taskActionButtonVariant(state)}
              size="sm"
              className="shrink-0 self-start rounded-xl px-4 shadow-sm sm:self-center"
              onClick={onTaskPrimaryAction}
              disabled={!onTaskPrimaryAction}
            >
              {taskActionButtonLabel(state)}
            </Button>
          </div>
        ) : null}
        {state.status === "plan-review" ? revisionPanel : null}
        {state.status === "execution-action" || state.status === "execution-blocked" ? (
          <SpecRenderer spec={state.operationSpec} handlers={state.actionHandlers} onStateChange={state.onActionStateChange} />
        ) : null}
        {latestEvents.length > 0 ? (
          <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs">
            <div className="font-semibold text-muted-foreground">{copy.liveEvents ?? "Live"}</div>
            <ul className="mt-1 space-y-1">
              {latestEvents.map((event, index) => <li key={`${event}-${index}`} className="text-foreground">{event}</li>)}
            </ul>
          </div>
        ) : null}
        {state.status !== "plan-review" ? <SelectedNodeCue node={state.selectedNode} copy={copy} /> : null}
        {state.status === "execution-completed" ? (
          <p className="text-xs text-muted-foreground">{copy.resultPlaceholder ?? "Result summary will appear here after the current node finishes."}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
