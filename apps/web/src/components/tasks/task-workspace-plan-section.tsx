"use client";

import type { ReactNode } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import { TaskWorkspaceExecutionConsole } from "./task-workspace-execution-console";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import { createTaskWorkspaceExecutionConsoleView, type TaskExecutionDispatchResult } from "./task-workspace-query";
import type { TaskPageData, TaskPlanGenerationStatus } from "./task-workspace-types";
import { useTaskWorkspacePlanSectionState } from "./use-task-workspace-plan-section-state";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskWorkspacePlanSectionProps = {
  label: string;
  topContent: ReactNode;
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
  topContent,
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
    <TaskWorkspaceExecutionConsole
      topContent={topContent}
      graphContent={(
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
      )}
      consoleView={consoleView}
      selectedPlanNodes={selectedPlanNodes}
      graphPlan={graphPlan}
      onFocusNodeActions={focusNodeActions}
      onDispatchExecutionAction={onDispatchExecutionAction}
    />
  );
}
