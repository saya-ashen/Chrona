import {
  buildEdgeLegend,
  buildNodeLegend,
  getShapeStyle,
  shapeChipClassName,
} from "./logic";
import type { EdgeLegendItem, GraphCopy, NodeLegendItem, NodeShape, NodeTone } from "./types";

export function ShapeChip({
  shape,
  tone,
  className,
}: {
  shape: NodeShape;
  tone: NodeTone;
  className?: string;
}) {
  return <span aria-hidden="true" className={shapeChipClassName(shape, tone, className)} style={getShapeStyle(shape)} />;
}

export function EdgeLegend({ edgeItems, nodeItems }: { edgeItems: EdgeLegendItem[]; nodeItems: NodeLegendItem[] }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex justify-end p-3">
      <div
        className="rounded-2xl border border-border/60 bg-background/92 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur"
        data-testid="task-plan-graph-legend"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            {edgeItems.map((item) => (
              <div key={item.type} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <svg aria-hidden="true" className="shrink-0" height="8" viewBox="0 0 28 8" width="28">
                  <line
                    stroke={item.stroke}
                    strokeDasharray={item.dash}
                    strokeLinecap="round"
                    strokeWidth={item.width}
                    x1="1"
                    x2="27"
                    y1="4"
                    y2="4"
                  />
                </svg>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5" data-testid="task-plan-graph-node-legend">
            {nodeItems.map((item) => (
              <div key={item.type} className="flex items-center gap-2 text-[11px] text-muted-foreground">
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
