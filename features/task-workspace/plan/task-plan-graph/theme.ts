import { cn } from "@shared/ui"
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
    badge: "border-border bg-muted text-muted-foreground",
    ring: "ring-1 ring-border",
    glow: "bg-transparent",
  }),
  done: (node) => ({
    label: node.statusLabel ?? "Done",
    badge: "border-border bg-muted text-foreground",
    ring: "ring-1 ring-border",
    glow: "bg-transparent",
  }),
  completed: (node) => ({
    label: node.statusLabel ?? "Done",
    badge: "border-border bg-muted text-foreground",
    ring: "ring-1 ring-border",
    glow: "bg-transparent",
  }),
  active: () => ({
    label: "Running",
    badge: "border-primary/35 bg-primary-soft text-primary",
    ring: "ring-2 ring-primary/35",
    glow: "bg-transparent",
  }),
  in_progress: () => ({
    label: "Running",
    badge: "border-primary/35 bg-primary-soft text-primary",
    ring: "ring-2 ring-primary/35",
    glow: "bg-transparent",
  }),
  blocked: () => ({
    label: "Blocked",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    ring: "ring-2 ring-destructive/30",
    glow: "bg-transparent",
  }),
  failed: () => ({
    label: "Issue",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    ring: "ring-2 ring-destructive/30",
    glow: "bg-transparent",
  }),
  degraded: () => ({
    label: "Issue",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    ring: "ring-2 ring-destructive/30",
    glow: "bg-transparent",
  }),
  waiting: () => ({
    label: "Waiting",
    badge: "border-primary/25 bg-primary-soft text-primary",
    ring: "ring-1 ring-primary/25",
    glow: "bg-transparent",
  }),
  waiting_for_user: () => ({
    label: "Action",
    badge: "border-primary/25 bg-primary-soft text-primary",
    ring: "ring-1 ring-primary/25",
    glow: "bg-transparent",
  }),
  waiting_for_approval: () => ({
    label: "Action",
    badge: "border-primary/25 bg-primary-soft text-primary",
    ring: "ring-1 ring-primary/25",
    glow: "bg-transparent",
  }),
  ready: () => ({
    label: "Ready",
    badge: "border-primary/25 bg-primary-soft text-primary",
    ring: "ring-1 ring-primary/25",
    glow: "bg-transparent",
  }),
};

export const TASK_PLAN_GRAPH_THEME = {
  toneStyles: {
    active: {
      border: "border-primary/45",
      bg: "bg-primary-soft/70",
      ring: "ring-primary/30",
      dot: "bg-primary",
      text: "text-foreground",
    },
    attention: {
      border: "border-primary/35",
      bg: "bg-primary-soft/55",
      ring: "ring-primary/25",
      dot: "bg-primary",
      text: "text-foreground",
    },
    blocked: {
      border: "border-destructive/45",
      bg: "bg-destructive/10",
      ring: "ring-destructive/25",
      dot: "bg-destructive",
      text: "text-foreground",
    },
    done: {
      border: "border-border",
      bg: "bg-muted/55",
      ring: "ring-border",
      dot: "bg-muted-foreground",
      text: "text-foreground",
    },
    skipped: {
      border: "border-border border-dashed",
      bg: "bg-muted/50",
      ring: "ring-border",
      dot: "bg-muted-foreground/70",
      text: "text-muted-foreground",
    },
    upcoming: {
      border: "border-primary/30",
      bg: "bg-primary-soft/40",
      ring: "ring-primary/20",
      dot: "bg-primary/70",
      text: "text-foreground",
    },
    idle: {
      border: "border-border",
      bg: "bg-background/80",
      ring: "ring-border",
      dot: "bg-muted-foreground/70",
      text: "text-foreground",
    },
  } satisfies Record<NodeTone, NodeToneStyle>,
  kindStyles: {
    task: {
      accent: "from-primary via-primary to-primary",
      anchor: "border-primary/25 bg-primary-soft text-primary",
      badge: "border-primary/20 bg-primary-soft text-primary",
      card: "rounded-[14px] px-3 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2",
      halo: "bg-transparent",
      icon: "bg-primary",
      rail: "bg-primary/60",
      statusOffset: "right-3 top-3",
    },
    checkpoint: {
      accent: "from-muted-foreground via-muted-foreground to-muted-foreground",
      anchor: "border-border bg-muted text-foreground",
      badge: "border-border bg-muted text-foreground",
      card: "rounded-[18px_14px_14px_18px] py-2.5 pl-4 pr-3",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2.5",
      halo: "bg-transparent",
      icon: "bg-muted-foreground",
      rail: "bg-muted-foreground/60",
      statusOffset: "right-3 top-3",
    },
    condition: {
      accent: "from-primary via-primary to-primary",
      anchor: "border-primary/25 bg-primary-soft text-primary",
      badge: "border-primary/20 bg-primary-soft text-primary",
      card: "rounded-[20px] px-6 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-3",
      halo: "bg-transparent",
      icon: "bg-primary",
      rail: "bg-primary/60",
      statusOffset: "right-5 top-3",
    },
    wait: {
      accent: "from-muted-foreground via-muted-foreground to-muted-foreground",
      anchor: "border-border bg-muted text-muted-foreground",
      badge: "border-border bg-muted text-muted-foreground",
      card: "rounded-[999px] px-4 py-2.5",
      content: "grid-cols-[2rem_minmax(0,1fr)] gap-2.5",
      halo: "bg-transparent",
      icon: "bg-muted-foreground",
      rail: "bg-muted-foreground/50",
      statusOffset: "right-4 top-3",
    },
  } satisfies Record<"task" | "checkpoint" | "condition" | "wait", NodeKindTheme>,
  interactionStyles: {
    execute: {
      accent: "from-primary via-primary to-primary",
      label: "Execute",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    confirm: {
      accent: "from-primary via-primary to-primary",
      label: "Confirm",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    choose: {
      accent: "from-primary via-primary to-primary",
      label: "Choose",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    input: {
      accent: "from-primary via-primary to-primary",
      label: "Input",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    edit: {
      accent: "from-primary via-primary to-primary",
      label: "Edit",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    approve: {
      accent: "from-primary via-primary to-primary",
      label: "Approve",
      badge: "border-primary/20 bg-primary-soft text-primary",
    },
    retry: {
      accent: "from-destructive via-destructive to-destructive",
      label: "Retry",
      badge: "border-destructive/25 bg-destructive/10 text-destructive",
    },
    wait: {
      accent: "from-muted-foreground via-muted-foreground to-muted-foreground",
      label: "Wait",
      badge: "border-border bg-muted text-muted-foreground",
    },
    observe: {
      accent: "from-muted-foreground via-muted-foreground to-muted-foreground",
      label: "View",
      badge: "border-border bg-muted text-muted-foreground",
    },
  } satisfies Record<NonNullable<PlanNodeDataModel["interactionType"]>, NodeInteractionTheme>,
  visualWeightClassNames: {
    primary: "opacity-100",
    normal: "opacity-95",
    muted: "opacity-60",
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
