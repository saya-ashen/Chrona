import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_VIEWPORT_HEIGHT } from "@/components/task/plan/task-plan-graph/constants";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";

const GRAPH_SECTION_BOTTOM_GAP = 24;
const GRAPH_VIEWPORT_MAX_HEIGHT = 760;
const GRAPH_VIEWPORT_RATIO = 0.68;

export function useTaskWorkspacePlanSectionState(acceptPlanError: string | null, graphPlan: TaskPlanGraphPlan | null) {
  const [graphPanelHeight, setGraphPanelHeight] = useState(760);
  const [topSectionHeight, setTopSectionHeight] = useState(0);
  const [selectedPlanNode, setSelectedPlanNode] = useState<PlanNodeDataModel | null>(null);
  const [selectedPlanNodes, setSelectedPlanNodes] = useState<PlanNodeDataModel[]>([]);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const planAreaRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const topSection = topSectionRef.current;
    const planArea = planAreaRef.current;
    if (!topSection || !planArea || typeof ResizeObserver === "undefined") {
      return;
    }

    const measure = () => {
      const topRect = topSection.getBoundingClientRect();
      const planAreaRect = planArea.getBoundingClientRect();
      if (topRect.height <= 0) {
        return;
      }

      setTopSectionHeight((current) => (Math.abs(current - topRect.height) < 2 ? current : topRect.height));

      const viewportLimit = typeof window !== "undefined"
        ? Math.floor(Math.min(window.innerHeight * GRAPH_VIEWPORT_RATIO, GRAPH_VIEWPORT_MAX_HEIGHT))
        : GRAPH_VIEWPORT_MAX_HEIGHT;
      const availableViewportHeight = typeof window !== "undefined"
        ? Math.floor(window.innerHeight - planAreaRect.top - GRAPH_SECTION_BOTTOM_GAP)
        : GRAPH_VIEWPORT_MAX_HEIGHT;
      const errorHeight = acceptPlanError ? 36 : 0;
      const nextPanelHeight = Math.max(
        MIN_VIEWPORT_HEIGHT,
        Math.min(viewportLimit, availableViewportHeight - errorHeight),
      );

      setGraphPanelHeight((current) => (Math.abs(current - nextPanelHeight) < 2 ? current : nextPanelHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topSection);
    observer.observe(planArea);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [acceptPlanError]);

  return {
    graphPanelHeight,
    topSectionHeight,
    selectedPlanNode,
    selectedPlanNodes,
    leftColumnRef,
    topSectionRef,
    planAreaRef,
    handleSelectedPlanNodeChange,
  };
}
