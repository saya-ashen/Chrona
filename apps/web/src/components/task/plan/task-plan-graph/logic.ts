import { cn } from "@/lib/utils";
import type {
  EdgeLegendItem,
  GraphCopy,
  NodeLegendItem,
  NodeShape,
  NodeTone,
  PlanStep,
} from "./types";

export function getStatusLabel(status: PlanStep["status"], c: GraphCopy) {
  switch (status) {
    case "in_progress":
      return c.statusInProgress;
    case "waiting_for_child":
      return c.statusWaitingForChild;
    case "waiting_for_user":
      return c.statusWaitingForUser;
    case "waiting_for_approval":
      return c.statusWaitingForApproval;
    case "done":
      return c.statusDone;
    case "blocked":
      return c.statusBlocked;
    case "skipped":
      return c.statusSkipped;
    default:
      return c.statusPending;
  }
}

export function getCompactStatusLabel(status: PlanStep["status"], c: GraphCopy) {
  switch (status) {
    case "in_progress":
      return c.statusInProgress;
    case "waiting_for_child":
      return "子任务执行中";
    case "waiting_for_user":
      return "需处理";
    case "waiting_for_approval":
      return "待审批";
    case "done":
      return c.statusDone;
    case "blocked":
      return c.statusBlocked;
    case "skipped":
      return "已跳过";
    default:
      return "待办";
  }
}

export function getNodeTone(step: PlanStep): NodeTone {
  if (step.status === "blocked") return "blocked";
  if (step.status === "skipped") return "done";
  if (step.requiresHumanInput || step.status === "waiting_for_user") return "waiting";
  if (step.status === "waiting_for_approval") return "checkpoint-approve";
  if (step.status === "waiting_for_child") return "waiting";
  if (step.status === "in_progress") return "current";
  if (step.status === "done") return "done";

  const dt = step.displayType ?? step.type;

  if (dt === "condition") return "condition";
  if (dt === "wait") return "wait";
  if (dt === "checkpoint") {
    const meta = step.metadata;
    const checkpointType =
      meta && typeof meta === "object"
        ? (meta as Record<string, unknown>).checkpointType
        : undefined;
    if (checkpointType === "approve" || checkpointType === "confirm") {
      return "checkpoint-approve";
    }
    return "checkpoint";
  }
  if (step.executionMode === "automatic" || step.linkedTaskId) return "child-task";

  return "default";
}

export const TONE_STYLES: Record<
  NodeTone,
  { border: string; bg: string; ring: string; dot: string }
> = {
  "child-task": {
    border: "border-emerald-400/60",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    ring: "ring-emerald-400/30",
    dot: "bg-emerald-500",
  },
  waiting: {
    border: "border-amber-400/60",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    ring: "ring-amber-400/30",
    dot: "bg-amber-500",
  },
  checkpoint: {
    border: "border-violet-400/60",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    ring: "ring-violet-400/30",
    dot: "bg-violet-500",
  },
  "checkpoint-approve": {
    border: "border-rose-400/60",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    ring: "ring-rose-400/30",
    dot: "bg-rose-500",
  },
  condition: {
    border: "border-yellow-400/60",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    ring: "ring-yellow-400/30",
    dot: "bg-yellow-500",
  },
  wait: {
    border: "border-cyan-400/60",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    ring: "ring-cyan-400/30",
    dot: "bg-cyan-500",
  },
  done: {
    border: "border-slate-300/60",
    bg: "bg-slate-50 dark:bg-slate-900/30",
    ring: "ring-slate-300/30",
    dot: "bg-slate-400",
  },
  blocked: {
    border: "border-rose-400/60",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    ring: "ring-rose-400/30",
    dot: "bg-rose-500",
  },
  current: {
    border: "border-amber-400/60",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    ring: "ring-amber-400/30",
    dot: "bg-amber-500",
  },
  default: {
    border: "border-border/50",
    bg: "bg-background",
    ring: "ring-border/20",
    dot: "bg-muted-foreground/40",
  },
};

export function edgeStroke(type: string) {
  switch (type) {
    case "depends_on":
      return "rgba(168, 85, 247, 0.82)";
    default:
      return "rgba(100, 116, 139, 0.64)";
  }
}

export function edgeDash(type: string) {
  switch (type) {
    case "depends_on":
      return "8 4";
    default:
      return undefined;
  }
}

export function edgeWidth(type: string) {
  switch (type) {
    case "depends_on":
      return 2;
    default:
      return 1.7;
  }
}

export function buildEdgeStyle(type: string) {
  return {
    stroke: edgeStroke(type),
    strokeWidth: edgeWidth(type),
    strokeDasharray: edgeDash(type),
  };
}

export function nodeShapeForStep(step: PlanStep): NodeShape {
  const dt = step.displayType ?? step.type;
  switch (dt) {
    case "condition":
      return "diamond";
    case "wait":
      return "pill";
    case "checkpoint":
      return "parallelogram";
    default:
      return "rounded";
  }
}

export function nodeLegendLabel(type: string, graphCopy: GraphCopy) {
  switch (type) {
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

export function buildEdgeLegend(graphCopy: GraphCopy): EdgeLegendItem[] {
  return [
    {
      type: "sequential",
      label: graphCopy.edgeSequential,
      stroke: edgeStroke("sequential"),
      dash: edgeDash("sequential"),
      width: edgeWidth("sequential"),
    },
    {
      type: "depends_on",
      label: graphCopy.edgeDependsOn,
      stroke: edgeStroke("depends_on"),
      dash: edgeDash("depends_on"),
      width: edgeWidth("depends_on"),
    },
  ];
}

export function buildNodeLegend(graphCopy: GraphCopy): NodeLegendItem[] {
  const steps: PlanStep[] = [
    {
      id: "legend-task",
      title: "",
      objective: "",
      phase: "",
      status: "pending",
      requiresHumanInput: false,
      displayType: "task",
    },
    {
      id: "legend-checkpoint",
      title: "",
      objective: "",
      phase: "",
      status: "pending",
      requiresHumanInput: true,
      displayType: "checkpoint",
    },
    {
      id: "legend-condition",
      title: "",
      objective: "",
      phase: "",
      status: "pending",
      requiresHumanInput: false,
      displayType: "condition",
    },
    {
      id: "legend-wait",
      title: "",
      objective: "",
      phase: "",
      status: "pending",
      requiresHumanInput: false,
      displayType: "wait",
    },
  ];

  return steps.map((step) => ({
    type: step.displayType ?? "task",
    label: nodeLegendLabel(step.displayType ?? "task", graphCopy),
    shape: nodeShapeForStep(step),
    tone: getNodeTone(step),
  }));
}

export function getShapeClassName(shape: NodeShape) {
  if (shape === "pill") return "rounded-[999px]";
  if (shape === "diamond") return "rounded-[10px]";
  if (shape === "parallelogram") return "rounded-[12px]";
  return "rounded-2xl";
}

export function getShapeStyle(shape: NodeShape) {
  if (shape === "diamond") {
    return { clipPath: "polygon(8% 0%, 92% 0%, 100% 50%, 92% 100%, 8% 100%, 0% 50%)" };
  }
  if (shape === "parallelogram") {
    return { clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" };
  }
  return undefined;
}

export function shapeChipClassName(shape: NodeShape, tone: NodeTone, className?: string) {
  const s = TONE_STYLES[tone];
  return cn("block h-4 w-6 border shadow-sm", s.border, s.bg, className, getShapeClassName(shape));
}
