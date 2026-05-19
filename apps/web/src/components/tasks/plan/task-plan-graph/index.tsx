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
  selectedNode,
  selectedNodeId,
  currentStepId,
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
  selectedNode: TaskPlanGraphPlan["nodes"][number] | null;
  selectedNodeId: string | null;
  currentStepId?: string | null;
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
  showOverview: boolean;
  fillHeight?: boolean;
  testId?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const currentNode = planNodes.find((node) => node.id === currentStepId)
    ?? planNodes.find((node) => node.status === "active" || node.status === "in_progress")
    ?? selectedNode;

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
        overview={showOverview ? (
          <GraphOverviewBar
            graphCopy={graphCopy}
            items={overviewItems}
            currentTitle={currentNode?.title ?? null}
            selectedTitle={selectedNode?.title ?? null}
          />
        ) : null}
        handleNodeClick={handleNodeClick}
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
      {inspectorPlacement === "overlay" && selectedNode ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-[8] flex min-w-0 justify-end sm:top-20">
          <div
            className="pointer-events-auto w-full min-w-0 max-w-[min(380px,calc(100%-32px))]"
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
    <div className="rounded-[22px] border border-white/10 bg-slate-950/64 p-3 shadow-[0_18px_50px_rgba(2,6,23,0.34)] backdrop-blur-xl">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/85">
            <Clock3 className="size-3.5" />
            {graphCopy.overviewTitle}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-50">
            {selectedTitle ? `${graphCopy.selectedNode}: ${selectedTitle}` : currentTitle ? `${graphCopy.currentNode}: ${currentTitle}` : graphCopy.criticalPath}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {items.map((item) => {
            const Icon = iconByTone[item.tone];
            return (
              <div key={item.label} className="min-w-[6rem] rounded-2xl border border-white/8 bg-white/[0.055] px-3 py-2 text-slate-100">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  <Icon className="size-3" />
                  <span className="truncate">{item.label}</span>
                </div>
                <p className="mt-1 text-base font-semibold text-white">{item.value}</p>
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
  inspectorPlacement = "overlay",
  onSelectedNodeChange,
  dismissSelectionOnOutsideClick = true,
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

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullDialogOpen, setIsFullDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [nodes, setNodes] = useNodesState<FlowGraphNode>([]);
  const [edges, setEdges] = useEdgesState<FlowGraphEdge>([]);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const observedContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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

  const { edgeLegend, nodeLegend } = useGraphLegend(graphCopy);
  const compact = useMemo(() => buildCompactViewModel(plan), [plan]);
  const selectedNode =
    plan.nodes.find((node) => node.id === selectedNodeId) ?? null;

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
      onSelect: handleSelectNode,
    }).then((nextLayout) => {
      if (!active) return;
      setLayout(nextLayout);
      setNodes(nextLayout.nodes);
      setEdges(nextLayout.edges);
    });

    return () => {
      active = false;
    };
  }, [graphCopy, handleSelectNode, plan, selectedNodeId, setEdges, setNodes]);

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

  if (resolvedMode === "compact") {
    return (
      <>
        <div
          ref={containerRef}
          className={cn("min-w-0 w-full max-w-full", className)}
        >
          <div
            aria-label={graphCopy.ariaLabel}
            className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 p-4 text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.34)]"
            data-graph-mode="compact"
            data-testid="task-plan-graph"
          >
            <div className="pointer-events-none absolute inset-x-6 top-0 h-24 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.22),transparent_42%),radial-gradient(circle_at_78%_10%,rgba(168,85,247,0.20),transparent_38%)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
                  {graphCopy.compactTitle}
                </p>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  {graphCopy.compactDescription}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-lg transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
                onClick={() => setIsFullDialogOpen(true)}
              >
                {graphCopy.openFullGraph}
              </button>
            </div>

            <div className="relative mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {overviewItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[18px] border border-white/10 bg-white/[0.055] px-3 py-2 shadow-[0_12px_34px_rgba(2,6,23,0.18)]"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {item.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="relative mt-4 space-y-4">
              <CompactStageStrip stages={compact.stages} />
              <section className="space-y-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                    {graphCopy.focusTitle}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
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
              className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm"
              onClick={() => setIsFullDialogOpen(false)}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-label={graphCopy.fullTitle}
              className="fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,980px)] w-[min(1320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 text-slate-100 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/[0.035] px-6 py-5">
                <div className="space-y-1">
                  <h1 className="text-lg font-semibold tracking-tight text-white">
                    {graphCopy.fullTitle}
                  </h1>
                  <p className="text-sm text-slate-400">
                    {graphCopy.fullDescription}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullDialogOpen(false)}
                  aria-label={graphCopy.closeDialog}
                  className="flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {layout ? (
                  <GraphShell
                    graphCopy={graphCopy}
                    layout={layout}
                    nodes={nodes}
                    edges={edges}
                    planNodes={plan.nodes}
                    overviewItems={overviewItems}
                    selectedNode={selectedNode}
                    selectedNodeId={selectedNodeId}
                    currentStepId={plan.currentStepId}
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
                    showOverview={showOverview}
                    testId="task-plan-graph-full-dialog"
                  />
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </>
    );
  }

  if (!layout) return null;

  return (
    <>
      <div
        ref={containerRef}
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
          overviewItems={overviewItems}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          currentStepId={plan.currentStepId}
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
          showOverview={showOverview}
        />
      </div>

      {isFullDialogOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setIsFullDialogOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={graphCopy.fullTitle}
            className="fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,980px)] w-[min(1320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 text-slate-100 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/[0.035] px-6 py-5">
              <div className="space-y-1">
                <h1 className="text-lg font-semibold tracking-tight text-white">
                  {graphCopy.fullTitle}
                </h1>
                <p className="text-sm text-slate-400">
                  {graphCopy.fullDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFullDialogOpen(false)}
                aria-label={graphCopy.closeDialog}
                className="flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
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
                overviewItems={overviewItems}
                selectedNode={selectedNode}
                selectedNodeId={selectedNodeId}
                currentStepId={plan.currentStepId}
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
                showOverview={showOverview}
                testId="task-plan-graph-full-dialog"
              />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
