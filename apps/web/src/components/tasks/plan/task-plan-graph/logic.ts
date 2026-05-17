import { cn } from "@/lib/utils";
import type {
  EdgeLegendItem,
  GraphCopy,
  NodeLegendItem,
  NodeShape,
  NodeTone,
  PlanEdgeEmphasis,
  PlanEdgeKind,
  PlanNodeDataModel,
} from "./types";

export function getNodeTone(node: PlanNodeDataModel): NodeTone {
  if (node.status === "blocked" || node.status === "failed" || node.status === "degraded") return "blocked";
  if (node.status === "active" || node.status === "in_progress") return "active";
  if (node.status === "waiting" || node.status === "waiting_for_user" || node.status === "waiting_for_approval") return "attention";
  if (node.status === "skipped") return "skipped";
  if (node.status === "done" || node.status === "completed" || node.status === "cancelled" || node.status === "invalidated") return "done";
  if (node.status === "ready") return "upcoming";
  return "idle";
}

export const TONE_STYLES: Record<
  NodeTone,
  { border: string; bg: string; ring: string; dot: string; text: string }
> = {
  active: {
    border: "border-sky-500/35",
    bg: "bg-sky-100/90 dark:bg-sky-950/40",
    ring: "ring-sky-400/30",
    dot: "bg-sky-500",
    text: "text-sky-900 dark:text-sky-100",
  },
  attention: {
    border: "border-amber-500/35",
    bg: "bg-amber-100/90 dark:bg-amber-950/40",
    ring: "ring-amber-400/30",
    dot: "bg-amber-500",
    text: "text-amber-900 dark:text-amber-100",
  },
  blocked: {
    border: "border-rose-500/40",
    bg: "bg-rose-100/90 dark:bg-rose-950/40",
    ring: "ring-rose-400/30",
    dot: "bg-rose-500",
    text: "text-rose-900 dark:text-rose-100",
  },
  done: {
    border: "border-slate-300/55",
    bg: "bg-slate-100/92 dark:bg-slate-900/45",
    ring: "ring-slate-300/30",
    dot: "bg-slate-400",
    text: "text-slate-800 dark:text-slate-100",
  },
  skipped: {
    border: "border-slate-300/45 border-dashed",
    bg: "bg-slate-100/62 dark:bg-slate-900/28",
    ring: "ring-slate-300/18",
    dot: "bg-slate-400/55",
    text: "text-slate-600 dark:text-slate-300",
  },
  upcoming: {
    border: "border-violet-400/38",
    bg: "bg-violet-100/92 dark:bg-violet-950/40",
    ring: "ring-violet-400/30",
    dot: "bg-violet-500",
    text: "text-violet-900 dark:text-violet-100",
  },
  idle: {
    border: "border-slate-300/50",
    bg: "bg-slate-100/85 dark:bg-slate-900/35",
    ring: "ring-border/20",
    dot: "bg-slate-500/60",
    text: "text-slate-900 dark:text-slate-100",
  },
};

export function nodeShapeForKind(kind: PlanNodeDataModel["kind"]): NodeShape {
  if (kind === "condition") return "diamond";
  if (kind === "wait") return "pill";
  if (kind === "checkpoint") return "parallelogram";
  return "rounded";
}

export function nodeKindLabel(
  kind: PlanNodeDataModel["kind"],
  graphCopy: GraphCopy,
) {
  switch (kind) {
    case "condition":
      return graphCopy.nodeTypeCondition;
    case "wait":
      return graphCopy.nodeTypeWait;
    case "checkpoint":
      return graphCopy.nodeTypeCheckpoint;
    default:
      return graphCopy.nodeTypeTask;
  }
}

export function interactionLabel(
  interactionType: PlanNodeDataModel["interactionType"],
) {
  switch (interactionType) {
    case "execute":
      return "Execute";
    case "confirm":
      return "Confirm";
    case "choose":
      return "Choose";
    case "input":
      return "Input";
    case "edit":
      return "Edit";
    case "approve":
      return "Approve";
    case "wait":
      return "Wait";
    case "retry":
      return "Retry";
    default:
      return "Observe";
  }
}

function edgeStroke(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  if (emphasis === "inactive") return "rgba(100, 116, 139, 0.44)";
  if (emphasis === "blocked") return "rgba(225, 29, 72, 0.72)";
  if (emphasis === "active") return "rgba(14, 165, 233, 0.82)";
  switch (kind) {
    case "dependency":
      return "rgba(168, 85, 247, 0.82)";
    case "branch_true":
      return "rgba(16, 185, 129, 0.82)";
    case "branch_false":
      return "rgba(249, 115, 22, 0.82)";
    case "branch_option":
      return "rgba(234, 179, 8, 0.82)";
    case "resume":
      return "rgba(59, 130, 246, 0.82)";
    default:
      return "rgba(100, 116, 139, 0.66)";
  }
}

export function edgeDash(kind: PlanEdgeKind, emphasis: PlanEdgeEmphasis = "normal") {
  if (emphasis === "inactive") return "3 6";
  if (kind === "dependency") return "7 4";
  if (kind === "resume") return "4 4";
  return undefined;
}

export function edgeWidth(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  if (emphasis === "inactive") return 1.45;
  if (emphasis !== "normal") return 2.1;
  if (kind === "sequential") return 1.55;
  return 1.35;
}

export function buildEdgeStyle(
  kind: PlanEdgeKind,
  emphasis: PlanEdgeEmphasis,
) {
  return {
    stroke: edgeStroke(kind, emphasis),
    strokeWidth: edgeWidth(kind, emphasis),
    strokeDasharray: edgeDash(kind, emphasis),
  };
}

export function buildEdgeLegend(graphCopy: GraphCopy): EdgeLegendItem[] {
  return [
    {
      label: graphCopy.statusActive,
      stroke: edgeStroke("sequential", "active"),
      width: 2.6,
    },
    {
      label: graphCopy.edgeSequential,
      stroke: edgeStroke("sequential", "normal"),
      width: 2,
    },
    {
      label: graphCopy.edgeDependency,
      stroke: edgeStroke("dependency", "normal"),
      dash: edgeDash("dependency"),
      width: 1.8,
    },
    {
      label: graphCopy.edgeBranch,
      stroke: edgeStroke("branch_option", "normal"),
      width: 1.8,
    },
    {
      label: graphCopy.statusSkipped,
      stroke: edgeStroke("branch_option", "inactive"),
      dash: edgeDash("branch_option", "inactive"),
      width: 1.6,
    },
    {
      label: graphCopy.statusBlocked,
      stroke: edgeStroke("sequential", "blocked"),
      width: 2.6,
    },
    {
      label: graphCopy.edgeResume,
      stroke: edgeStroke("resume", "normal"),
      dash: edgeDash("resume"),
      width: 1.8,
    },
  ];
}

export function buildNodeLegend(graphCopy: GraphCopy): NodeLegendItem[] {
  return [
    { label: graphCopy.nodeTypeTask, shape: "rounded", tone: "idle" },
    {
      label: graphCopy.nodeTypeCheckpoint,
      shape: "parallelogram",
      tone: "attention",
    },
    { label: graphCopy.nodeTypeCondition, shape: "diamond", tone: "blocked" },
    { label: graphCopy.nodeTypeWait, shape: "pill", tone: "done" },
    { label: graphCopy.statusActive, shape: "rounded", tone: "active" },
    {
      label: graphCopy.statusWaiting,
      shape: "parallelogram",
      tone: "attention",
    },
    { label: graphCopy.statusReady, shape: "rounded", tone: "upcoming" },
    { label: graphCopy.statusBlocked, shape: "diamond", tone: "blocked" },
    { label: graphCopy.statusDone, shape: "pill", tone: "done" },
    { label: graphCopy.statusSkipped, shape: "rounded", tone: "skipped" },
  ];
}

export function getShapeClassName(shape: NodeShape) {
  if (shape === "pill") return "rounded-[999px]";
  if (shape === "diamond") return "rounded-[8px]";
  if (shape === "parallelogram") return "rounded-[10px]";
  return "rounded-[12px]";
}

export function getShapeStyle(shape: NodeShape) {
  if (shape === "diamond")
    return {
      clipPath: "polygon(16% 0%, 84% 0%, 100% 50%, 84% 100%, 16% 100%, 0% 50%)",
    };
  if (shape === "parallelogram")
    return { clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" };
  return undefined;
}

export function shapeChipClassName(
  shape: NodeShape,
  tone: NodeTone,
  className?: string,
) {
  const toneStyle = TONE_STYLES[tone];
  return cn(
    "block h-4 w-7 border shadow-sm",
    toneStyle.border,
    toneStyle.bg,
    className,
    getShapeClassName(shape),
  );
}
