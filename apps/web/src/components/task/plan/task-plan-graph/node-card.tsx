import { CircleHelp, Clock, GitBranch, ListTodo, ShieldCheck, UserRoundPen } from "lucide-react";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { getShapeClassName, nodeKindLabel, TONE_STYLES } from "./logic";
import type { FlowGraphNode } from "./types";

function formatEstimatedMinutes(value: number | null) {
  return typeof value === "number" ? `${value} min` : null;
}

function resolveInteractionBadge(node: FlowGraphNode["data"]["node"]) {
  switch (node.interactionType) {
    case "execute":
      return { label: "Startable", className: "bg-violet-500/12 text-violet-700 dark:text-violet-200" };
    case "confirm":
      return { label: "Confirm", className: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-200" };
    case "choose":
      return { label: "Choose", className: "bg-amber-500/14 text-amber-800 dark:text-amber-200" };
    case "input":
      return { label: "Input", className: "bg-amber-500/14 text-amber-800 dark:text-amber-200" };
    case "edit":
      return { label: "Edit", className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-200" };
    case "approve":
      return { label: "Approve", className: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-200" };
    case "wait":
      return { label: "Wait", className: "bg-slate-500/12 text-slate-700 dark:text-slate-200" };
    case "retry":
      return { label: "Retry", className: "bg-rose-500/12 text-rose-700 dark:text-rose-200" };
    default:
      return { label: "Observe", className: "bg-sky-500/12 text-sky-700 dark:text-sky-200" };
  }
}

function resolveInteractionFrame(node: FlowGraphNode["data"]["node"]) {
  switch (node.interactionType) {
    case "execute":
      return { accent: "before:bg-violet-500", footer: "Ready to launch" };
    case "confirm":
      return { accent: "before:bg-indigo-500", footer: "Manual confirmation" };
    case "choose":
      return { accent: "before:bg-amber-500", footer: `${Math.max((node.options ?? []).length, 1)} option flow` };
    case "input":
      return { accent: "before:bg-amber-500", footer: `${Math.max((node.interactiveFields ?? []).length, 1)} field input` };
    case "edit":
      return { accent: "before:bg-emerald-500", footer: "Revision checkpoint" };
    case "approve":
      return { accent: "before:bg-fuchsia-500", footer: "Approval gate" };
    case "retry":
      return { accent: "before:bg-rose-500", footer: "Recovery path" };
    case "wait":
      return { accent: "before:bg-slate-500", footer: "External wait" };
    default:
      return { accent: "before:bg-sky-500", footer: "Runtime observe" };
  }
}

function resolveRuntimeSpotlight(node: FlowGraphNode["data"]["node"]) {
  if (node.interactionType === "execute" || node.status === "ready") {
    return {
      label: "Ready to start",
      badge: "bg-violet-500 text-white",
      ring: "ring-2 ring-violet-400/55 shadow-[0_0_0_6px_rgba(139,92,246,0.12)]",
      glow: "bg-violet-300/18",
    };
  }

  if (node.status === "active") {
    return {
      label: "Running now",
      badge: "bg-sky-500 text-white",
      ring: "ring-2 ring-sky-400/55 shadow-[0_0_0_6px_rgba(56,189,248,0.14)]",
      glow: "bg-sky-400/18",
    };
  }

  if (node.interactionType === "approve") {
    return {
      label: "Needs approval",
      badge: "bg-fuchsia-500 text-white",
      ring: "ring-2 ring-fuchsia-400/55 shadow-[0_0_0_6px_rgba(217,70,239,0.12)]",
      glow: "bg-fuchsia-400/16",
    };
  }

  if (node.interactionType === "confirm") {
    return {
      label: "Needs confirmation",
      badge: "bg-indigo-500 text-white",
      ring: "ring-2 ring-indigo-400/55 shadow-[0_0_0_6px_rgba(99,102,241,0.12)]",
      glow: "bg-indigo-300/16",
    };
  }

  if (node.interactionType === "choose") {
    return {
      label: "Needs choice",
      badge: "bg-amber-500 text-white",
      ring: "ring-2 ring-amber-400/60 shadow-[0_0_0_6px_rgba(251,191,36,0.14)]",
      glow: "bg-amber-300/18",
    };
  }

  if (node.interactionType === "edit") {
    return {
      label: "Needs edit",
      badge: "bg-emerald-500 text-white",
      ring: "ring-2 ring-emerald-400/55 shadow-[0_0_0_6px_rgba(52,211,153,0.12)]",
      glow: "bg-emerald-300/16",
    };
  }

  if (node.interactionType === "input") {
    return {
      label: "Needs input",
      badge: "bg-amber-500 text-white",
      ring: "ring-2 ring-amber-400/60 shadow-[0_0_0_6px_rgba(251,191,36,0.14)]",
      glow: "bg-amber-300/18",
    };
  }

  if (node.status === "blocked") {
    return {
      label: "Needs retry",
      badge: "bg-rose-500 text-white",
      ring: "ring-2 ring-rose-400/55 shadow-[0_0_0_6px_rgba(244,63,94,0.12)]",
      glow: "bg-rose-300/16",
    };
  }

  return null;
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { node, tone, shape, isSelected, isCurrent, isFocus, onSelect, graphCopy } = data;
  const styles = TONE_STYLES[tone];
  const runtimeSpotlight = resolveRuntimeSpotlight(node);
  const interactionBadge = resolveInteractionBadge(node);
  const interactionFrame = resolveInteractionFrame(node);
  const primaryActionLabel = node.availableActions?.[0]?.label ?? null;
  const durationLabel = formatEstimatedMinutes(node.estimatedMinutes ?? null);

  const Icon =
    node.kind === "checkpoint"
      ? node.interactionType === "approve"
        ? ShieldCheck
        : UserRoundPen
      : node.kind === "condition"
        ? GitBranch
        : node.kind === "wait"
          ? Clock
          : node.interactionType === "input"
            ? CircleHelp
            : ListTodo;

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!top-0 !size-3 !-translate-y-1/2 !border-2 !border-background !bg-border/80" />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        data-testid={`task-plan-node-${node.id}`}
        data-node-tone={node.linkedTaskId ? "child-task" : tone}
        data-node-shape={shape}
        data-node-current={isCurrent ? "true" : "false"}
        data-node-display-type={node.displayType ?? node.kind ?? node.type ?? "task"}
        data-node-selected={isSelected ? "true" : "false"}
        className={cn(
          "rf-node-button group relative w-full overflow-hidden border px-3 py-2.5 text-left transition-all duration-200",
          "before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r-full before:content-['']",
          "shadow-[0_6px_14px_rgba(15,23,42,0.05)] hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)]",
          getShapeClassName(shape),
          styles.border,
          styles.bg,
          styles.text,
          interactionFrame.accent,
          isSelected && "ring-2 ring-foreground/12",
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
        <div className="relative flex items-start gap-3">
          <div className="mt-0.5 flex flex-col items-center gap-1">
            <span className={cn("size-2 rounded-full shadow-sm", styles.dot)} />
            <Icon className="size-3 shrink-0 text-muted-foreground/70" />
          </div>
          <div className="min-w-0 flex-1">
            {runtimeSpotlight ? (
              <div className="mb-1.5 flex items-center gap-2">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]", runtimeSpotlight.badge)}>
                  {runtimeSpotlight.label}
                </span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <span>{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
              <span aria-hidden="true">•</span>
              <span>{node.statusLabel ?? node.status}</span>
            </div>

            <p className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug text-foreground">{node.title}</p>

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", interactionBadge.className)}>{interactionBadge.label}</span>
              {durationLabel ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{durationLabel}</span>
              ) : null}
              {isSelected && node.executionMode ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{node.executionMode}</span>
              ) : null}
              {isSelected && node.priority ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{node.priority}</span>
              ) : null}
              {isSelected && node.linkedTaskId ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{node.linkedTaskId}</span>
              ) : null}
              {primaryActionLabel ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{primaryActionLabel}</span>
              ) : null}
            </div>
            {isSelected ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                详细说明 {node.objective}
              </p>
            ) : null}
            {typeof node.metadata?.prompt === "string" ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {node.metadata.prompt}
              </p>
            ) : null}
          </div>
        </div>
      </button>
      <Handle type="source" position={Position.Bottom} className="!bottom-0 !top-auto !size-3 !translate-y-1/2 !border-2 !border-background !bg-border/80" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};
