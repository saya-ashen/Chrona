import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { FlowGraphEdge } from "./types";

const EDGE_HIT_AREA_STYLE = { stroke: "transparent", strokeWidth: 10 };
const MIN_DIRECT_DELTA = 6;

function buildReadableEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  orientation: "vertical" | "horizontal" = "vertical",
  routeOffset = 0,
) {
  const horizontalDelta = Math.abs(targetX - sourceX);
  const verticalDelta = Math.abs(targetY - sourceY);

  if (horizontalDelta < MIN_DIRECT_DELTA && verticalDelta < MIN_DIRECT_DELTA) {
    return {
      path: `M ${sourceX},${sourceY} L ${targetX},${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2,
    };
  }

  if (orientation === "horizontal") {
    const direction = targetX >= sourceX ? 1 : -1;
    let routeX = sourceX + (targetX - sourceX) / 2 + routeOffset * direction;

    if (Math.abs(routeX - targetX) < MIN_DIRECT_DELTA) {
      routeX = targetX - MIN_DIRECT_DELTA * direction;
    }

    if (Math.abs(routeX - sourceX) < MIN_DIRECT_DELTA) {
      routeX = sourceX + MIN_DIRECT_DELTA * direction;
    }

    return {
      path: `M ${sourceX},${sourceY} L ${routeX},${sourceY} L ${routeX},${targetY} L ${targetX},${targetY}`,
      labelX: routeX,
      labelY: (sourceY + targetY) / 2,
    };
  }

  const direction = targetY >= sourceY ? 1 : -1;
  let routeY = sourceY + (targetY - sourceY) / 2 + routeOffset * direction;

  if (Math.abs(routeY - targetY) < MIN_DIRECT_DELTA) {
    routeY = targetY - MIN_DIRECT_DELTA * direction;
  }

  if (Math.abs(routeY - sourceY) < MIN_DIRECT_DELTA) {
    routeY = sourceY + MIN_DIRECT_DELTA * direction;
  }

  return {
    path: `M ${sourceX},${sourceY} L ${sourceX},${routeY} L ${targetX},${routeY} L ${targetX},${targetY}`,
    labelX: (sourceX + targetX) / 2,
    labelY: routeY,
  };
}

function TaskPlanGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps<FlowGraphEdge>) {
  const orientation = data?.orientation === "horizontal" ? "horizontal" : "vertical";
  const routeOffset = typeof data?.routeOffset === "number" ? data.routeOffset : 0;
  const { path, labelX, labelY } = buildReadableEdgePath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    orientation,
    routeOffset,
  );

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
