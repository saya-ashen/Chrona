"use client";

import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import { Badge, Button } from "@shared/ui";
import type { RunningExecutionView, TaskWorkspaceDisplayState } from "../model/task-workspace-interaction";
import type { WorkspaceCopy } from "./task-workspace-plan-utils";

function executionNodeState(
  node: PlanNodeDataModel,
  view: RunningExecutionView,
) {
  if (node.id === view.currentStep?.id) return "current" as const;
  if (node.status === "done" || node.status === "completed")
    return "completed" as const;
  if (node.status === "blocked" || node.status === "failed")
    return "blocked" as const;
  if (
    node.status === "waiting" ||
    node.status === "waiting_for_user" ||
    node.status === "waiting_for_approval"
  )
    return "waiting" as const;
  return "upcoming" as const;
}

// This header maps the complete runtime attention state into one compact control surface.
// eslint-disable-next-line complexity
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
  const completedPercent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
  const needsAttention =
    workState.state === "waiting_for_input" ||
    workState.state === "waiting_for_approval";
  return (
    <section
      aria-label={copy.executionFocusAria ?? "Current execution focus"}
      className={
        needsAttention
          ? "border-b border-warning/40 bg-warning/10 px-4 py-4"
          : "border-b border-primary/25 bg-primary-soft/20 px-4 py-4"
      }
      data-testid="execution-focus-header"
      data-current-step-id={view.currentStep?.id ?? ""}
    >
      <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {needsAttention ? null : (
              <span
                className="relative flex size-3"
                aria-label="Execution running"
              >
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/45 motion-reduce:animate-none" />
                <span className="relative inline-flex size-3 rounded-full bg-primary" />
              </span>
            )}
            <Badge variant={needsAttention ? "secondary" : "default"}>
              {workState.label}
            </Badge>
            {view.currentStep?.ordinal ? (
              <span className="text-xs font-medium text-muted-foreground">
                {copy.executionStep ?? "Step"} {view.currentStep.ordinal}{" "}
                {copy.executionOf ?? "of"} {progress.total}
              </span>
            ) : null}
            {view.currentStep?.executorLabel ? (
              <Badge variant="outline">{view.currentStep.executorLabel}</Badge>
            ) : null}
          </div>
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {view.currentStep?.label ??
                copy.executionStarting ??
                "Starting execution"}
            </h2>
            {view.currentStep?.objective ? (
              <p className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground">
                {view.currentStep.objective}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {progress.completed} {copy.executionCompletedShort ?? "completed"}
            </span>
            {progress.active > 0 ? (
              <span>
                {progress.active} {copy.executionActiveShort ?? "running"}
              </span>
            ) : null}
            {progress.waiting > 0 ? (
              <span>
                {progress.waiting} {copy.executionWaitingShort ?? "waiting"}
              </span>
            ) : null}
            {progress.blocked > 0 ? (
              <span>
                {progress.blocked} {copy.executionBlockedShort ?? "blocked"}
              </span>
            ) : null}
            <span>
              {progress.remaining} {copy.executionRemainingShort ?? "remaining"}
            </span>
            <span>{completedPercent}%</span>
          </div>
        </div>
    </section>
  );
}

// The navigator keeps step state, accessibility labels, and inspection controls co-located.
// eslint-disable-next-line max-lines-per-function, complexity
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
  const inspectingOther = Boolean(
    inspectedNode && inspectedNode.id !== view.currentStep?.id,
  );
  return (
    <section
      aria-label={copy.executionNavigatorAria ?? "Execution navigator"}
      className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background/75"
      data-testid="execution-navigator"
    >
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground">
              {copy.executionNavigatorTitle ?? "Execution progress"}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {view.progress.completed}/{view.progress.total}{" "}
              {copy.executionStepsComplete ?? "steps complete"}
            </p>
          </div>
          {inspectingOther ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReturnToCurrent}
            >
              {copy.returnToCurrentStep ?? "Return to current step"}
            </Button>
          ) : null}
        </div>
        {inspectingOther ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {copy.inspectingStep ?? "Inspecting"}:{" "}
            <span className="font-medium text-foreground">
              {inspectedNode?.title}
            </span>{" "}
            · {copy.executionCurrentlyOn ?? "Execution is currently on"}:{" "}
            <span className="font-medium text-foreground">
              {view.currentStep?.label}
            </span>
          </p>
        ) : null}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {/* Each row maps the full execution-state vocabulary to accessible labels and tones. */}
        {/* eslint-disable-next-line complexity */}
        {graphPlan.nodes.map((node, index) => {
          const state = executionNodeState(node, view);
          const isInspected = inspectedNode?.id === node.id;
          const stateLabel =
            state === "current"
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
                className={`relative flex w-full items-start gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors ${state === "current" ? "border-primary/45 bg-primary/10 shadow-sm" : isInspected ? "border-foreground/35 bg-muted/60" : "border-transparent hover:border-border hover:bg-muted/40"}`}
                onClick={() => onInspect(node)}
                aria-current={state === "current" ? "step" : undefined}
                data-execution-node-state={state}
                data-inspected={isInspected ? "true" : "false"}
              >
                {state === "current" ? (
                  <span
                    className="absolute inset-y-0 left-0 w-0.5 animate-pulse bg-primary motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={`relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${state === "completed" ? "bg-success/15 text-success" : state === "current" ? "bg-primary text-primary-foreground" : state === "blocked" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
                >
                  {state === "current" ? (
                    <span
                      className="size-3 animate-spin rounded-full border-2 border-primary-foreground/35 border-t-primary-foreground motion-reduce:animate-none"
                      aria-label="Step running"
                    />
                  ) : state === "completed" ? (
                    "✓"
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {node.title}
                  </span>
                  <span
                    className={`mt-0.5 block text-xs ${state === "current" ? "font-medium text-primary" : "text-muted-foreground"}`}
                  >
                    {stateLabel}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { ExecutionFocusHeader, ExecutionNavigator };
