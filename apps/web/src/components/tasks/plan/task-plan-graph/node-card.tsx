import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { getShapeClassName, nodeKindLabel, TONE_STYLES } from "./logic";
import type { FlowGraphNode } from "./types";

function resolveWorkspaceStatus(node: FlowGraphNode["data"]["node"]) {
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
  const workspaceStatus = resolveWorkspaceStatus(node);
  const requiresAction = node.status === "blocked" || workspaceStatus === "approval-needed";

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!top-0 !size-2.5 !-translate-y-1/2 !border-2 !border-background !bg-border/80" />
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
        data-node-workspace-status={workspaceStatus}
        className={cn(
          "rf-node-button group relative w-full overflow-hidden border px-2.5 py-1.5 text-left transition-colors duration-150",
          "before:absolute before:inset-y-2.5 before:left-0 before:w-px before:rounded-r-full before:content-['']",
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
        <div className="relative grid grid-cols-[1.1rem_minmax(0,1fr)] items-start gap-1.5">
          <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[6px] bg-background/65 text-[8px] font-semibold text-muted-foreground ring-1 ring-border/35">
            {stepNumber}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 text-[8px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", styles.dot)} />
              <span className="truncate">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
            </div>

            <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-snug text-foreground">{node.title}</p>

            <div className="mt-1 flex items-center gap-1.5">
              {runtimeSpotlight ? (
                <span className={cn("rounded-[6px] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em]", runtimeSpotlight.badge)}>
                  {runtimeSpotlight.label}
                </span>
              ) : (
                <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[8px] font-medium text-muted-foreground">{node.statusLabel ?? node.status}</span>
              )}
              {durationLabel ? (
                <span className="truncate text-[10px] font-medium text-muted-foreground">{durationLabel}</span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
      <Handle type="source" position={Position.Bottom} className="!bottom-0 !top-auto !size-2.5 !translate-y-1/2 !border-2 !border-background !bg-border/80" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};
