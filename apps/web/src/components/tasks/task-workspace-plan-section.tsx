"use client";

import type { ReactNode } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import { DEFAULT_GRAPH_COPY } from "@/components/task/plan/task-plan-graph/constants";
import { TaskPlanGraphInspector } from "@/components/task/plan/task-plan-graph/inspector";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import type { TaskExecutionDispatchResult } from "./task-workspace-query";
import type { TaskPlanGenerationStatus } from "./task-workspace-types";
import { useTaskWorkspacePlanSectionState } from "./use-task-workspace-plan-section-state";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskWorkspacePlanSectionProps = {
  label: string;
  topContent: ReactNode;
  graphPlan: TaskPlanGraphPlan | null;
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
  topContent,
  graphPlan,
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

  return (
    <>
      <div className="space-y-3 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-3 xl:space-y-0">
        <div className="relative xl:shrink-0">
          {topContent}
        </div>

        <TaskWorkspacePlanContent
          label={label}
          graphPlan={graphPlan}
          plan={plan}
          canAcceptPlan={canAcceptPlan}
          isAcceptingPlan={isAcceptingPlan}
          acceptPlanError={acceptPlanError}
          planGenerationStatus={planGenerationStatus}
          onAcceptPlan={onAcceptPlan}
          onGeneratePlan={onGeneratePlan}
          onDispatchExecutionAction={onDispatchExecutionAction}
          onSelectedNodeChange={handleSelectedPlanNodeChange}
        />
      </div>

      <aside className="min-w-0 space-y-3 xl:flex xl:min-h-0 xl:flex-col xl:self-stretch xl:overflow-hidden">
        <TaskPlanGraphInspector
          node={selectedPlanNode}
          graphCopy={DEFAULT_GRAPH_COPY}
          nodes={selectedPlanNodes}
          onDispatchExecutionAction={onDispatchExecutionAction}
        />
      </aside>
    </>
  );
}
