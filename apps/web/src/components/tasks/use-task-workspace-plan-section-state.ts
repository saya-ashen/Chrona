import { useCallback, useEffect, useState } from "react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";

export function useTaskWorkspacePlanSectionState(graphPlan: TaskPlanGraphPlan | null) {
  const [selectedPlanNode, setSelectedPlanNode] = useState<PlanNodeDataModel | null>(null);
  const [selectedPlanNodes, setSelectedPlanNodes] = useState<PlanNodeDataModel[]>([]);

  const handleSelectedPlanNodeChange = useCallback((node: PlanNodeDataModel | null, nodes: PlanNodeDataModel[]) => {
    setSelectedPlanNode((current) => (current?.id === node?.id ? current : node));
    setSelectedPlanNodes((current) => (current === nodes ? current : nodes));
  }, []);

  useEffect(() => {
    if (!graphPlan) {
      setSelectedPlanNode(null);
      setSelectedPlanNodes([]);
    }
  }, [graphPlan]);

  return {
    selectedPlanNode,
    selectedPlanNodes,
    handleSelectedPlanNodeChange,
  };
}
