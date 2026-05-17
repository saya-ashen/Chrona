import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { getShapeClassName, nodeKindLabel, TONE_STYLES } from "./logic";
import type { FlowGraphNode } from "./types";

function resolveExecutionStatus(node: FlowGraphNode["data"]["node"]) {
  if (node.status === "done" || node.status === "completed" || node.status === "skipped") return "completed";
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
      return { accent: "before:bg-violet-500/75" };
    case "confirm":
      return { accent: "before:bg-indigo-500/75" };
    case "choose":
      return { accent: "before:bg-amber-500/75" };
    case "input":
      return { accent: "before:bg-amber-500/75" };
    case "edit":
      return { accent: "before:bg-emerald-500/75" };
    case "approve":
      return { accent: "before:bg-fuchsia-500/75" };
    case "retry":
      return { accent: "before:bg-rose-500/75" };
    case "wait":
      return { accent: "before:bg-slate-500/65" };
    default:
      return { accent: "before:bg-sky-500/70" };
  }
}

function resolveRuntimeSpotlight(node: FlowGraphNode["data"]["node"]) {
  if (node.interactionType === "execute" || node.status === "ready") {
      return {
        label: "Ready",
        badge: "bg-violet-500 text-white",
        ring: "ring-1 ring-violet-400/45",
        glow: "bg-violet-300/18",
      };
  }

  if (node.status === "active") {
      return {
        label: "Running",
        badge: "bg-sky-500 text-white",
        ring: "ring-1 ring-sky-400/45",
        glow: "bg-sky-400/18",
      };
  }

  if (node.interactionType === "approve") {
      return {
        label: "Approve",
        badge: "bg-fuchsia-500 text-white",
        ring: "ring-1 ring-fuchsia-400/45",
        glow: "bg-fuchsia-400/16",
      };
  }

  if (node.interactionType === "confirm") {
      return {
        label: "Confirm",
        badge: "bg-indigo-500 text-white",
        ring: "ring-1 ring-indigo-400/45",
        glow: "bg-indigo-300/16",
      };
  }

  if (node.interactionType === "choose") {
      return {
        label: "Choose",
        badge: "bg-amber-500 text-white",
        ring: "ring-1 ring-amber-400/45",
        glow: "bg-amber-300/18",
      };
  }

  if (node.interactionType === "edit") {
      return {
        label: "Edit",
        badge: "bg-emerald-500 text-white",
        ring: "ring-1 ring-emerald-400/45",
        glow: "bg-emerald-300/16",
      };
  }

  if (node.interactionType === "input") {
      return {
        label: "Input",
        badge: "bg-amber-500 text-white",
        ring: "ring-1 ring-amber-400/45",
        glow: "bg-amber-300/18",
      };
  }

  if (node.status === "blocked") {
      return {
        label: "Retry",
        badge: "bg-rose-500 text-white",
        ring: "ring-1 ring-rose-400/45",
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
          "rf-node-button group relative w-full overflow-hidden border px-3 py-2 text-left transition-colors duration-150",
          "before:absolute before:inset-y-3 before:left-0 before:w-px before:rounded-r-full before:content-['']",
          "shadow-none hover:border-foreground/18",
          getShapeClassName(shape),
          styles.border,
          styles.bg,
          styles.text,
          interactionFrame.accent,
          isSelected && "ring-1 ring-foreground/18",
          runtimeSpotlight?.ring,
          !isFocus && "saturate-50",
        )}
      >
        {runtimeSpotlight ? (
          <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 animate-pulse", runtimeSpotlight.glow, getShapeClassName(shape))} />
        ) : null}
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
        <div className="relative grid grid-cols-[1.35rem_minmax(0,1fr)] items-start gap-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[7px] bg-background/65 text-[10px] font-semibold text-muted-foreground ring-1 ring-border/35">
            {stepNumber}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span className={cn("size-2 rounded-full", styles.dot)} />
              <span className="truncate">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
            </div>

            <p className="mt-1 break-words text-[13px] font-semibold leading-snug text-foreground line-clamp-2">{node.title}</p>

            <div className="mt-1.5 flex items-center gap-2">
              {runtimeSpotlight ? (
                <span className={cn("rounded-[7px] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]", runtimeSpotlight.badge)}>
                  {runtimeSpotlight.label}
                </span>
              ) : (
                <span className="rounded-[7px] bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">{node.statusLabel ?? node.status}</span>
              )}
              {durationLabel ? (
                <span className="truncate text-[11px] font-medium text-muted-foreground">{durationLabel}</span>
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
