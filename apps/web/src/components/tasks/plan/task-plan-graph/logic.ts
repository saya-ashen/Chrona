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
    border: "border-cyan-300/75",
    bg: "bg-cyan-400/14",
    ring: "ring-cyan-300/45",
    dot: "bg-cyan-300",
    text: "text-cyan-50",
  },
  attention: {
    border: "border-fuchsia-300/70",
    bg: "bg-fuchsia-400/13",
    ring: "ring-fuchsia-300/40",
    dot: "bg-fuchsia-300",
    text: "text-fuchsia-50",
  },
  blocked: {
    border: "border-rose-300/80",
    bg: "bg-rose-500/14",
    ring: "ring-rose-300/45",
    dot: "bg-rose-300",
    text: "text-rose-50",
  },
  done: {
    border: "border-emerald-300/50",
    bg: "bg-emerald-400/9",
    ring: "ring-emerald-300/25",
    dot: "bg-emerald-300",
    text: "text-emerald-50",
  },
  skipped: {
    border: "border-slate-500/45 border-dashed",
    bg: "bg-slate-700/18",
    ring: "ring-slate-400/15",
    dot: "bg-slate-400/55",
    text: "text-slate-300",
  },
  upcoming: {
    border: "border-violet-300/62",
    bg: "bg-violet-400/12",
    ring: "ring-violet-300/32",
    dot: "bg-violet-300",
    text: "text-violet-50",
  },
  idle: {
    border: "border-slate-500/45",
    bg: "bg-slate-800/42",
    ring: "ring-white/10",
    dot: "bg-slate-300/70",
    text: "text-slate-100",
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
  if (emphasis === "inactive") return "rgba(100, 116, 139, 0.42)";
  if (emphasis === "blocked") return "rgba(251, 113, 133, 0.9)";
  if (emphasis === "active") return "rgba(103, 232, 249, 0.95)";
  switch (kind) {
    case "dependency":
      return "rgba(196, 181, 253, 0.8)";
    case "branch_true":
      return "rgba(110, 231, 183, 0.84)";
    case "branch_false":
      return "rgba(251, 146, 60, 0.84)";
    case "branch_option":
      return "rgba(232, 121, 249, 0.78)";
    case "resume":
      return "rgba(96, 165, 250, 0.82)";
    default:
      return "rgba(148, 163, 184, 0.68)";
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
    { label: graphCopy.statusActive, shape: "rounded", tone: "active" },
    {
      label: graphCopy.statusWaiting,
      shape: "parallelogram",
      tone: "attention",
    },
    { label: graphCopy.statusReady, shape: "rounded", tone: "upcoming" },
    { label: graphCopy.statusBlocked, shape: "diamond", tone: "blocked" },
    { label: graphCopy.statusDone, shape: "pill", tone: "done" },
    { label: graphCopy.nodeTypeTask, shape: "rounded", tone: "idle" },
    { label: graphCopy.nodeTypeCheckpoint, shape: "parallelogram", tone: "active" },
    { label: graphCopy.nodeTypeCondition, shape: "diamond", tone: "attention" },
    { label: graphCopy.nodeTypeWait, shape: "pill", tone: "upcoming" },
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
