"use client";

import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { TaskWorkspaceExecutionOverview } from "../execution/task-workspace-execution-overview";
import { TaskWorkspaceNodeDetailPanel } from "../execution/task-workspace-node-detail-panel";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import { createTaskWorkspaceExecutionConsoleView, type TaskExecutionDispatchResult } from "../model/task-workspace-query";
import type { TaskPageData, TaskPlanGenerationStatus } from "../model/task-workspace-types";
import { useTaskWorkspacePlanSectionState } from "../hooks/use-task-workspace-plan-section-state";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskWorkspacePlanSectionProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan: boolean;
  isAcceptingPlan: boolean;
  acceptPlanError: string | null;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void;
  onDispatchExecutionAction: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
};

export function TaskWorkspacePlanSection({
  label,
  graphPlan,
  pageData,
  plan,
  planGenerationStatus,
  canAcceptPlan,
  isAcceptingPlan,
  acceptPlanError,
  onAcceptPlan,
  onGeneratePlan,
  onDispatchExecutionAction,
}: TaskWorkspacePlanSectionProps) {
  const {
    selectedPlanNode,
    selectedPlanNodes,
    handleSelectedPlanNodeChange,
  } = useTaskWorkspacePlanSectionState(graphPlan);
  const consoleView = createTaskWorkspaceExecutionConsoleView({
    pageData,
    graphPlan,
    selectedNode: selectedPlanNode,
  });
  const stateMessage = consoleView.states.errorMessage
    ?? (consoleView.states.isPermissionLimited ? consoleView.task.runnabilitySummary : null)
    ?? (consoleView.states.isStale ? "Execution data may be stale. Refresh before acting on results." : null)
    ?? (planGenerationStatus === "generating" ? "Generating a fresh plan. The graph will update when the run completes." : null);
  const focusNodeActions = (nodeId?: string) => {
    if (nodeId && graphPlan) {
      const node = graphPlan.nodes.find((candidate) => candidate.id === nodeId) ?? null;
      if (node) {
        handleSelectedPlanNodeChange(node, [node]);
      }
    }

    document.getElementById("task-workspace-node-actions")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <section
      aria-label="Task execution workspace"
      className="min-h-0 rounded-[1rem] border border-border/35 bg-[linear-gradient(180deg,hsl(var(--muted)/0.12),transparent_18%),hsl(var(--background))] p-1"
    >
      {stateMessage ? (
        <div className="mb-1.5 rounded-xl border border-amber-300/45 bg-amber-50/70 px-3 py-2 text-sm text-amber-900" role="status">
          {stateMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 gap-1.5 xl:h-[calc(100dvh-6.25rem)] xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-h-0 gap-1.5 xl:grid-rows-[minmax(0,1fr)_200px]">
          <section aria-label="Execution flow" className="min-h-0 min-w-0">
            <TaskWorkspacePlanContent
              label={label}
              graphPlan={graphPlan}
              plan={plan}
              canAcceptPlan={canAcceptPlan}
              isAcceptingPlan={isAcceptingPlan}
              acceptPlanError={acceptPlanError}
              onAcceptPlan={onAcceptPlan}
              onSelectedNodeChange={handleSelectedPlanNodeChange}
            />
          </section>

          <TaskWorkspaceNodeDetailPanel
            detail={consoleView.nodeDetail}
            selectedNodes={selectedPlanNodes}
            onDispatchExecutionAction={onDispatchExecutionAction}
          />
        </div>

        <TaskWorkspaceExecutionOverview
          readiness={consoleView.readiness}
          latestResult={consoleView.latestResult}
          attention={consoleView.attention}
          artifacts={consoleView.artifacts}
          activity={consoleView.activity}
          onAction={focusNodeActions}
        />
      </div>
    </section>
  );
}
