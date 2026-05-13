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
import { useI18n } from "@/i18n/client";
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
import { TaskPlanGraphInspector } from "./inspector";
import { useGraphLegend } from "./legend";
import { buildFallbackFlowLayout, buildFlowLayout, syncNodeState, type FlowLayout } from "./layout";
import type {
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
  selectedNode,
  selectedNodeId,
  edgeLegend,
  nodeLegend,
  handleNodeClick,
  stopIfNodeButton,
  onDismissOverlay,
  onCenterCurrentNode,
  onExpandGraph,
  onFitGraph,
  onZoomIn,
  onZoomOut,
  inspectorPlacement,
  fillHeight = false,
  testId,
}: {
  graphCopy: GraphCopy;
  layout: FlowLayout;
  nodes: FlowGraphNode[];
  edges: FlowLayout["edges"];
  planNodes: TaskPlanGraphPlan["nodes"];
  selectedNode: TaskPlanGraphPlan["nodes"][number] | null;
  selectedNodeId: string | null;
  edgeLegend: ReturnType<typeof useGraphLegend>["edgeLegend"];
  nodeLegend: ReturnType<typeof useGraphLegend>["nodeLegend"];
  handleNodeClick: NodeMouseHandler<FlowGraphNode>;
  stopIfNodeButton: (event: MouseEvent<Element>) => void;
  onDismissOverlay: () => void;
  onCenterCurrentNode: () => void;
  onExpandGraph: () => void;
  onFitGraph: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  inspectorPlacement: "overlay" | "none";
  fillHeight?: boolean;
  testId?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedNodeId || !shellRef.current) {
      return;
    }

    const root = shellRef.current;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!root.contains(target)) return;
      if (target.closest("[data-testid^='task-plan-node-']")) return;
      if (target.closest("[data-testid='task-plan-node-overlay']")) return;
      onDismissOverlay();
    };

    root.addEventListener("pointerdown", handlePointerDown);
    return () => root.removeEventListener("pointerdown", handlePointerDown);
  }, [onDismissOverlay, selectedNodeId]);

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
        handleNodeClick={handleNodeClick}
        handleNodeDragStart={stopIfNodeButton}
        handleNodeDrag={stopIfNodeButton}
        handleNodeDragStop={stopIfNodeButton}
        onCenterCurrentNode={onCenterCurrentNode}
        onExpandGraph={onExpandGraph}
        onFitGraph={onFitGraph}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        testId={testId}
      />
      {inspectorPlacement === "overlay" && selectedNode ? (
        <div className="pointer-events-none absolute inset-x-4 top-4 z-[8] flex min-w-0 justify-end">
          <div
            className="pointer-events-auto w-full min-w-0 max-w-[min(340px,calc(100%-32px))]"
            data-testid="task-plan-node-overlay"
          >
            <div className="min-w-0 rounded-[24px]">
              <TaskPlanGraphInspector
                node={selectedNode}
                graphCopy={graphCopy}
                nodes={planNodes}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TaskPlanGraph({
  plan,
  mode = "full",
  fillHeight = false,
  className,
  inspectorPlacement = "overlay",
  onSelectedNodeChange,
  dismissSelectionOnOutsideClick = true,
}: TaskPlanGraphProps) {
  const { messages } = useI18n();
  const graphCopy = useMemo(
    () =>
      ({
        ...DEFAULT_GRAPH_COPY,
        ...(messages.components?.taskPlanGraph ?? {}),
      }) as GraphCopy,
    [messages.components],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullDialogOpen, setIsFullDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const graphRef = useRef<HTMLDivElement | null>(null);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const handleDismissOverlay = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

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

  const fallbackLayout = useMemo(
    () =>
      buildFallbackFlowLayout({
        plan,
        selectedNodeId,
        graphCopy,
        onSelect: handleSelectNode,
      }),
    [graphCopy, handleSelectNode, plan, selectedNodeId],
  );

  const [layout, setLayout] = useState<FlowLayout>(fallbackLayout);

  const [nodes, setNodes] = useNodesState<FlowGraphNode>(layout.nodes);
  const [edges, setEdges] = useEdgesState(layout.edges);
  const { edgeLegend, nodeLegend } = useGraphLegend(graphCopy);
  const compact = useMemo(() => buildCompactViewModel(plan), [plan]);
  const selectedNode =
    plan.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setLayout(fallbackLayout);
    void buildFlowLayout({
      plan,
      selectedNodeId,
      graphCopy,
      onSelect: handleSelectNode,
    }).then((nextLayout) => {
      if (!cancelled) setLayout(nextLayout);
    });
    return () => {
      cancelled = true;
    };
  }, [fallbackLayout, graphCopy, handleSelectNode, plan, selectedNodeId]);

  useEffect(() => {
    onSelectedNodeChange?.(selectedNode, plan.nodes);
  }, [onSelectedNodeChange, plan.nodes, selectedNode]);

  const handleNodeClick = useCallback<NodeMouseHandler<FlowGraphNode>>(
    (event, node) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button[data-testid^='task-plan-node-']")) return;
      handleSelectNode(node.id);
    },
    [handleSelectNode],
  );

  const stopIfNodeButton = useCallback((event: MouseEvent<Element>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button[data-testid^='task-plan-node-']")) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (!dismissSelectionOnOutsideClick) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectedNodeId) return;
      const target = event.target as HTMLElement | null;
      if (!graphRef.current?.contains(target)) {
        setSelectedNodeId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [dismissSelectionOnOutsideClick, selectedNodeId]);

  useEffect(() => {
    if (plan.state !== "ready" || plan.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (
      selectedNodeId &&
      !plan.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [plan, selectedNodeId]);

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout.edges, layout.nodes, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      syncNodeState(current, {
        selectedNodeId,
        graphCopy,
        onSelect: handleSelectNode,
        focusNodeIds: plan.analytics.reachableFromActiveIds,
      }),
    );
  }, [
    graphCopy,
    handleSelectNode,
    plan.analytics.reachableFromActiveIds,
    selectedNodeId,
    setNodes,
  ]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const readWidth = (element: HTMLElement | null): number => {
      if (!element) return 0;
      const direct =
        element.clientWidth || element.getBoundingClientRect().width || 0;
      if (direct > 0) return direct;
      const styled = Number.parseFloat(element.style.width || "0");
      if (Number.isFinite(styled) && styled > 0) return styled;
      return readWidth(element.parentElement);
    };
    const measure = () => {
      const nextWidth = readWidth(node);
      setContainerWidth((current) =>
        Math.abs(current - nextWidth) < 1 ? current : nextWidth,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(node);
  }, []);

  const resolvedMode: Exclude<TaskPlanGraphMode, "auto"> =
    mode === "auto"
      ? containerWidth >= AUTO_FULL_MODE_MIN_WIDTH
        ? "full"
        : "compact"
      : mode;

  if (plan.state !== "ready" || plan.nodes.length === 0) return null;

  const overviewItems = [
    { label: graphCopy.overviewNodes, value: plan.nodes.length },
    {
      label: graphCopy.overviewActive,
      value: plan.analytics.activeNodeIds.length,
    },
    {
      label: graphCopy.overviewAttention,
      value: plan.analytics.attentionNodeIds.length,
    },
    {
      label: graphCopy.overviewDone,
      value: plan.nodes.filter(
        (node) => node.status === "done" || node.status === "skipped",
      ).length,
    },
    {
      label: graphCopy.overviewEstimate,
      value: `${plan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min`,
    },
  ];

  if (resolvedMode === "compact") {
    return (
      <>
        <div
          ref={(node) => {
            containerRef(node);
            graphRef.current = node;
          }}
          className={cn("min-w-0 w-full max-w-full", className)}
        >
          <div
            aria-label={graphCopy.ariaLabel}
            className="rounded-[24px] border border-border/50 bg-muted/[0.16] p-4"
            data-graph-mode="compact"
            data-testid="task-plan-graph"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {graphCopy.compactTitle}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {graphCopy.compactDescription}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
                onClick={() => setIsFullDialogOpen(true)}
              >
                {graphCopy.openFullGraph}
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {overviewItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[18px] border border-border/60 bg-background/80 px-3 py-2 shadow-sm"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-4">
              <CompactStageStrip stages={compact.stages} />
              <section className="space-y-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {graphCopy.focusTitle}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {graphCopy.focusDescription}
                  </p>
                </div>
                <CompactFocusStack
                  items={compact.focusItems}
                  selectedNodeId={selectedNodeId}
                  onSelect={handleSelectNode}
                  graphCopy={graphCopy}
                />
              </section>
            </div>
          </div>
        </div>

        {isFullDialogOpen ? (
          <>
            <div
              className="fixed inset-0 z-40 bg-slate-950/35"
              onClick={() => setIsFullDialogOpen(false)}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-label={graphCopy.fullTitle}
              className="fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,980px)] w-[min(1320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
                <div className="space-y-1">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">
                    {graphCopy.fullTitle}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {graphCopy.fullDescription}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullDialogOpen(false)}
                  aria-label={graphCopy.closeDialog}
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <GraphShell
                  graphCopy={graphCopy}
                  layout={layout}
                  nodes={nodes}
                  edges={edges}
                  planNodes={plan.nodes}
                  selectedNode={selectedNode}
                  selectedNodeId={selectedNodeId}
                  edgeLegend={edgeLegend}
                  nodeLegend={nodeLegend}
                  handleNodeClick={handleNodeClick}
                  stopIfNodeButton={stopIfNodeButton}
                  onDismissOverlay={handleDismissOverlay}
                  onCenterCurrentNode={handleCenterCurrentNode}
                  onExpandGraph={() => setIsFullDialogOpen(true)}
                  onFitGraph={handleFitGraph}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  inspectorPlacement={inspectorPlacement}
                  testId="task-plan-graph-full-dialog"
                />
              </div>
            </section>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        ref={(node) => {
          containerRef(node);
          graphRef.current = node;
        }}
        className={cn(
          "min-w-0 w-full max-w-full space-y-3",
          fillHeight && "flex h-full min-h-0 flex-col",
          className,
        )}
      >
        <GraphShell
          graphCopy={graphCopy}
          layout={layout}
          nodes={nodes}
          edges={edges}
          fillHeight={fillHeight}
          planNodes={plan.nodes}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          edgeLegend={edgeLegend}
          nodeLegend={nodeLegend}
          handleNodeClick={handleNodeClick}
          stopIfNodeButton={stopIfNodeButton}
          onDismissOverlay={handleDismissOverlay}
          onCenterCurrentNode={handleCenterCurrentNode}
          onExpandGraph={() => setIsFullDialogOpen(true)}
          onFitGraph={handleFitGraph}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          inspectorPlacement={inspectorPlacement}
        />
      </div>

      {isFullDialogOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/35"
            onClick={() => setIsFullDialogOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={graphCopy.fullTitle}
            className="fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,980px)] w-[min(1320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
              <div className="space-y-1">
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  {graphCopy.fullTitle}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {graphCopy.fullDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFullDialogOpen(false)}
                aria-label={graphCopy.closeDialog}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <GraphShell
                graphCopy={graphCopy}
                layout={layout}
                nodes={nodes}
                edges={edges}
                planNodes={plan.nodes}
                selectedNode={selectedNode}
                selectedNodeId={selectedNodeId}
                edgeLegend={edgeLegend}
                nodeLegend={nodeLegend}
                handleNodeClick={handleNodeClick}
                stopIfNodeButton={stopIfNodeButton}
                onDismissOverlay={handleDismissOverlay}
                onCenterCurrentNode={handleCenterCurrentNode}
                onExpandGraph={() => setIsFullDialogOpen(true)}
                onFitGraph={handleFitGraph}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                inspectorPlacement={inspectorPlacement}
                testId="task-plan-graph-full-dialog"
              />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
