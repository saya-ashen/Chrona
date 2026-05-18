import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: data?.fanIn || data?.fanOut ? 18 : 12,
    offset: routeOffset > 0 ? routeOffset : 24,
  });

  const label = data?.stableLabel?.trim();
  const stroke = typeof style?.stroke === "string" ? style.stroke : "rgba(148, 163, 184, 0.7)";
  const glowStyle = {
    ...style,
    stroke,
    strokeOpacity: 0.32,
    strokeWidth: Number(style?.strokeWidth ?? 1.8) + 6,
    filter: "blur(5px)",
  };

  return (
    <>
      <BaseEdge id={`${id}-hit-area`} path={path} style={EDGE_HIT_AREA_STYLE} />
      <BaseEdge id={`${id}-glow`} path={path} style={glowStyle} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeLinecap: "round", strokeLinejoin: "round" }} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-white/12 bg-slate-950/82 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-200 shadow-[0_8px_24px_rgba(2,6,23,0.35)] backdrop-blur"
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
