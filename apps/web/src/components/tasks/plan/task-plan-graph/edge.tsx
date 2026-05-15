import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { FlowGraphEdge } from "./types";

const EDGE_HIT_AREA_STYLE = { stroke: "transparent", strokeWidth: 10 };

function TaskPlanGraphEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<FlowGraphEdge>) {
  const routeOffset = typeof data?.routeOffset === "number" ? data.routeOffset : 0;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: routeOffset > 0 ? 0.34 : 0.24,
  });

  const label = data?.stableLabel?.trim();

  return (
    <>
      <BaseEdge id={`${id}-hit-area`} path={path} style={EDGE_HIT_AREA_STYLE} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-[6px] border border-border/35 bg-background/88 px-1.5 py-0.5 text-[9px] font-medium leading-none text-muted-foreground shadow-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  taskPlanEdge: TaskPlanGraphEdge,
};
