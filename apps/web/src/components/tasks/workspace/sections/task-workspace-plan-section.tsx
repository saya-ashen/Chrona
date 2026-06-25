"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@chrona/i18n/react";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { TaskPageData, TaskPlanGenerationStatus, WorkspaceActivityItem } from "../model/task-workspace-types";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";

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


function isCompletedTaskStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? "";
  return normalized === "done" || normalized === "completed" || normalized === "complete";
}

function hasCompletedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  const nodes = graphPlan?.nodes ?? [];
  return nodes.length > 0 && nodes.every((node) => isCompletedGraphNode(node.status));
}


type TaskWorkspacePlanSectionProps = {
  label: string;
  commandCenterCopy?: unknown;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  pageData: TaskPageData;
  commandCenter?: unknown;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  generationUserInstruction?: string | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  liveActivity?: WorkspaceActivityItem[];
  currentExecution?: unknown;
  onGeneratePlan: (request?: PlanGenerationRequest) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onDispatchExecutionAction: (...args: never[]) => unknown;
  onSubmitCheckpointAction?: (...args: never[]) => unknown;
};

export function TaskWorkspacePlanSection({
  label,
  graphPlan,
  isGraphPlanPending,
  pageData,
  plan,
  planGenerationStatus,
  acceptPlanError,
  onGeneratePlan,
}: TaskWorkspacePlanSectionProps) {
  const [graphMode, setGraphMode] = useState<"full" | "compact">("full");
  const { messages } = useI18n();
  const copy = messages.components?.taskWorkspace ?? {};
  const stateMessage = planGenerationStatus === "generating"
    ? (copy.generatingFreshPlan ?? "Generating a fresh plan. The graph will update when the run completes.")
    : null;
  const recoveryActions = pageData.reconciliation?.repairActions ?? [];
  const recoveryIssue = pageData.reconciliation?.issues.find((issue) => issue.severity === "error") ?? null;
  const isGeneratingPlan = planGenerationStatus === "generating";
  const hasGraphExecutionStarted = hasStartedGraphExecution(graphPlan);
  const hasTaskCompleted = isCompletedTaskStatus(pageData.task.status) || hasCompletedGraphExecution(graphPlan);
  useEffect(() => {
    if (isGeneratingPlan) {
      setGraphMode("full");
      return;
    }

    if (hasGraphExecutionStarted || hasTaskCompleted) {
      setGraphMode("compact");
    }
  }, [hasGraphExecutionStarted, hasTaskCompleted, isGeneratingPlan]);


  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className="relative flex flex-col overflow-visible rounded-[1.75rem] border border-border/80 bg-muted/20 p-2 shadow-[0_18px_60px_rgba(15,23,42,0.06)] xl:min-h-0 xl:flex-1 xl:overflow-hidden"
    >
      {stateMessage ? (
        <div
          className="relative mb-2 rounded-xl border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-foreground shadow-sm"
          role="status"
        >
          {stateMessage}
        </div>
      ) : null}

      {recoveryIssue ? (
        <div
          className="relative mb-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          <div className="font-semibold">{copy.recoveryNeeded ?? "Recovery needed"}</div>
          <div className="mt-0.5">{recoveryIssue.message}</div>
        </div>
      ) : null}

      <section
        aria-label={copy.executionFlow ?? "Execution flow"}
        className="min-h-[680px] min-w-0 flex-1 overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/75 xl:min-h-0"
      >
        <TaskWorkspacePlanContent
          label={label}
          graphPlan={graphPlan}
          isGraphPlanPending={isGraphPlanPending}
          plan={plan}
          acceptPlanError={acceptPlanError}
          planGenerationStatus={planGenerationStatus}
          graphMode={graphMode}
          onGraphModeChange={setGraphMode}
          onGeneratePlan={onGeneratePlan}
        />
      </section>
    </section>
  );
}
