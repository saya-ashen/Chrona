import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { FlowGraphEdge } from "./types";

const EDGE_HIT_AREA_STYLE = { stroke: "transparent", strokeWidth: 10 };

function buildReadableEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const horizontalDelta = Math.abs(targetX - sourceX);
  const verticalDelta = Math.abs(targetY - sourceY);

  if (horizontalDelta < 6 || verticalDelta < 24) {
    return {
      path: `M ${sourceX},${sourceY} L ${targetX},${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2,
    };
  }

  const midY = sourceY + (targetY - sourceY) / 2;
  return {
    path: `M ${sourceX},${sourceY} L ${sourceX},${midY} L ${targetX},${midY} L ${targetX},${targetY}`,
    labelX: (sourceX + targetX) / 2,
    labelY: midY,
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
  const { path, labelX, labelY } = buildReadableEdgePath(sourceX, sourceY, targetX, targetY);

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
