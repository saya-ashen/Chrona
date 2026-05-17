import { useCallback, useEffect, useState } from "react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";

export function useTaskWorkspacePlanSectionState(graphPlan: TaskPlanGraphPlan | null) {
  const [selectedPlanNode, setSelectedPlanNode] = useState<PlanNodeDataModel | null>(null);
  const [selectedPlanNodes, setSelectedPlanNodes] = useState<PlanNodeDataModel[]>([]);

  useEffect(() => {
    if (!graphPlan) {
      setSelectedPlanNode(null);
      setSelectedPlanNodes([]);
      return;
    }
  }, [graphPlan]);

  useEffect(() => {
    if (!graphPlan || !selectedPlanNode) return;

    const nextSelectedNode =
      graphPlan.nodes.find((node) => node.id === selectedPlanNode.id) ?? null;
    if (!nextSelectedNode) {
      setSelectedPlanNode(null);
      setSelectedPlanNodes([]);
      return;
    }

    setSelectedPlanNode(nextSelectedNode);
    setSelectedPlanNodes((current) => current.map((node) => (
      node.id === nextSelectedNode.id ? nextSelectedNode : node
    )));
  }, [graphPlan, selectedPlanNode]);

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
