import { useEffect, useState } from "react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";

export function useTaskWorkspacePlanSectionState(graphPlan: TaskPlanGraphPlan | null) {
  const [selectedPlanNode, setSelectedPlanNode] = useState<PlanNodeDataModel | null>(null);
  const [selectedPlanNodes, setSelectedPlanNodes] = useState<PlanNodeDataModel[]>([]);

  useEffect(() => {
    if (!graphPlan) {
      setSelectedPlanNode(null);
      setSelectedPlanNodes([]);
    }
  }, [graphPlan]);

  const handleSelectedPlanNodeChange = (node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => {
    setSelectedPlanNode(node);
    setSelectedPlanNodes(nodes);
  };

  return {
    selectedPlanNode,
    selectedPlanNodes,
    handleSelectedPlanNodeChange,
  };
}
