import { buildEdgeLegend, buildNodeLegend, getShapeStyle, shapeChipClassName } from "./logic";
import type { EdgeLegendItem, GraphCopy, NodeLegendItem, NodeShape, NodeTone } from "./types";

function ShapeChip({ shape, tone }: { shape: NodeShape; tone: NodeTone }) {
  return <span aria-hidden="true" className={shapeChipClassName(shape, tone)} style={getShapeStyle(shape)} />;
}

export function EdgeLegend({ edgeItems, nodeItems, graphCopy }: { edgeItems: EdgeLegendItem[]; nodeItems: NodeLegendItem[]; graphCopy: GraphCopy }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex justify-end p-3">
      <div className="rounded-2xl border border-border/60 bg-background/92 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur" data-testid="task-plan-graph-legend">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.legendEdges}</p>
            {edgeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <svg aria-hidden="true" className="shrink-0" height="8" viewBox="0 0 28 8" width="28">
                  <line stroke={item.stroke} strokeDasharray={item.dash} strokeLinecap="round" strokeWidth={item.width} x1="1" x2="27" y1="4" y2="4" />
                </svg>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5" data-testid="task-plan-graph-node-legend">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.legendStates}</p>
            {nodeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
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
