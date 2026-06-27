import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type WheelEvent } from "react";
import { Maximize2, Minus, Plus, Scan, LocateFixed } from "lucide-react";
import { PanOnScrollMode, ReactFlow, type NodeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { edgeTypes } from "./edge";
import { EdgeLegend } from "./legend";
import { nodeTypes } from "./node-card";
import type {
  EdgeLegendItem,
  FlowGraphEdge,
  FlowGraphNode,
  GraphCopy,
  NodeLegendItem,
} from "./types";

const READABLE_INITIAL_ZOOM = 1;
const INITIAL_VIEWPORT_TOP_PADDING = 44;
const NODE_FALLBACK_WIDTH = 198;
const NODE_FALLBACK_HEIGHT = 100;
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };
const DEFAULT_EDGE_OPTIONS = { zIndex: 6 };

export function TaskPlanGraphFrame({
  graphCopy,
  layout,
  nodes,
  edges,
  fillHeight = false,
  edgeLegend,
  nodeLegend,
  overview,
  handleNodeClick,
  handlePaneClick,
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  onCenterCurrentNode,
  onExpandGraph,
  onFitGraph,
  onZoomIn,
  onZoomOut,
  currentNodeId,
  testId = "task-plan-graph",
}: {
  graphCopy: GraphCopy;
  layout: {
    contentWidth: number;
    contentHeight: number;
    viewportHeight: number;
    layoutDirection: "TB" | "LR";
  };
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  fillHeight?: boolean;
  edgeLegend: EdgeLegendItem[];
  nodeLegend: NodeLegendItem[];
  overview?: ReactNode;
  handleNodeClick: NodeMouseHandler<FlowGraphNode>;
  handlePaneClick: () => void;
  handleNodeDragStart: (event: MouseEvent<Element>) => void;
  handleNodeDrag: (event: MouseEvent<Element>) => void;
  handleNodeDragStop: (event: MouseEvent<Element>) => void;
  onCenterCurrentNode: () => void;
  onExpandGraph: () => void;
  onFitGraph: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  currentNodeId?: string | null;
  testId?: string;
}) {
  const flowRef = useRef<ReactFlowInstance<FlowGraphNode, FlowGraphEdge> | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastInitialFitKey = useRef<string | null>(null);
  const initFrameRef = useRef<number | null>(null);
  const wheelHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelHintShown = useRef(false);
  const [showWheelZoomHint, setShowWheelZoomHint] = useState(false);
  const hasOverview = Boolean(overview);
  const initialFitKey = useMemo(
    () => `${layout.contentWidth}:${layout.contentHeight}:${nodes.map((node) => node.id).join("|")}`,
    [layout.contentHeight, layout.contentWidth, nodes],
  );
  const fitGraph = useCallback((duration = 220) => {
    const flow = flowRef.current;
    if (!flow) {
      onFitGraph();
      return;
    }
    void flow.fitView({ duration, maxZoom: 1, padding: 0.18 });
  }, [onFitGraph]);

  const focusInitialView = useCallback((duration = 220) => {
    const flow = flowRef.current;
    if (!flow) {
      onFitGraph();
      return;
    }

    const viewport = viewportRef.current;
    const flowNodes = flow.getNodes();
    if (!viewport || flowNodes.length === 0) {
      void flow.fitView({ duration, maxZoom: 1, padding: 0.18 });
      return;
    }

    const graphBounds = flowNodes.reduce(
      (bounds, node) => {
        const width = node.measured?.width ?? node.width ?? NODE_FALLBACK_WIDTH;
        const height = node.measured?.height ?? node.height ?? NODE_FALLBACK_HEIGHT;
        return {
          minX: Math.min(bounds.minX, node.position.x),
          minY: Math.min(bounds.minY, node.position.y),
          maxX: Math.max(bounds.maxX, node.position.x + width),
          maxY: Math.max(bounds.maxY, node.position.y + height),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    if (!Number.isFinite(graphBounds.minX) || !Number.isFinite(graphBounds.minY)) {
      void flow.fitView({ duration, maxZoom: 1, padding: 0.18 });
      return;
    }

    const graphCenterX = (graphBounds.minX + graphBounds.maxX) / 2;
    void flow.setViewport({
      x: viewport.clientWidth / 2 - graphCenterX * READABLE_INITIAL_ZOOM,
      y: INITIAL_VIEWPORT_TOP_PADDING - graphBounds.minY * READABLE_INITIAL_ZOOM,
      zoom: READABLE_INITIAL_ZOOM,
    }, {
      duration,
    });
  }, [onFitGraph]);

  const handleInit = useCallback((flow: ReactFlowInstance<FlowGraphNode, FlowGraphEdge>) => {
    flowRef.current = flow;
    if (initFrameRef.current !== null) {
      cancelAnimationFrame(initFrameRef.current);
    }
    initFrameRef.current = requestAnimationFrame(() => {
      initFrameRef.current = null;
      focusInitialView(0);
    });
  }, [focusInitialView]);

  useEffect(() => {
    if (!flowRef.current || lastInitialFitKey.current === initialFitKey) {
      return;
    }
    lastInitialFitKey.current = initialFitKey;
    const frame = requestAnimationFrame(() => focusInitialView(0));
    return () => cancelAnimationFrame(frame);
  }, [focusInitialView, initialFitKey]);

  useEffect(() => {
    return () => {
      if (initFrameRef.current !== null) {
        cancelAnimationFrame(initFrameRef.current);
      }
      if (wheelHintTimer.current) {
        clearTimeout(wheelHintTimer.current);
      }
    };
  }, []);

  const handleWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (wheelHintShown.current || event.ctrlKey || event.metaKey) {
      return;
    }

    wheelHintShown.current = true;
    setShowWheelZoomHint(true);
    wheelHintTimer.current = setTimeout(() => setShowWheelZoomHint(false), 2400);
  }, []);

  const handleZoomIn = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) {
      onZoomIn();
      return;
    }
    void flow.zoomIn({ duration: 180 });
  }, [onZoomIn]);

  const handleZoomOut = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) {
      onZoomOut();
      return;
    }
    void flow.zoomOut({ duration: 180 });
  }, [onZoomOut]);

  const handleCenterCurrentNode = useCallback(() => {
    const flow = flowRef.current;
    const currentNode = currentNodeId ? flow?.getNode(currentNodeId) : null;
    if (!flow || !currentNode) {
      onCenterCurrentNode();
      return;
    }

    const width = currentNode.measured?.width ?? currentNode.width ?? NODE_FALLBACK_WIDTH;
    const height = currentNode.measured?.height ?? currentNode.height ?? NODE_FALLBACK_HEIGHT;
    void flow.setCenter(currentNode.position.x + width / 2, currentNode.position.y + height / 2, {
      duration: 220,
      zoom: Math.max(flow.getZoom(), 1),
    });
  }, [currentNodeId, onCenterCurrentNode]);

  const graphControls = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5" aria-label={graphCopy.controlPanel} data-testid="task-plan-graph-controls">
      <span
        className={cn(
          "pointer-events-none min-w-0 px-1 text-right text-[0.68rem] font-medium text-muted-foreground transition-opacity duration-200",
          showWheelZoomHint ? "opacity-100" : "opacity-0",
        )}
        data-testid="task-plan-graph-wheel-hint"
      >
        {graphCopy.wheelZoomHint}
      </span>
      <Button type="button" aria-label={graphCopy.zoomIn} variant="ghost" size="icon" className="size-8 rounded-lg border border-border bg-background text-foreground shadow-none transition hover:bg-muted" onClick={handleZoomIn}>
        <Plus className="size-3.5" />
      </Button>
      <Button type="button" aria-label={graphCopy.zoomOut} variant="ghost" size="icon" className="size-8 rounded-lg border border-border bg-background text-foreground shadow-none transition hover:bg-muted" onClick={handleZoomOut}>
        <Minus className="size-3.5" />
      </Button>
      <Button type="button" aria-label={graphCopy.fitGraph} variant="ghost" size="icon" className="size-8 rounded-lg border border-border bg-background text-foreground shadow-none transition hover:bg-muted" onClick={() => fitGraph()}>
        <Scan className="size-3.5" />
      </Button>
      <Button type="button" aria-label={graphCopy.centerCurrentNode} variant="ghost" size="icon" className="size-8 rounded-lg border border-border bg-background text-foreground shadow-none transition hover:bg-muted" onClick={handleCenterCurrentNode}>
        <LocateFixed className="size-3.5" />
      </Button>
      <Button type="button" aria-label={graphCopy.expandGraph} variant="ghost" size="icon" className="size-8 rounded-lg border border-border bg-background text-foreground shadow-none transition hover:bg-muted" onClick={onExpandGraph}>
        <Maximize2 className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div
      aria-label={graphCopy.ariaLabel}
      className={cn(
        "relative min-w-0 max-w-full overflow-hidden rounded-[28px] border border-border bg-[linear-gradient(180deg,var(--background),var(--canvas))] text-card-foreground shadow-sm",
        fillHeight && "flex h-full min-h-0 flex-col",
      )}
      data-canvas-pan="true"
      data-edge-style="orthogonal"
      data-graph-editable="false"
      data-graph-interactive="true"
      data-graph-mode="full"
      data-layout-direction={layout.layoutDirection}
      data-layout-engine="elk-layered"
      data-renderer="react-flow"
      data-testid={testId}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] opacity-30 [background-size:42px_42px]" />
      <div className={cn("relative min-w-0 max-w-full", fillHeight && "flex min-h-0 flex-1 flex-col")}>
        <div className="relative z-[7] flex min-w-0 flex-col gap-2 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">{overview}</div>
          <div className="shrink-0">{graphControls}</div>
        </div>
        <div
          className={cn(
            "w-full min-w-0 max-w-full overflow-hidden px-0 pb-3 pt-3",
            fillHeight && "h-full min-h-0 flex-1",
          )}
          data-testid="task-plan-graph-scroll"
          data-wheel-pan="scroll"
          data-wheel-zoom="modifier-or-pinch"
          onWheelCapture={handleWheelCapture}
          ref={viewportRef}
          style={fillHeight ? undefined : { height: `${layout.viewportHeight}px` }}
        >
          <div
            className="min-w-full"
            data-testid="task-plan-graph-canvas"
            style={{
              height: "100%",
              minWidth: "100%",
              width: "100%",
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              onInit={handleInit}
              noPanClassName="rf-node-button"
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              selectNodesOnDrag={false}
              panOnDrag
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Free}
              panOnScrollSpeed={0.9}
              zoomActivationKeyCode={["Control", "Meta"]}
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              preventScrolling
              attributionPosition="bottom-left"
              proOptions={REACT_FLOW_PRO_OPTIONS}
              defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
              className="bg-transparent"
            />
          </div>
        </div>
        <EdgeLegend
          edgeItems={edgeLegend}
          nodeItems={nodeLegend}
          graphCopy={graphCopy}
          placement={hasOverview ? "bottom" : "top"}
        />
      </div>
    </div>
  );
}
