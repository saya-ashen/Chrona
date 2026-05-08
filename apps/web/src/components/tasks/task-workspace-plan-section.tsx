"use client";

import type { ReactNode } from "react";
import { DEFAULT_GRAPH_COPY } from "@/components/task/plan/task-plan-graph/constants";
import { TaskPlanGraphInspector } from "@/components/task/plan/task-plan-graph/inspector";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
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
}: TaskWorkspacePlanSectionProps) {
  const {
    graphPanelHeight,
    topSectionHeight,
    selectedPlanNode,
    selectedPlanNodes,
    leftColumnRef,
    topSectionRef,
    planAreaRef,
    handleSelectedPlanNodeChange,
  } = useTaskWorkspacePlanSectionState(acceptPlanError, graphPlan);

  return (
    <>
      <div ref={leftColumnRef} className="space-y-4 xl:flex xl:min-h-0 xl:flex-col xl:space-y-0 xl:gap-4">
        <div ref={topSectionRef} className="relative xl:shrink-0">
          {topContent}
        </div>

        <TaskWorkspacePlanContent
          label={label}
          graphPlan={graphPlan}
          plan={plan}
          graphPanelHeight={graphPanelHeight}
          canAcceptPlan={canAcceptPlan}
          isAcceptingPlan={isAcceptingPlan}
          acceptPlanError={acceptPlanError}
          planGenerationStatus={planGenerationStatus}
          planAreaRef={planAreaRef}
          onAcceptPlan={onAcceptPlan}
          onGeneratePlan={onGeneratePlan}
          onSelectedNodeChange={handleSelectedPlanNodeChange}
        />
      </div>

      <aside
        className="min-w-0 space-y-4 xl:flex xl:min-h-0 xl:flex-col xl:self-stretch xl:overflow-hidden"
        style={topSectionHeight > 0 ? { paddingTop: `${topSectionHeight + 16}px` } : undefined}
      >
        <TaskPlanGraphInspector node={selectedPlanNode} graphCopy={DEFAULT_GRAPH_COPY} nodes={selectedPlanNodes} />
      </aside>
    </>
  );
}
