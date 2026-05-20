import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
import type { NodeShape, NodeTone, PlanNodeDataModel } from "./types";

type NodeToneStyle = {
  border: string;
  bg: string;
  ring: string;
  dot: string;
  text: string;
};

type NodeKindTheme = {
  accent: string;
  anchor: string;
  badge: string;
  card: string;
  content: string;
  halo: string;
  icon: string;
  rail: string;
  statusOffset: string;
};

type NodeInteractionTheme = {
  accent: string;
  label: string;
  badge: string;
};

type RuntimeSpotlightTheme = {
  label: string;
  badge: string;
  ring: string;
  glow: string;
};

type RuntimeSpotlightResolver = (node: PlanNodeDataModel) => RuntimeSpotlightTheme;

const runtimeSpotlightByStatus: Partial<Record<PlanNodeDataModel["status"], RuntimeSpotlightResolver>> = {
  skipped: (node) => ({
    label: node.statusLabel ?? "Skipped",
    badge: "border-slate-500/55 bg-slate-800/80 text-slate-300",
    ring: "ring-1 ring-slate-500/25",
    glow: "bg-transparent",
  }),
  done: (node) => ({
    label: node.statusLabel ?? "Done",
    badge: "border-emerald-300/32 bg-emerald-400/9 text-emerald-100",
    ring: "ring-1 ring-emerald-300/16",
    glow: "bg-transparent",
  }),
  completed: (node) => ({
    label: node.statusLabel ?? "Done",
    badge: "border-emerald-300/32 bg-emerald-400/9 text-emerald-100",
    ring: "ring-1 ring-emerald-300/16",
    glow: "bg-transparent",
  }),
  active: () => ({
    label: "Running",
    badge: "border-cyan-200/65 bg-cyan-300/20 text-cyan-50",
    ring: "ring-2 ring-cyan-200/65",
    glow: "bg-cyan-300/22",
  }),
  in_progress: () => ({
    label: "Running",
    badge: "border-cyan-200/65 bg-cyan-300/20 text-cyan-50",
    ring: "ring-2 ring-cyan-200/65",
    glow: "bg-cyan-300/22",
  }),
  blocked: () => ({
    label: "Blocked",
    badge: "border-rose-200/65 bg-rose-300/20 text-rose-50",
    ring: "ring-2 ring-rose-200/55",
    glow: "bg-rose-300/18",
  }),
  failed: () => ({
    label: "Issue",
    badge: "border-rose-200/65 bg-rose-300/20 text-rose-50",
    ring: "ring-2 ring-rose-200/55",
    glow: "bg-rose-300/18",
  }),
  degraded: () => ({
    label: "Issue",
    badge: "border-rose-200/65 bg-rose-300/20 text-rose-50",
    ring: "ring-2 ring-rose-200/55",
    glow: "bg-rose-300/18",
  }),
  waiting: () => ({
    label: "Waiting",
    badge: "border-fuchsia-200/60 bg-fuchsia-300/18 text-fuchsia-50",
    ring: "ring-1 ring-fuchsia-300/45",
    glow: "bg-fuchsia-400/16",
  }),
  waiting_for_user: () => ({
    label: "Action",
    badge: "border-fuchsia-200/60 bg-fuchsia-300/18 text-fuchsia-50",
    ring: "ring-1 ring-fuchsia-300/45",
    glow: "bg-fuchsia-400/16",
  }),
  waiting_for_approval: () => ({
    label: "Action",
    badge: "border-fuchsia-200/60 bg-fuchsia-300/18 text-fuchsia-50",
    ring: "ring-1 ring-fuchsia-300/45",
    glow: "bg-fuchsia-400/16",
  }),
  ready: () => ({
    label: "Ready",
    badge: "border-violet-300/45 bg-violet-400/18 text-violet-100",
    ring: "ring-1 ring-violet-300/45",
    glow: "bg-violet-400/16",
  }),
};

export const TASK_PLAN_GRAPH_THEME = {
  toneStyles: {
    active: {
      border: "border-cyan-200/85",
      bg: "bg-cyan-300/[0.18]",
      ring: "ring-cyan-200/55",
      dot: "bg-cyan-200",
      text: "text-cyan-50",
    },
    attention: {
      border: "border-fuchsia-200/80",
      bg: "bg-fuchsia-300/[0.16]",
      ring: "ring-fuchsia-200/50",
      dot: "bg-fuchsia-200",
      text: "text-fuchsia-50",
    },
    blocked: {
      border: "border-rose-200/90",
      bg: "bg-rose-400/[0.18]",
      ring: "ring-rose-200/55",
      dot: "bg-rose-200",
      text: "text-rose-50",
    },
    done: {
      border: "border-emerald-300/44",
      bg: "bg-emerald-500/[0.055]",
      ring: "ring-emerald-300/18",
      dot: "bg-emerald-300/75",
      text: "text-emerald-100",
    },
    skipped: {
      border: "border-slate-500/48 border-dashed",
      bg: "bg-slate-700/[0.16]",
      ring: "ring-slate-400/14",
      dot: "bg-slate-400/55",
      text: "text-slate-300",
    },
    upcoming: {
      border: "border-violet-300/65",
      bg: "bg-violet-400/[0.13]",
      ring: "ring-violet-300/34",
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
  } satisfies Record<NodeTone, NodeToneStyle>,
  kindStyles: {
    task: {
      accent: "from-cyan-300 via-sky-400 to-blue-500",
      anchor: "border-cyan-100/35 bg-cyan-300/16 text-cyan-50",
      badge: "border-cyan-300/24 bg-cyan-300/10 text-cyan-100",
      card: "rounded-[14px] px-3 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2",
      halo: "bg-cyan-300/12",
      icon: "bg-cyan-200/90 shadow-[0_0_16px_rgba(125,211,252,0.34)]",
      rail: "bg-cyan-300/75",
      statusOffset: "right-3 top-3",
    },
    checkpoint: {
      accent: "from-lime-200 via-emerald-300 to-teal-400",
      anchor: "border-emerald-100/40 bg-emerald-300/18 text-emerald-50",
      badge: "border-emerald-200/45 bg-emerald-300/16 text-emerald-50",
      card: "rounded-[18px_14px_14px_18px] py-2.5 pl-4 pr-3",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2.5",
      halo: "bg-emerald-300/16",
      icon: "bg-emerald-200 shadow-[0_0_18px_rgba(110,231,183,0.42)]",
      rail: "bg-emerald-300/95",
      statusOffset: "right-3 top-3",
    },
    condition: {
      accent: "from-violet-200 via-fuchsia-400 to-rose-400",
      anchor: "border-fuchsia-100/42 bg-fuchsia-300/18 text-fuchsia-50",
      badge: "border-fuchsia-200/50 bg-fuchsia-300/18 text-fuchsia-50",
      card: "rounded-[20px] px-6 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-3",
      halo: "bg-fuchsia-300/18",
      icon: "bg-fuchsia-200 shadow-[0_0_20px_rgba(217,70,239,0.46)]",
      rail: "bg-fuchsia-300",
      statusOffset: "right-5 top-3",
    },
    wait: {
      accent: "from-slate-300 via-slate-400 to-slate-600",
      anchor: "border-slate-200/28 bg-slate-300/12 text-slate-100",
      badge: "border-slate-300/22 bg-slate-300/10 text-slate-200",
      card: "rounded-[999px] px-4 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2.5",
      halo: "bg-slate-300/10",
      icon: "bg-slate-300/80 shadow-[0_0_14px_rgba(148,163,184,0.24)]",
      rail: "bg-slate-300/65",
      statusOffset: "right-4 top-3",
    },
  } satisfies Record<"task" | "checkpoint" | "condition" | "wait", NodeKindTheme>,
  interactionStyles: {
    execute: {
      accent: "from-cyan-300 via-sky-400 to-blue-500",
      label: "Execute",
      badge: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    },
    confirm: {
      accent: "from-indigo-300 via-violet-400 to-fuchsia-500",
      label: "Confirm",
      badge: "border-indigo-300/22 bg-indigo-300/10 text-indigo-100",
    },
    choose: {
      accent: "from-amber-200 via-orange-300 to-fuchsia-400",
      label: "Choose",
      badge: "border-orange-300/24 bg-orange-300/10 text-orange-100",
    },
    input: {
      accent: "from-amber-200 via-orange-300 to-rose-400",
      label: "Input",
      badge: "border-amber-300/24 bg-amber-300/10 text-amber-100",
    },
    edit: {
      accent: "from-emerald-200 via-teal-300 to-cyan-400",
      label: "Edit",
      badge: "border-teal-300/24 bg-teal-300/10 text-teal-100",
    },
    approve: {
      accent: "from-fuchsia-200 via-pink-400 to-rose-400",
      label: "Approve",
      badge: "border-pink-300/24 bg-pink-300/10 text-pink-100",
    },
    retry: {
      accent: "from-rose-200 via-red-400 to-orange-400",
      label: "Retry",
      badge: "border-rose-300/26 bg-rose-300/10 text-rose-100",
    },
    wait: {
      accent: "from-slate-400 via-slate-500 to-slate-600",
      label: "Wait",
      badge: "border-slate-300/18 bg-slate-300/8 text-slate-200",
    },
    observe: {
      accent: "from-sky-300 via-cyan-400 to-blue-500",
      label: "View",
      badge: "border-sky-300/20 bg-sky-300/10 text-sky-100",
    },
  } satisfies Record<NonNullable<PlanNodeDataModel["interactionType"]>, NodeInteractionTheme>,
  visualWeightClassNames: {
    primary: "saturate-125 brightness-110",
    normal: "saturate-90 brightness-95",
    muted: "saturate-[0.45] brightness-70 contrast-90",
  },
  shapeClassNames: {
    rounded: "rounded-[12px]",
    diamond: "rounded-[8px]",
    pill: "rounded-[999px]",
    parallelogram: "rounded-[10px]",
  } satisfies Record<NodeShape, string>,
  shapeStyles: {
    diamond: { clipPath: "polygon(16% 0%, 84% 0%, 100% 50%, 84% 100%, 16% 100%, 0% 50%)" },
    parallelogram: { clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" },
  } satisfies Partial<Record<NodeShape, CSSProperties>>,
} as const;

export const TONE_STYLES = TASK_PLAN_GRAPH_THEME.toneStyles;

export function getShapeClassName(shape: NodeShape) {
  return TASK_PLAN_GRAPH_THEME.shapeClassNames[shape];
}

export function getShapeStyle(shape: NodeShape) {
  const shapeStyles: Partial<Record<NodeShape, CSSProperties>> = TASK_PLAN_GRAPH_THEME.shapeStyles;
  return shapeStyles[shape];
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

export function resolveNodeKindTheme(node: PlanNodeDataModel): NodeKindTheme {
  const kind = node.displayType ?? node.kind ?? node.type;
  if (kind === "checkpoint" || kind === "user_input") return TASK_PLAN_GRAPH_THEME.kindStyles.checkpoint;
  if (kind === "condition") return TASK_PLAN_GRAPH_THEME.kindStyles.condition;
  if (kind === "wait") return TASK_PLAN_GRAPH_THEME.kindStyles.wait;
  return TASK_PLAN_GRAPH_THEME.kindStyles.task;
}

export function resolveInteractionTheme(node: PlanNodeDataModel): NodeInteractionTheme {
  return TASK_PLAN_GRAPH_THEME.interactionStyles[node.interactionType ?? "observe"];
}

export function resolveRuntimeSpotlightTheme(node: PlanNodeDataModel): RuntimeSpotlightTheme | null {
  return runtimeSpotlightByStatus[node.status]?.(node) ?? null;
}
