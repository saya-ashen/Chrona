import type { MouseEvent, ReactNode } from "react";
import { Maximize2, Minus, Plus, Scan, LocateFixed } from "lucide-react";
import { ReactFlow, type NodeMouseHandler } from "@xyflow/react";
import { buttonVariants } from "@/components/ui/button";
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
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  onCenterCurrentNode,
  onExpandGraph,
  onFitGraph,
  onZoomIn,
  onZoomOut,
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
  handleNodeDragStart: (event: MouseEvent<Element>) => void;
  handleNodeDrag: (event: MouseEvent<Element>) => void;
  handleNodeDragStop: (event: MouseEvent<Element>) => void;
  onCenterCurrentNode: () => void;
  onExpandGraph: () => void;
  onFitGraph: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  testId?: string;
}) {
  const hasOverview = Boolean(overview);
  const controlClassName = buttonVariants({
    variant: "ghost",
    size: "icon",
    className: "size-8 rounded-xl border border-white/10 bg-white/8 text-slate-100 shadow-none backdrop-blur transition hover:bg-white/14 hover:text-white focus-visible:ring-cyan-300/60",
  });

  return (
    <div
      aria-label={graphCopy.ariaLabel}
      className={cn(
        "relative min-w-0 max-w-full overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.24)]",
        fillHeight && "flex h-full min-h-0 flex-col",
      )}
      data-canvas-pan="true"
      data-edge-style="orthogonal"
      data-graph-editable="false"
      data-graph-interactive="true"
      data-graph-mode="full"
      data-layout-direction={layout.layoutDirection}
      data-layout-engine="d3-dag-sugiyama"
      data-renderer="react-flow"
      data-testid={testId}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_78%_24%,rgba(168,85,247,0.20),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.72),rgba(2,6,23,0.96)_62%,rgba(15,23,42,0.92))]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.055)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className={cn("relative min-w-0 max-w-full", fillHeight && "flex min-h-0 flex-1 flex-col")}>
        {overview ? <div className="absolute inset-x-3 top-3 z-[7]">{overview}</div> : null}
        <div
          className={cn(
            "w-full min-w-0 max-w-full overflow-auto",
            hasOverview ? "pt-[5.75rem] sm:pt-[5rem]" : "px-0 pb-3 pt-3",
            fillHeight && "h-full min-h-0 flex-1",
          )}
          data-testid="task-plan-graph-scroll"
          style={fillHeight ? undefined : { height: `${layout.viewportHeight}px` }}
        >
          <div
            className="min-w-full"
            data-testid="task-plan-graph-canvas"
            style={{
              height: `${layout.contentHeight + (hasOverview ? 64 : 28)}px`,
              minWidth: `${layout.contentWidth}px`,
              width: "max-content",
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              noPanClassName="rf-node-button"
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              selectNodesOnDrag={false}
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              zoomOnDoubleClick={false}
              preventScrolling={false}
              attributionPosition="bottom-left"
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ zIndex: 6 }}
              className="bg-transparent"
              translateExtent={[
                [0, 0],
                [layout.contentWidth, layout.contentHeight],
              ]}
            />
          </div>
        </div>
        <EdgeLegend
          edgeItems={edgeLegend}
          nodeItems={nodeLegend}
          graphCopy={graphCopy}
          placement={hasOverview ? "bottom" : "top"}
        />
        <div className="absolute bottom-3 right-3 top-auto z-[7] flex flex-wrap justify-end gap-1.5 rounded-[18px] border border-white/10 bg-slate-950/62 p-1.5 shadow-[0_18px_50px_rgba(2,6,23,0.32)] backdrop-blur-xl sm:top-3 sm:bottom-auto" aria-label={graphCopy.controlPanel} data-testid="task-plan-graph-controls">
          <button type="button" aria-label={graphCopy.zoomIn} className={controlClassName} onClick={onZoomIn}>
            <Plus className="size-4" />
          </button>
          <button type="button" aria-label={graphCopy.zoomOut} className={controlClassName} onClick={onZoomOut}>
            <Minus className="size-4" />
          </button>
          <button type="button" aria-label={graphCopy.fitGraph} className={controlClassName} onClick={onFitGraph}>
            <Scan className="size-4" />
          </button>
          <button type="button" aria-label={graphCopy.centerCurrentNode} className={controlClassName} onClick={onCenterCurrentNode}>
            <LocateFixed className="size-4" />
          </button>
          <button type="button" aria-label={graphCopy.expandGraph} className={controlClassName} onClick={onExpandGraph}>
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
