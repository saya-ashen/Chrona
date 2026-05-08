import type { MouseEvent } from "react";
import { ReactFlow, type NodeMouseHandler } from "@xyflow/react";
import { LAYOUT_DIRECTION } from "./constants";
import { EdgeLegend } from "./legend";
import { nodeTypes } from "./node-card";
import type { EdgeLegendItem, FlowGraphEdge, FlowGraphNode, GraphCopy, NodeLegendItem } from "./types";

export function TaskPlanGraphFrame({
  graphCopy,
  layout,
  nodes,
  edges,
  edgeLegend,
  nodeLegend,
  handleNodeClick,
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  testId = "task-plan-graph",
}: {
  graphCopy: GraphCopy;
  layout: { contentWidth: number; contentHeight: number; viewportHeight: number };
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  edgeLegend: EdgeLegendItem[];
  nodeLegend: NodeLegendItem[];
  handleNodeClick: NodeMouseHandler<FlowGraphNode>;
  handleNodeDragStart: (event: MouseEvent<Element>) => void;
  handleNodeDrag: (event: MouseEvent<Element>) => void;
  handleNodeDragStop: (event: MouseEvent<Element>) => void;
  testId?: string;
}) {
  return (
    <div
      aria-label={graphCopy.ariaLabel}
      className="relative min-w-0 max-w-full overflow-hidden rounded-[24px] border border-border/50 bg-muted/[0.16]"
      data-canvas-pan="true"
      data-edge-style="orthogonal"
      data-graph-editable="false"
      data-graph-interactive="true"
      data-graph-mode="full"
      data-layout-direction={LAYOUT_DIRECTION}
      data-layout-engine="dagre"
      data-renderer="react-flow"
      data-testid={testId}
    >
      <div className="relative min-w-0 max-w-full">
        <div className="h-full w-full min-w-0 max-w-full overflow-auto" data-testid="task-plan-graph-scroll" style={{ height: `${layout.viewportHeight}px` }}>
          <div className="min-w-full" data-testid="task-plan-graph-canvas" style={{ height: `${layout.contentHeight}px`, minWidth: `${layout.contentWidth}px`, width: "max-content" }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
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
              defaultEdgeOptions={{ zIndex: 0 }}
              className="bg-transparent"
              translateExtent={[[0, 0], [layout.contentWidth, layout.contentHeight]]}
            />
          </div>
        </div>
        <EdgeLegend edgeItems={edgeLegend} nodeItems={nodeLegend} graphCopy={graphCopy} />
      </div>
    </div>
  );
}
