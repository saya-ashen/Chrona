import { useCallback, useEffect, useState } from "react";
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

  const handleSelectedPlanNodeChange = useCallback((node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => {
    setSelectedPlanNode((current) => (current === node ? current : node));
    setSelectedPlanNodes((current) => (current === nodes ? current : nodes));
  }, []);

  return {
    selectedPlanNode,
    selectedPlanNodes,
    handleSelectedPlanNodeChange,
  };
}
