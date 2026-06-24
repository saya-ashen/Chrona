"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, GitBranch, X } from "lucide-react";
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
  overviewItems,
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
  showOverview,
  fillHeight = false,
  testId,
}: {
  graphCopy: GraphCopy;
  layout: FlowLayout;
  nodes: FlowGraphNode[];
  edges: FlowLayout["edges"];
  planNodes: TaskPlanGraphPlan["nodes"];
  overviewItems: GraphOverviewItem[];
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
  showOverview: boolean;
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
        overview={showOverview ? (
          <GraphOverviewBar
            graphCopy={graphCopy}
            items={overviewItems}
            currentTitle={currentNode?.title ?? null}
            selectedTitle={null}
          />
        ) : null}
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

type GraphOverviewItem = {
  label: string;
  value: string | number;
  tone: "neutral" | "active" | "attention" | "done";
};

function GraphOverviewBar({
  graphCopy,
  items,
  currentTitle,
  selectedTitle,
}: {
  graphCopy: GraphCopy;
  items: GraphOverviewItem[];
  currentTitle: string | null;
  selectedTitle: string | null;
}) {
  const iconByTone = {
    neutral: GitBranch,
    active: CircleDot,
    attention: AlertTriangle,
    done: CheckCircle2,
  };

  return (
    <div className="rounded-[22px] border border-border bg-card p-3 shadow-sm">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <Clock3 className="size-3.5" />
            {graphCopy.overviewTitle}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-foreground">
            {selectedTitle ? `${graphCopy.selectedNode}: ${selectedTitle}` : currentTitle ? `${graphCopy.currentNode}: ${currentTitle}` : graphCopy.criticalPath}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {items.map((item) => {
            const Icon = iconByTone[item.tone];
            return (
              <div key={item.label} className="min-w-[6rem] rounded-2xl border border-border bg-background px-3 py-2 text-foreground">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <Icon className="size-3" />
                  <span className="truncate">{item.label}</span>
                </div>
                <p className="mt-1 text-base font-semibold text-foreground">{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TaskPlanGraph({
  plan,
  mode = "full",
  fillHeight = false,
  className,
  onSelectedNodeChange,
  showOverview = true,
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

  const overviewItems = [
    { label: graphCopy.overviewNodes, value: plan.nodes.length, tone: "neutral" as const },
    {
      label: graphCopy.overviewActive,
      value: plan.analytics.activeNodeIds.length,
      tone: "active" as const,
    },
    {
      label: graphCopy.overviewAttention,
      value: plan.analytics.attentionNodeIds.length,
      tone: "attention" as const,
    },
    {
      label: graphCopy.overviewDone,
      value: plan.nodes.filter(
        (node) => node.status === "done" || node.status === "skipped",
      ).length,
      tone: "done" as const,
    },
    {
      label: graphCopy.overviewEstimate,
      value: `${plan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)}m`,
      tone: "neutral" as const,
    },
  ];

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
              overviewItems={overviewItems}
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
              showOverview={showOverview}
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
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{graphCopy.compactTitle}</p>
              </div>
              <button type="button" className="shrink-0 rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary/35 hover:bg-primary-soft" onClick={() => setIsFullDialogOpen(true)}>
                {graphCopy.openFullGraph}
              </button>
            </div>
            <div className="relative mt-3 space-y-3">
              <CompactStageStrip stages={compact.stages} graphCopy={graphCopy} />
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{graphCopy.focusTitle}</p>
                <CompactFocusStack items={compact.focusItems} selectedNodeId={selectedNodeId} onSelect={handleNodeSelect} graphCopy={graphCopy} summary={compact.summary} />
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
          overviewItems={overviewItems}
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
          showOverview={showOverview}
        />
      </div>
      {fullGraphDialog}
    </>
  );
}
