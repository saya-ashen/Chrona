import type { MouseEvent } from "react";
import { Maximize2, Minus, Plus, Scan, LocateFixed } from "lucide-react";
import { ReactFlow, type NodeMouseHandler } from "@xyflow/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LAYOUT_DIRECTION } from "./constants";
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
  };
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  fillHeight?: boolean;
  edgeLegend: EdgeLegendItem[];
  nodeLegend: NodeLegendItem[];
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
  const controlClassName = buttonVariants({
    variant: "ghost",
    size: "icon",
    className: "size-7 rounded-md bg-background/70 shadow-none backdrop-blur",
  });

  return (
    <div
      aria-label={graphCopy.ariaLabel}
      className={cn(
        "relative min-w-0 max-w-full overflow-hidden rounded-[12px] border border-border/25 bg-white shadow-none",
        fillHeight && "flex h-full min-h-0 flex-col",
      )}
      data-canvas-pan="true"
      data-edge-style="orthogonal"
      data-graph-editable="false"
      data-graph-interactive="true"
      data-graph-mode="full"
      data-layout-direction={LAYOUT_DIRECTION}
      data-layout-engine="elk-layered"
      data-renderer="react-flow"
      data-testid={testId}
    >
      <div className={cn("relative min-w-0 max-w-full", fillHeight && "flex min-h-0 flex-1 flex-col")}>
        <div
          className={cn(
            "w-full min-w-0 max-w-full overflow-auto",
            fillHeight && "h-full min-h-0 flex-1",
          )}
          data-testid="task-plan-graph-scroll"
          style={fillHeight ? undefined : { height: `${layout.viewportHeight}px` }}
        >
          <div
              className="min-w-full bg-[radial-gradient(circle_at_1px_1px,hsl(var(--muted-foreground)/0.11)_1px,transparent_0)] [background-size:22px_22px]"
            data-testid="task-plan-graph-canvas"
            style={{
              height: `${layout.contentHeight}px`,
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
        />
        <div className="absolute right-2 top-2 z-[7] flex flex-wrap justify-end gap-1" data-testid="task-plan-graph-controls">
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
