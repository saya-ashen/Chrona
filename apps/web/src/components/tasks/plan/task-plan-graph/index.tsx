"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { X } from "lucide-react";
import {
  useEdgesState,
  useNodesState,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useI18n } from "@chrona/i18n/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AUTO_FULL_MODE_MIN_WIDTH,
  DEFAULT_GRAPH_COPY,
} from "./constants";
import { cn } from "@/lib/utils";
import {
  buildCompactViewModel,
  CompactFocusStack,
  CompactStageStrip,
} from "./compact-view";
import { TaskPlanGraphFrame } from "./frame";
import { useGraphLegend } from "./legend";
import { buildFlowLayout, syncNodeState, type FlowLayout } from "./layout";
import type {
  FlowGraphEdge,
  FlowGraphNode,
  GraphCopy,
  TaskPlanGraphMode,
  TaskPlanGraphPlan,
  TaskPlanGraphProps,
} from "./types";

export type {
  PlanEdgeDataModel,
  PlanGraphAnalytics,
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
  PlanNodeInteractionType,
  PlanEdgeKind,
  PlanNodeIntent,
  PlanNodeKind,
  PlanNodeStatus,
  TaskPlanGraphMode,
  TaskPlanGraphPlan,
  TaskPlanGraphProps,
} from "./types";

function GraphShell({
  graphCopy,
  layout,
  nodes,
  edges,
  planNodes,
  currentStepId,
  edgeLegend,
  nodeLegend,
  handleNodeClick,
  stopIfNodeButton,
  onCenterCurrentNode,
  onExpandGraph,
  onFitGraph,
  onZoomIn,
  onZoomOut,
  fillHeight = false,
  testId,
}: {
  graphCopy: GraphCopy;
  layout: FlowLayout;
  nodes: FlowGraphNode[];
  edges: FlowLayout["edges"];
  planNodes: TaskPlanGraphPlan["nodes"];
  currentStepId?: string | null;
  edgeLegend: ReturnType<typeof useGraphLegend>["edgeLegend"];
  nodeLegend: ReturnType<typeof useGraphLegend>["nodeLegend"];
  handleNodeClick: NodeMouseHandler<FlowGraphNode>;
  stopIfNodeButton: (event: MouseEvent<Element>) => void;
  onCenterCurrentNode: () => void;
  onExpandGraph: () => void;
  onFitGraph: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  fillHeight?: boolean;
  testId?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const currentNode = planNodes.find((node) => node.id === currentStepId)
    ?? planNodes.find((node) => node.status === "active" || node.status === "in_progress")
    ?? null;


  return (
    <div ref={shellRef} className={cn("relative min-w-0 max-w-full", fillHeight && "min-h-0 flex-1")}>
      <TaskPlanGraphFrame
        graphCopy={graphCopy}
        layout={layout}
        nodes={nodes}
        edges={edges}
        fillHeight={fillHeight}
        edgeLegend={edgeLegend}
        nodeLegend={nodeLegend}
        overview={null}
        handleNodeClick={handleNodeClick}
        handlePaneClick={() => undefined}
        handleNodeDragStart={stopIfNodeButton}
        handleNodeDrag={stopIfNodeButton}
        handleNodeDragStop={stopIfNodeButton}
        onCenterCurrentNode={onCenterCurrentNode}
        onExpandGraph={onExpandGraph}
        onFitGraph={onFitGraph}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        currentNodeId={currentNode?.id ?? null}
        testId={testId}
      />
    </div>
  );
}


export function TaskPlanGraph({
  plan,
  mode = "full",
  fillHeight = false,
  className,
  onSelectedNodeChange,
}: TaskPlanGraphProps) {
  const { messages } = useI18n();
  const graphCopyOverrides = messages.components?.taskPlanGraph ?? null;
  const graphCopySignature = JSON.stringify(graphCopyOverrides ?? {});
  const graphCopyRef = useRef<{ signature: string; value: GraphCopy } | null>(null);
  if (!graphCopyRef.current || graphCopyRef.current.signature !== graphCopySignature) {
    graphCopyRef.current = {
      signature: graphCopySignature,
      value: {
        ...DEFAULT_GRAPH_COPY,
        ...(graphCopyOverrides ?? {}),
      } as GraphCopy,
    };
  }
  const graphCopy = graphCopyRef.current.value;

  const [isFullDialogOpen, setIsFullDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [nodes, setNodes] = useNodesState<FlowGraphNode>([]);
  const [edges, setEdges] = useEdgesState<FlowGraphEdge>([]);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const observedContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);


  const adjustScroll = useCallback((leftRatio: number, topRatio: number) => {
    const scroll = graphRef.current?.querySelector<HTMLElement>("[data-testid='task-plan-graph-scroll']");
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, (scroll.scrollWidth - scroll.clientWidth) * leftRatio);
    scroll.scrollTop = Math.max(0, (scroll.scrollHeight - scroll.clientHeight) * topRatio);
  }, []);

  const handleZoomIn = useCallback(() => adjustScroll(0.5, 0.45), [adjustScroll]);
  const handleZoomOut = useCallback(() => adjustScroll(0, 0), [adjustScroll]);
  const handleFitGraph = useCallback(() => adjustScroll(0.5, 0.5), [adjustScroll]);
  const handleCenterCurrentNode = useCallback(() => adjustScroll(0.5, 0.35), [adjustScroll]);

  const { edgeLegend, nodeLegend } = useGraphLegend(graphCopy);
  const compact = useMemo(() => buildCompactViewModel(plan, graphCopy), [graphCopy, plan]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);


  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    onSelectedNodeChange?.(plan.nodes.find((planNode) => planNode.id === nodeId) ?? null, plan.nodes);
  }, [onSelectedNodeChange, plan.nodes]);

  const handleNodeClick = useCallback<NodeMouseHandler<FlowGraphNode>>(
    (event, node) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button[data-testid^='task-plan-node-']")) return;
      handleNodeSelect(node.id);
    },
    [handleNodeSelect],
  );

  const stopIfNodeButton = useCallback((event: MouseEvent<Element>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button[data-testid^='task-plan-node-']")) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (plan.state !== "ready" || plan.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (selectedNodeId && !plan.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [plan, selectedNodeId]);


  useEffect(() => {
    let active = true;

    if (plan.state !== "ready" || plan.nodes.length === 0) {
      setLayout(null);
      setNodes([]);
      setEdges([]);
      return () => {
        active = false;
      };
    }

    void buildFlowLayout({
      plan,
      selectedNodeId,
      graphCopy,
      onSelect: handleNodeSelect,
    }).then((nextLayout) => {
      if (!active) return;
      setLayout(nextLayout);
      setNodes(nextLayout.nodes);
      setEdges(nextLayout.edges);
    });

    return () => {
      active = false;
    };
  }, [graphCopy, handleNodeSelect, plan, selectedNodeId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      syncNodeState(current, {
        selectedNodeId,
        graphCopy,
        onSelect: handleNodeSelect,
        focusNodeIds: plan.analytics.reachableFromActiveIds,
      }),
    );
  }, [
    graphCopy,
    handleNodeSelect,
    plan.analytics.reachableFromActiveIds,
    selectedNodeId,
    setNodes,
  ]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    graphRef.current = node;
  }, []);

  const readContainerWidth = useCallback((element: HTMLElement | null): number => {
    if (!element) return 0;
    const direct =
      element.clientWidth || element.getBoundingClientRect().width || 0;
    if (direct > 0) return direct;
    const styled = Number.parseFloat(element.style.width || "0");
    if (Number.isFinite(styled) && styled > 0) return styled;
    return readContainerWidth(element.parentElement);
  }, []);

  const measureContainerWidth = useCallback((node: HTMLDivElement) => {
    const nextWidth = readContainerWidth(node);
    setContainerWidth((current) =>
      Math.abs(current - nextWidth) < 1 ? current : nextWidth,
    );
  }, [readContainerWidth]);

  const resolvedMode: Exclude<TaskPlanGraphMode, "auto"> =
    mode === "auto"
      ? containerWidth >= AUTO_FULL_MODE_MIN_WIDTH
        ? "full"
        : "compact"
      : mode;

  useEffect(() => {
    const node = graphRef.current;
    if (observedContainerRef.current === node) return;

    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    observedContainerRef.current = node;

    if (!node) return;
    measureContainerWidth(node);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureContainerWidth(node));
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, [measureContainerWidth, resolvedMode]);

  useEffect(() => {
    return () => resizeObserverRef.current?.disconnect();
  }, []);

  if (plan.state !== "ready" || plan.nodes.length === 0) return null;


  if (resolvedMode !== "compact" && !layout) return null;

  const fullGraphDialog = (
    <Dialog open={isFullDialogOpen} onOpenChange={setIsFullDialogOpen}>
      <DialogContent showCloseButton={false} className="flex h-[min(90vh,980px)] w-[min(1320px,calc(100vw-32px))] max-w-none flex-col overflow-hidden rounded-[32px] border border-border bg-background p-0 text-foreground shadow-xl">
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border/70 bg-card px-6 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">{graphCopy.fullTitle}</DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">{graphCopy.fullDescription}</DialogDescription>
          </div>
          <DialogClose render={<button type="button" aria-label={graphCopy.closeDialog} className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground" />}>
            <X className="size-4" />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {layout ? (
            <GraphShell
              graphCopy={graphCopy}
              layout={layout}
              nodes={nodes}
              edges={edges}
              planNodes={plan.nodes}
              currentStepId={plan.currentStepId}
              edgeLegend={edgeLegend}
              nodeLegend={nodeLegend}
              handleNodeClick={handleNodeClick}
              stopIfNodeButton={stopIfNodeButton}
              onCenterCurrentNode={handleCenterCurrentNode}
              onExpandGraph={() => setIsFullDialogOpen(true)}
              onFitGraph={handleFitGraph}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              testId="task-plan-graph-full-dialog"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );

  if (resolvedMode === "compact") {
    return (
      <>
        <div ref={containerRef} className={cn("min-w-0 w-full max-w-full", className)}>
          <div aria-label={graphCopy.ariaLabel} className="relative overflow-hidden rounded-[24px] border border-border bg-card p-3 text-card-foreground shadow-sm" data-graph-mode="compact" data-testid="task-plan-graph">
            <div className="relative space-y-3">
              <CompactStageStrip stages={compact.stages} graphCopy={graphCopy} />
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{graphCopy.focusTitle}</p>
                <CompactFocusStack items={compact.focusItems} selectedNodeId={selectedNodeId} onSelect={handleNodeSelect} graphCopy={graphCopy} />
              </section>
            </div>
          </div>
        </div>
        {fullGraphDialog}
      </>
    );
  }

  if (!layout) return null;

  return (
    <>
      <div ref={containerRef} className={cn("min-w-0 w-full max-w-full space-y-3", fillHeight && "flex h-full min-h-0 flex-col", className)}>
        <GraphShell
          graphCopy={graphCopy}
          layout={layout}
          nodes={nodes}
          edges={edges}
          fillHeight={fillHeight}
          planNodes={plan.nodes}
          currentStepId={plan.currentStepId}
          edgeLegend={edgeLegend}
          nodeLegend={nodeLegend}
          handleNodeClick={handleNodeClick}
          stopIfNodeButton={stopIfNodeButton}
          onCenterCurrentNode={handleCenterCurrentNode}
          onExpandGraph={() => setIsFullDialogOpen(true)}
          onFitGraph={handleFitGraph}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </div>
      {fullGraphDialog}
    </>
  );
}
