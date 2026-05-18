import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { getShapeClassName, nodeKindLabel, TONE_STYLES } from "./logic";
import type { FlowGraphNode } from "./types";

function resolveExecutionStatus(node: FlowGraphNode["data"]["node"]) {
  if (node.status === "skipped") return "skipped";
  if (node.status === "done" || node.status === "completed") return "completed";
  if (node.status === "active" || node.status === "in_progress") return "running";
  if (node.status === "waiting_for_user" || node.interactionType === "approve" || node.requiresHumanInput) return "approval-needed";
  if (node.status === "blocked") return "blocked";
  return "waiting";
}

function hasNodeArtifacts(node: FlowGraphNode["data"]["node"]) {
  return Boolean(node.result || node.resultOutputs?.length || node.resultEvidence);
}

function formatEstimatedMinutes(value: number | null) {
  return typeof value === "number" ? `${value} min` : null;
}

const HIDDEN_HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: "none" as const,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 0,
  background: "transparent",
};

function resolveInteractionFrame(node: FlowGraphNode["data"]["node"]) {
  switch (node.interactionType) {
    case "execute":
      return { accent: "from-cyan-300 via-sky-400 to-blue-500", label: "Execute" };
    case "confirm":
      return { accent: "from-indigo-300 via-violet-400 to-fuchsia-500", label: "Confirm" };
    case "choose":
      return { accent: "from-amber-200 via-orange-300 to-fuchsia-400", label: "Choose" };
    case "input":
      return { accent: "from-amber-200 via-orange-300 to-rose-400", label: "Input" };
    case "edit":
      return { accent: "from-emerald-200 via-teal-300 to-cyan-400", label: "Edit" };
    case "approve":
      return { accent: "from-fuchsia-200 via-pink-400 to-rose-400", label: "Approve" };
    case "retry":
      return { accent: "from-rose-200 via-red-400 to-orange-400", label: "Retry" };
    case "wait":
      return { accent: "from-slate-400 via-slate-500 to-slate-600", label: "Wait" };
    case "observe":
      return { accent: "from-sky-300 via-cyan-400 to-blue-500", label: "View" };
    default:
      return { accent: "from-slate-300 via-slate-400 to-slate-500", label: "View" };
  }
}

function resolveRuntimeSpotlight(node: FlowGraphNode["data"]["node"]) {
  if (node.status === "skipped") {
      return {
        label: node.statusLabel ?? "Skipped",
        badge: "border-slate-500/55 bg-slate-800/80 text-slate-300",
        ring: "ring-1 ring-slate-500/25",
        glow: "bg-transparent",
      };
  }

  if (node.interactionType === "execute" || node.status === "ready") {
      return {
        label: "Ready",
        badge: "border-violet-300/45 bg-violet-400/18 text-violet-100",
        ring: "ring-1 ring-violet-300/45",
        glow: "bg-violet-400/16",
      };
  }

  if (node.status === "active") {
      return {
        label: "Running",
        badge: "border-cyan-200/55 bg-cyan-300/18 text-cyan-50",
        ring: "ring-2 ring-cyan-200/55",
        glow: "bg-cyan-300/18",
      };
  }

  if (node.interactionType === "approve") {
      return {
        label: "Approve",
        badge: "border-fuchsia-200/55 bg-fuchsia-300/18 text-fuchsia-50",
        ring: "ring-1 ring-fuchsia-300/45",
        glow: "bg-fuchsia-400/16",
      };
  }

  if (node.interactionType === "confirm") {
      return {
        label: "Confirm",
        badge: "border-indigo-200/55 bg-indigo-300/18 text-indigo-50",
        ring: "ring-1 ring-indigo-300/45",
        glow: "bg-indigo-300/16",
      };
  }

  if (node.interactionType === "choose") {
      return {
        label: "Choose",
        badge: "border-amber-200/60 bg-amber-300/18 text-amber-50",
        ring: "ring-1 ring-amber-300/45",
        glow: "bg-amber-300/18",
      };
  }

  if (node.interactionType === "edit") {
      return {
        label: "Edit",
        badge: "border-emerald-200/55 bg-emerald-300/18 text-emerald-50",
        ring: "ring-1 ring-emerald-300/45",
        glow: "bg-emerald-300/16",
      };
  }

  if (node.interactionType === "input") {
      return {
        label: "Input",
        badge: "border-amber-200/60 bg-amber-300/18 text-amber-50",
        ring: "ring-1 ring-amber-300/45",
        glow: "bg-amber-300/18",
      };
  }

  if (node.status === "blocked") {
      return {
        label: "Retry",
        badge: "border-rose-200/60 bg-rose-300/18 text-rose-50",
        ring: "ring-1 ring-rose-300/45",
        glow: "bg-rose-300/16",
      };
  }

  return null;
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { node, stepNumber, tone, shape, isSelected, isCurrent, isFocus, onSelect, graphCopy } = data;
  const styles = TONE_STYLES[tone];
  const runtimeSpotlight = resolveRuntimeSpotlight(node);
  const interactionFrame = resolveInteractionFrame(node);
  const durationLabel = formatEstimatedMinutes(node.estimatedMinutes ?? null);
  const executionStatus = resolveExecutionStatus(node);
  const requiresAction = node.status === "blocked" || executionStatus === "approval-needed";
  const estimatedLabel = durationLabel ?? (node.priority ? `${node.priority} priority` : null);

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle id="top-target" type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="left-target" type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="top-source" type="source" position={Position.Top} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="left-source" type="source" position={Position.Left} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        data-testid={`task-plan-node-${node.id}`}
        data-node-tone={node.linkedTaskId ? "child-task" : tone}
        data-node-shape={shape}
        data-node-current={isCurrent ? "true" : "false"}
        data-node-display-type={node.displayType ?? node.kind ?? node.type ?? "task"}
        data-node-has-artifacts={hasNodeArtifacts(node) ? "true" : "false"}
        data-node-requires-action={requiresAction ? "true" : "false"}
        data-node-selected={isSelected ? "true" : "false"}
        data-node-step={stepNumber}
        data-node-execution-status={executionStatus}
        className={cn(
          "rf-node-button group relative w-full overflow-hidden border px-3 py-2.5 text-left text-slate-100 transition duration-200",
          "shadow-[0_18px_45px_rgba(2,6,23,0.28)] backdrop-blur hover:-translate-y-0.5 hover:border-white/28 hover:shadow-[0_22px_60px_rgba(8,47,73,0.34)]",
          getShapeClassName(shape),
          styles.border,
          styles.bg,
          styles.text,
          isSelected && "ring-2 ring-white/55",
          isCurrent && "shadow-[0_0_0_1px_rgba(103,232,249,0.45),0_24px_80px_rgba(34,211,238,0.25)]",
          runtimeSpotlight?.ring,
          !isFocus && "opacity-70 saturate-50",
        )}
      >
        {runtimeSpotlight ? (
          <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 animate-pulse", runtimeSpotlight.glow, getShapeClassName(shape))} />
        ) : null}
        <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r", interactionFrame.accent)} />
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-24 rounded-full bg-white/7 blur-2xl transition group-hover:bg-cyan-200/13" />
        {shape === "diamond" ? (
          <span
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0 border", styles.border, styles.bg)}
            style={{ clipPath: "polygon(16% 0%, 84% 0%, 100% 50%, 84% 100%, 16% 100%, 0% 50%)" }}
          />
        ) : null}
        {shape === "parallelogram" ? (
          <span
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0 border", styles.border, styles.bg)}
            style={{ clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" }}
          />
        ) : null}
        <div className="relative grid grid-cols-[1.55rem_minmax(0,1fr)] items-start gap-2">
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[9px] border border-white/12 bg-white/10 text-[10px] font-semibold text-slate-100 shadow-inner shadow-white/5">
            {stepNumber}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              <span className={cn("size-2 rounded-full shadow-[0_0_14px_currentColor]", styles.dot)} />
              <span className="truncate">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
            </div>

            <p className="mt-1.5 break-words text-[13px] font-semibold leading-snug text-slate-50 line-clamp-2">{node.title}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-300">
                {interactionFrame.label}
              </span>
              {runtimeSpotlight ? (
                <span className={cn("rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]", runtimeSpotlight.badge)}>
                  {runtimeSpotlight.label}
                </span>
              ) : (
                <span className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-300">{node.statusLabel ?? node.status}</span>
              )}
              {estimatedLabel ? (
                <span className="truncate rounded-full border border-white/8 bg-slate-950/35 px-2 py-0.5 text-[10px] font-medium text-slate-300">{estimatedLabel}</span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
      <Handle id="right-target" type="target" position={Position.Right} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="bottom-target" type="target" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="right-source" type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
      <Handle id="bottom-source" type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} className="!bg-transparent" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};
