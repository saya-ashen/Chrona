import { buildEdgeLegend, buildNodeLegend, getShapeStyle, shapeChipClassName } from "./logic";
import { cn } from "@/lib/utils";
import type { EdgeLegendItem, GraphCopy, NodeLegendItem, NodeShape, NodeTone } from "./types";

function ShapeChip({ shape, tone }: { shape: NodeShape; tone: NodeTone }) {
  return <span aria-hidden="true" className={shapeChipClassName(shape, tone)} style={getShapeStyle(shape)} />;
}

export function EdgeLegend({
  edgeItems,
  nodeItems,
  graphCopy: _graphCopy,
  placement = "bottom",
}: {
  edgeItems: EdgeLegendItem[];
  nodeItems: NodeLegendItem[];
  graphCopy: GraphCopy;
  placement?: "top" | "bottom";
}) {
  const visibleEdgeItems = edgeItems.slice(0, placement === "top" ? 3 : 4);
  const visibleNodeItems = nodeItems.slice(0, placement === "top" ? 4 : nodeItems.length);
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-[6] hidden sm:block",
        placement === "top"
          ? "left-3 top-3 max-w-[calc(100%-17rem)]"
          : "bottom-4 left-3 max-w-[calc(100%-1.5rem)] justify-center",
      )}
    >
      <div
        className={cn(
          "inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border/80 bg-background/90 px-2.5 py-1.5 text-muted-foreground shadow-sm backdrop-blur",
          placement === "top" && "bg-background/95",
        )}
        data-testid="task-plan-graph-legend"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {visibleEdgeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <svg aria-hidden="true" className="shrink-0" height="8" viewBox="0 0 24 8" width="24">
                  <line stroke={item.stroke} strokeDasharray={item.dash} strokeLinecap="round" strokeWidth={item.width} x1="1" x2="23" y1="4" y2="4" />
                </svg>
                <span className="whitespace-nowrap">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="task-plan-graph-node-legend">
            {visibleNodeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ShapeChip shape={item.shape} tone={item.tone} />
                <span className="whitespace-nowrap">{item.label}</span>
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
