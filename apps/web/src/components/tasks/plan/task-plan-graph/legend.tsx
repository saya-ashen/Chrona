import { buildEdgeLegend, buildNodeLegend, getShapeStyle, shapeChipClassName } from "./logic";
import type { EdgeLegendItem, GraphCopy, NodeLegendItem, NodeShape, NodeTone } from "./types";

function ShapeChip({ shape, tone }: { shape: NodeShape; tone: NodeTone }) {
  return <span aria-hidden="true" className={shapeChipClassName(shape, tone)} style={getShapeStyle(shape)} />;
}

export function EdgeLegend({ edgeItems, nodeItems, graphCopy }: { edgeItems: EdgeLegendItem[]; nodeItems: NodeLegendItem[]; graphCopy: GraphCopy }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex justify-center px-3 pb-2">
      <div className="max-w-[calc(100%-1rem)] rounded-full border border-border/45 bg-background/88 px-2.5 py-1 shadow-[0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur" data-testid="task-plan-graph-legend">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{graphCopy.legendEdges}</p>
            {edgeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <svg aria-hidden="true" className="shrink-0" height="8" viewBox="0 0 28 8" width="28">
                  <line stroke={item.stroke} strokeDasharray={item.dash} strokeLinecap="round" strokeWidth={item.width} x1="1" x2="27" y1="4" y2="4" />
                </svg>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="task-plan-graph-node-legend">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{graphCopy.legendStates}</p>
            {nodeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ShapeChip shape={item.shape} tone={item.tone} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useGraphLegend(graphCopy: GraphCopy) {
  return {
    edgeLegend: buildEdgeLegend(graphCopy),
    nodeLegend: buildNodeLegend(graphCopy),
  };
}
