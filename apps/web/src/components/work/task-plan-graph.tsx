"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import dagre from "@dagrejs/dagre";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

type PlanStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: "pending" | "in_progress" | "waiting_for_child" | "waiting_for_user" | "waiting_for_approval" | "done" | "blocked" | "skipped";
  requiresHumanInput: boolean;
  type?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  completionSummary?: string | null;
};

type PlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
};

type TaskPlanGraphMode = "full" | "compact" | "auto";
const AUTO_FULL_MODE_MIN_WIDTH = 720;

type TaskPlanGraphProps = {
  mode?: TaskPlanGraphMode;
  maxViewportHeight?: number;
  plan: {
    state: "empty" | "ready";
    currentStepId: string | null;
    steps: PlanStep[];
    edges?: PlanEdge[];
  };
};

const DEFAULT_GRAPH_COPY = {
  ariaLabel: "任务计划图",
  statusInProgress: "进行中",
  statusWaitingForChild: "子任务执行中",
  statusWaitingForUser: "等待你处理",
  statusWaitingForApproval: "等待审批",
  statusDone: "已完成",
  statusBlocked: "已阻塞",
  statusSkipped: "已跳过",
  statusPending: "待处理",
  edgeDependsOn: "依赖于",
  edgeBranchesTo: "分支到",
  edgeUnblocks: "解除阻塞",
  edgeFeedsOutput: "输出流向",
  edgeSequential: "顺序执行",
  requiresHumanInput: "需要用户输入",
  detailType: "类型",
  detailExecutionMode: "执行模式",
  detailPriority: "优先级",
  detailEstimatedDuration: "预计时长",
  detailLinkedTask: "关联任务",
  detailDescription: "详细说明",
  detailCompletionSummary: "完成情况说明",
} as const;

type GraphCopyType = Record<keyof typeof DEFAULT_GRAPH_COPY, string>;

type NodeTone =
  | "child-task"
  | "waiting"
  | "checkpoint"
  | "decision"
  | "deliverable"
  | "tool-action"
  | "done"
  | "blocked"
  | "current"
  | "default";

type FlowNodeData = {
  step: PlanStep;
  tone: NodeTone;
  isCurrent: boolean;
  isSelected: boolean;
  graphCopy: GraphCopyType;
  onToggle: (nodeId: string) => void;
};

type FlowGraphNode = Node<FlowNodeData, "taskPlanNode">;

const NODE_WIDTH = 180;
const NODE_HEIGHT = 124;
const EXPANDED_NODE_EXTRA_HEIGHT = 112;
const EXPANDED_LINKED_NODE_EXTRA_HEIGHT = 52;
const LAYOUT_DIRECTION = "TB";
const LAYOUT_PADDING = 20;
const LAYOUT_NODE_SEP = 8;
const LAYOUT_RANK_SEP = 52;
const EDGE_OFFSET = 18;
const MAX_VIEWPORT_HEIGHT = 540;
const MIN_VIEWPORT_HEIGHT = 260;
const SELECTED_NODE_Z_INDEX = 1000;

function getStatusLabel(status: PlanStep["status"], c: GraphCopyType) {
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

function getCompactStatusLabel(status: PlanStep["status"], c: GraphCopyType) {
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

type EdgeLegendItem = {
  type: string;
  label: string;
  stroke: string;
  dash: string | undefined;
  width: number;
};

type NodeShape = "rounded" | "diamond" | "pill" | "hex" | "parallelogram";

type NodeLegendItem = {
  type: string;
  label: string;
  shape: NodeShape;
  tone: NodeTone;
};

function getNodeTone(step: PlanStep): NodeTone {
  if (step.status === "blocked") return "blocked";
  if (step.status === "skipped") return "done";
  if (step.requiresHumanInput || step.status === "waiting_for_user")
    return "waiting";
  if (step.status === "waiting_for_child" || step.status === "waiting_for_approval")
    return "waiting";
  if (step.status === "in_progress") return "current";
  if (step.status === "done") return "done";

  if (step.type === "checkpoint") return "checkpoint";
  if (step.type === "decision") return "decision";
  if (step.type === "deliverable") return "deliverable";
  if (step.type === "tool_action") return "tool-action";
  if (step.executionMode === "automatic" || step.linkedTaskId)
    return "child-task";

  return step.priority === "Urgent" || step.priority === "High"
    ? "decision"
    : "default";
}

const TONE_STYLES: Record<
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
  decision: {
    border: "border-fuchsia-400/60",
    bg: "bg-fuchsia-50 dark:bg-fuchsia-950/30",
    ring: "ring-fuchsia-400/30",
    dot: "bg-fuchsia-500",
  },
  deliverable: {
    border: "border-cyan-400/60",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    ring: "ring-cyan-400/30",
    dot: "bg-cyan-500",
  },
  "tool-action": {
    border: "border-indigo-400/60",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    ring: "ring-indigo-400/30",
    dot: "bg-indigo-500",
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
    border: "border-sky-400/60",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    ring: "ring-sky-400/30",
    dot: "bg-sky-500",
  },
  default: {
    border: "border-border/50",
    bg: "bg-background",
    ring: "ring-border/20",
    dot: "bg-muted-foreground/40",
  },
};

function edgeStroke(type: string) {
  switch (type) {
    case "depends_on":
      return "rgba(168, 85, 247, 0.82)";
    case "branches_to":
      return "rgba(236, 72, 153, 0.82)";
    case "unblocks":
      return "rgba(34, 197, 94, 0.86)";
    case "feeds_output":
      return "rgba(14, 165, 233, 0.84)";
    default:
      return "rgba(100, 116, 139, 0.64)";
  }
}

function edgeDash(type: string) {
  switch (type) {
    case "depends_on":
      return "10 4";
    case "branches_to":
      return "3 6";
    case "feeds_output":
      return "14 5";
    default:
      return undefined;
  }
}

function edgeWidth(type: string) {
  switch (type) {
    case "unblocks":
      return 2.4;
    case "feeds_output":
      return 2.2;
    case "depends_on":
      return 2;
    case "branches_to":
      return 1.9;
    default:
      return 1.7;
  }
}

function buildEdgeStyle(type: string) {
  return {
    stroke: edgeStroke(type),
    strokeWidth: edgeWidth(type),
    strokeDasharray: edgeDash(type),
  };
}

function buildEdgeLegend(graphCopy: GraphCopyType): EdgeLegendItem[] {
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
    {
      type: "branches_to",
      label: graphCopy.edgeBranchesTo,
      stroke: edgeStroke("branches_to"),
      dash: edgeDash("branches_to"),
      width: edgeWidth("branches_to"),
    },
    {
      type: "unblocks",
      label: graphCopy.edgeUnblocks,
      stroke: edgeStroke("unblocks"),
      dash: edgeDash("unblocks"),
      width: edgeWidth("unblocks"),
    },
    {
      type: "feeds_output",
      label: graphCopy.edgeFeedsOutput,
      stroke: edgeStroke("feeds_output"),
      dash: edgeDash("feeds_output"),
      width: edgeWidth("feeds_output"),
    },
  ];
}

function nodeShapeForStep(step: PlanStep): NodeShape {
  switch (step.type) {
    case "decision":
      return "diamond";
    case "deliverable":
      return "pill";
    case "tool_action":
      return "hex";
    case "checkpoint":
      return "parallelogram";
    default:
      return "rounded";
  }
}

function nodeLegendLabel(type: string) {
  switch (type) {
    case "decision":
      return `${type} · 决策/审批`;
    case "deliverable":
      return `${type} · 交付结果`;
    case "tool_action":
      return `${type} · 自动执行`;
    case "checkpoint":
      return `${type} · 检查点`;
    case "user_input":
      return `${type} · 用户输入`;
    default:
      return `${type} · 普通步骤`;
  }
}

function buildNodeLegend(): NodeLegendItem[] {
  const steps: PlanStep[] = [
    { id: "legend-step", title: "", objective: "", phase: "", status: "pending", requiresHumanInput: false, type: "step" },
    { id: "legend-user", title: "", objective: "", phase: "", status: "waiting_for_user", requiresHumanInput: true, type: "user_input" },
    { id: "legend-checkpoint", title: "", objective: "", phase: "", status: "pending", requiresHumanInput: false, type: "checkpoint" },
    { id: "legend-decision", title: "", objective: "", phase: "", status: "pending", requiresHumanInput: false, type: "decision" },
    { id: "legend-tool", title: "", objective: "", phase: "", status: "pending", requiresHumanInput: false, type: "tool_action", executionMode: "automatic" },
    { id: "legend-deliverable", title: "", objective: "", phase: "", status: "pending", requiresHumanInput: false, type: "deliverable" },
  ];

  return steps.map((step) => ({
    type: step.type ?? "step",
    label: nodeLegendLabel(step.type ?? "step"),
    shape: nodeShapeForStep(step),
    tone: getNodeTone(step),
  }));
}

function ShapeChip({ shape, tone, className }: { shape: NodeShape; tone: NodeTone; className?: string }) {
  const s = TONE_STYLES[tone];
  const base = cn("block h-4 w-6 border shadow-sm", s.border, s.bg, className);

  if (shape === "diamond") {
    return <span aria-hidden="true" className={cn(base, "rotate-45 rounded-[2px]")} />;
  }

  if (shape === "pill") {
    return <span aria-hidden="true" className={cn(base, "rounded-full")} />;
  }

  if (shape === "hex") {
    return <span aria-hidden="true" className={cn(base, "rounded-[6px]")} style={{ clipPath: "polygon(18% 0%, 82% 0%, 100% 50%, 82% 100%, 18% 100%, 0% 50%)" }} />;
  }

  if (shape === "parallelogram") {
    return <span aria-hidden="true" className={cn(base, "rounded-[4px]")} style={{ clipPath: "polygon(14% 0%, 100% 0%, 86% 100%, 0% 100%)" }} />;
  }

  return <span aria-hidden="true" className={cn(base, "rounded-xl")} />;
}

function EdgeLegend({ edgeItems, nodeItems }: { edgeItems: EdgeLegendItem[]; nodeItems: NodeLegendItem[] }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex justify-end p-3">
      <div
        className="rounded-2xl border border-border/60 bg-background/92 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur"
        data-testid="task-plan-graph-legend"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            {edgeItems.map((item) => (
              <div
                key={item.type}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  height="8"
                  viewBox="0 0 28 8"
                  width="28"
                >
                  <line
                    stroke={item.stroke}
                    strokeDasharray={item.dash}
                    strokeLinecap="round"
                    strokeWidth={item.width}
                    x1="1"
                    x2="27"
                    y1="4"
                    y2="4"
                  />
                </svg>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5" data-testid="task-plan-graph-node-legend">
            {nodeItems.map((item) => (
              <div
                key={item.type}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
              >
                <ShapeChip shape={item.shape} tone={item.tone} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatEstimatedDuration(minutes?: number | null) {
  if (typeof minutes !== "number") return "-";
  return `${minutes} min`;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-foreground">{value}</p>
    </div>
  );
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { step, tone, isCurrent, isSelected, onToggle, graphCopy } = data;
  const s = TONE_STYLES[tone];
  const shape = nodeShapeForStep(step);
  const shapeClassName =
    shape === "pill"
      ? "rounded-[999px]"
      : shape === "diamond"
        ? "rounded-[10px]"
        : shape === "hex"
          ? "rounded-[12px]"
          : shape === "parallelogram"
            ? "rounded-[10px]"
            : "rounded-2xl";
  const shapeStyle =
    shape === "diamond"
      ? { clipPath: "polygon(8% 0%, 92% 0%, 100% 50%, 92% 100%, 8% 100%, 0% 50%)" }
      : shape === "hex"
        ? { clipPath: "polygon(12% 0%, 88% 0%, 100% 28%, 100% 72%, 88% 100%, 12% 100%, 0% 72%, 0% 28%)" }
        : shape === "parallelogram"
          ? { clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" }
          : undefined;

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle
        type="target"
        position={Position.Top}
        className="!top-0 !size-3 !-translate-y-1/2 !border-2 !border-background !bg-border/80"
      />
      <button
        type="button"
        onClick={() => onToggle(step.id)}
        data-testid={`task-plan-node-${step.id}`}
        data-node-tone={tone}
        data-node-shape={shape}
        data-node-current={isCurrent ? "true" : "false"}
        data-node-selected={isSelected ? "true" : "false"}
        className={cn(
          "rf-node-button group relative w-full border px-3 py-2.5 text-left transition-all duration-200",
          "shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)]",
          shapeClassName,
          s.border,
          s.bg,
          isCurrent && "ring-2",
          isCurrent && s.ring,
          isSelected && !isCurrent && "ring-1 ring-foreground/10",
        )}
        style={shapeStyle}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-1 flex flex-col items-center gap-1">
            <span className={cn("size-2 rounded-full shadow-sm", s.dot)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="min-w-0 text-[10px] leading-snug text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                <span className="font-semibold uppercase tracking-[0.12em]">
                  {step.phase}
                </span>
                {step.type && step.type !== step.phase?.toLowerCase() ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {step.type && step.type !== step.phase?.toLowerCase() ? (
                  <span className="truncate">{step.type}</span>
                ) : null}
                {!isSelected ? <span aria-hidden="true">·</span> : null}
                {!isSelected ? (
                  <span>{getCompactStatusLabel(step.status, graphCopy)}</span>
                ) : null}
                {typeof step.estimatedMinutes === "number" ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {typeof step.estimatedMinutes === "number" ? (
                  <span>{step.estimatedMinutes}m</span>
                ) : null}
              </div>
            </div>
            <p className="mt-1 text-sm font-medium leading-snug text-foreground line-clamp-2">
              {step.title}
            </p>
            {isSelected ? (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1 text-[10px] leading-none text-muted-foreground">
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">
                    {getStatusLabel(step.status, graphCopy)}
                  </span>
                  {typeof step.estimatedMinutes === "number" ? (
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">
                      {step.estimatedMinutes}m
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {step.objective}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {isSelected ? (
          <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
            <DetailItem
              label={graphCopy.detailDescription}
              value={step.objective}
            />
            <div className="grid gap-1.5 sm:grid-cols-2">
              <DetailItem
                label={graphCopy.detailType}
                value={step.type ?? "step"}
              />
              <DetailItem
                label={graphCopy.detailExecutionMode}
                value={step.executionMode ?? "none"}
              />
              <DetailItem
                label={graphCopy.detailPriority}
                value={step.priority ?? "-"}
              />
              <DetailItem
                label={graphCopy.detailEstimatedDuration}
                value={formatEstimatedDuration(step.estimatedMinutes)}
              />
            </div>
            {step.linkedTaskId ? (
              <DetailItem
                label={graphCopy.detailLinkedTask}
                value={step.linkedTaskId}
              />
            ) : null}
            {step.completionSummary ? (
              <DetailItem
                label={graphCopy.detailCompletionSummary}
                value={step.completionSummary}
              />
            ) : null}
          </div>
        ) : null}
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bottom-0 !top-auto !size-3 !translate-y-1/2 !border-2 !border-background !bg-border/80"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};

function calculateNodeHeight(step: PlanStep, isSelected: boolean) {
  if (!isSelected) return NODE_HEIGHT;
  return (
    NODE_HEIGHT +
    EXPANDED_NODE_EXTRA_HEIGHT +
    (step.linkedTaskId ? EXPANDED_LINKED_NODE_EXTRA_HEIGHT : 0)
  );
}

function buildFlowLayout(input: {
  steps: PlanStep[];
  edges: PlanEdge[];
  currentStepId: string | null;
  selectedStepId: string | null;
  graphCopy: GraphCopyType;
  onToggle: (nodeId: string) => void;
  maxViewportHeight: number;
}) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: LAYOUT_DIRECTION,
    align: "UL",
    nodesep: LAYOUT_NODE_SEP,
    ranksep: LAYOUT_RANK_SEP,
    marginx: LAYOUT_PADDING,
    marginy: LAYOUT_PADDING,
  });

  for (const step of input.steps) {
    graph.setNode(step.id, {
      width: NODE_WIDTH,
      height: calculateNodeHeight(step, input.selectedStepId === step.id),
    });
  }

  for (const edge of input.edges) {
    graph.setEdge(edge.fromNodeId, edge.toNodeId);
  }

  dagre.layout(graph);

  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const step of input.steps) {
    const layoutNode = graph.node(step.id);
    if (!layoutNode) continue;
    const left = layoutNode.x - layoutNode.width / 2;
    const top = layoutNode.y - layoutNode.height / 2;
    const right = layoutNode.x + layoutNode.width / 2;
    const bottom = layoutNode.y + layoutNode.height / 2;

    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, right);
    maxBottom = Math.max(maxBottom, bottom);
  }

  if (
    !Number.isFinite(minLeft) ||
    !Number.isFinite(minTop) ||
    !Number.isFinite(maxRight) ||
    !Number.isFinite(maxBottom)
  ) {
    minLeft = 0;
    minTop = 0;
    maxRight = NODE_WIDTH;
    maxBottom = NODE_HEIGHT;
  }

  const contentWidth = Math.max(
    Math.ceil(maxRight - minLeft + LAYOUT_PADDING * 2),
    NODE_WIDTH + LAYOUT_PADDING * 2,
  );
  const contentHeight = Math.max(
    Math.ceil(
      maxBottom - minTop + LAYOUT_PADDING * 2 + (input.selectedStepId ? 32 : 0),
    ),
    NODE_HEIGHT + LAYOUT_PADDING * 2,
  );
  const viewportHeight = Math.min(
    Math.max(contentHeight, MIN_VIEWPORT_HEIGHT),
    input.maxViewportHeight,
  );

  const nodes: FlowGraphNode[] = input.steps.map((step) => {
    const layoutNode = graph.node(step.id) ?? {
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    const isSelected = step.id === input.selectedStepId;
    return {
      id: step.id,
      type: "taskPlanNode",
      position: {
        x: layoutNode.x - layoutNode.width / 2 - minLeft + LAYOUT_PADDING,
        y: layoutNode.y - layoutNode.height / 2 - minTop + LAYOUT_PADDING,
      },
      width: layoutNode.width,
      height: layoutNode.height,
      initialWidth: layoutNode.width,
      initialHeight: layoutNode.height,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      style: {
        zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      },
      data: {
        step,
        tone: getNodeTone(step),
        isCurrent: step.id === input.currentStepId,
        isSelected,
        graphCopy: input.graphCopy,
        onToggle: input.onToggle,
      },
    };
  });

  const edges: Edge[] = input.edges.map((edge) => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    type: "smoothstep",
    selectable: false,
    reconnectable: false,
    animated: false,
    pathOptions: {
      borderRadius: 0,
      offset: EDGE_OFFSET,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeStroke(edge.type),
    },
    style: buildEdgeStyle(edge.type),
  }));

  return { nodes, edges, contentWidth, contentHeight, viewportHeight };
}

function syncNodeState(
  nodes: FlowGraphNode[],
  input: {
    currentStepId: string | null;
    selectedStepId: string | null;
    graphCopy: GraphCopyType;
    onToggle: (nodeId: string) => void;
  },
) {
  return nodes.map((node) => {
    const isSelected = node.id === input.selectedStepId;
    return {
      ...node,
      draggable: false,
      selectable: false,
      zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      style: {
        ...node.style,
        zIndex: isSelected ? SELECTED_NODE_Z_INDEX : 1,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        ...node.data,
        isCurrent: node.id === input.currentStepId,
        isSelected,
        graphCopy: input.graphCopy,
        onToggle: input.onToggle,
      },
    };
  });
}

function buildCompactSections(plan: TaskPlanGraphProps["plan"]) {
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();

  for (const step of plan.steps) {
    incomingCounts.set(step.id, 0);
    outgoingCounts.set(step.id, 0);
  }

  for (const edge of plan.edges ?? []) {
    incomingCounts.set(edge.toNodeId, (incomingCounts.get(edge.toNodeId) ?? 0) + 1);
    outgoingCounts.set(edge.fromNodeId, (outgoingCounts.get(edge.fromNodeId) ?? 0) + 1);
  }

  const current = plan.steps.filter((step) => step.id === plan.currentStepId);
  const attention = plan.steps.filter(
    (step) => step.id !== plan.currentStepId && (step.status === "waiting_for_user" || step.status === "blocked"),
  );
  const next = plan.steps.filter(
    (step) =>
      step.id !== plan.currentStepId &&
      !attention.some((candidate) => candidate.id === step.id) &&
      ((incomingCounts.get(step.id) ?? 0) > 0 || step.linkedTaskId),
  );
  const summary = plan.steps.filter(
    (step) =>
      step.id !== plan.currentStepId &&
      !attention.some((candidate) => candidate.id === step.id) &&
      !next.some((candidate) => candidate.id === step.id),
  );

  return {
    incomingCounts,
    outgoingCounts,
    groups: [
      { id: "current", title: "当前推进", steps: current },
      { id: "attention", title: "待处理 / 阻塞", steps: attention },
      { id: "next", title: "后续摘要", steps: next },
      { id: "summary", title: "其余节点", steps: summary },
    ].filter((group) => group.steps.length > 0),
  };
}

function CompactOutlineNode({
  step,
  incomingCount,
  outgoingCount,
  graphCopy,
  isCurrent,
  isSelected,
  onToggle,
}: {
  step: PlanStep;
  incomingCount: number;
  outgoingCount: number;
  graphCopy: GraphCopyType;
  isCurrent: boolean;
  isSelected: boolean;
  onToggle: (nodeId: string) => void;
}) {
  const tone = getNodeTone(step);
  const s = TONE_STYLES[tone];
  const relationSummary = [incomingCount > 0 ? `${incomingCount} 个前置` : null, outgoingCount > 0 ? `${outgoingCount} 个后续` : null, step.linkedTaskId ? "已关联任务" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onToggle(step.id)}
      className={cn(
        "group relative w-full rounded-2xl border px-3 py-2 text-left transition-colors",
        s.border,
        s.bg,
        isCurrent && "ring-2",
        isCurrent && s.ring,
        isSelected && !isCurrent && "ring-1 ring-foreground/10",
      )}
      data-node-current={isCurrent ? "true" : "false"}
      data-node-selected={isSelected ? "true" : "false"}
      data-node-tone={tone}
      data-testid={`task-plan-outline-node-${step.id}`}
    >
      <div className="absolute left-0 top-2 bottom-2 w-px bg-border/50" aria-hidden="true" />
      <div className="flex items-start gap-2.5 pl-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-snug text-muted-foreground">
            {isCurrent ? <span className="font-semibold text-foreground/80">当前节点</span> : null}
            {isCurrent ? <span aria-hidden="true">·</span> : null}
            <span className="font-semibold uppercase tracking-[0.12em]">{step.phase}</span>
            <span aria-hidden="true">·</span>
            <span>{getCompactStatusLabel(step.status, graphCopy)}</span>
            {step.type && step.type !== step.phase?.toLowerCase() ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{step.type}</span>
              </>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground line-clamp-2">{step.title}</p>
          {relationSummary ? <p className="mt-1 text-[11px] text-muted-foreground">{relationSummary}</p> : null}
          {isSelected ? (
            <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{getStatusLabel(step.status, graphCopy)}</span>
                {typeof step.estimatedMinutes === "number" ? (
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{step.estimatedMinutes}m</span>
                ) : null}
                {step.executionMode ? <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{step.executionMode}</span> : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.objective}</p>
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

type TaskPlanGraphFrameProps = {
  graphCopy: GraphCopyType;
  layout: ReturnType<typeof buildFlowLayout>;
  nodes: FlowGraphNode[];
  edges: Edge[];
  edgeLegend: EdgeLegendItem[];
  nodeLegend: NodeLegendItem[];
  handleNodeClick: NodeMouseHandler<FlowGraphNode>;
  handleNodeDragStart: (event: React.MouseEvent<Element>) => void;
  handleNodeDrag: (event: React.MouseEvent<Element>) => void;
  handleNodeDragStop: (event: React.MouseEvent<Element>) => void;
  testId?: string;
};

function TaskPlanGraphFrame({
  graphCopy,
  layout,
  nodes,
  edges,
  edgeLegend,
  nodeLegend,
  handleNodeClick,
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  testId = "task-plan-graph",
}: TaskPlanGraphFrameProps) {
  return (
    <div
      aria-label={graphCopy.ariaLabel}
      className="relative overflow-hidden rounded-[22px] border border-border/50 bg-muted/[0.16]"
      data-canvas-pan="true"
      data-edge-style="orthogonal"
      data-graph-editable="false"
      data-graph-interactive="true"
      data-graph-mode="full"
      data-layout-direction={LAYOUT_DIRECTION}
      data-layout-engine="dagre"
      data-renderer="react-flow"
      data-testid={testId}
    >
      <div className="relative">
        <div
          className="w-full overflow-auto"
          data-testid="task-plan-graph-scroll"
          style={{ height: `${layout.viewportHeight}px` }}
        >
          <div
            className="min-w-full"
            data-testid="task-plan-graph-canvas"
            style={{
              height: `${layout.contentHeight}px`,
              minWidth: `${layout.contentWidth}px`,
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              noPanClassName="rf-node-button"
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              selectNodesOnDrag={false}
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              zoomOnDoubleClick={false}
              preventScrolling={false}
              attributionPosition="bottom-left"
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ zIndex: 0 }}
              className="bg-transparent"
              translateExtent={[
                [0, 0],
                [layout.contentWidth, layout.contentHeight],
              ]}
            />
          </div>
        </div>
        <EdgeLegend edgeItems={edgeLegend} nodeItems={nodeLegend} />
      </div>
    </div>
  );
}

export function TaskPlanGraph({
  plan,
  mode = "full",
  maxViewportHeight = MAX_VIEWPORT_HEIGHT,
}: TaskPlanGraphProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isFullDialogOpen, setIsFullDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const { messages } = useI18n();
  const graphCopy = useMemo(
    () =>
      ({
        ...DEFAULT_GRAPH_COPY,
        ...(messages.components?.taskPlanGraph ?? {}),
      }) as GraphCopyType,
    [messages.components],
  );

  const handleToggleNode = useCallback((nodeId: string) => {
    setSelectedStepId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const allEdges = useMemo(() => plan.edges ?? [], [plan.edges]);
  const layout = useMemo(
    () =>
      buildFlowLayout({
        steps: plan.steps,
        edges: allEdges,
        currentStepId: plan.currentStepId,
        selectedStepId,
        graphCopy,
        onToggle: handleToggleNode,
        maxViewportHeight,
      }),
    [
      allEdges,
      graphCopy,
      handleToggleNode,
      maxViewportHeight,
      plan.currentStepId,
      plan.steps,
      selectedStepId,
    ],
  );

  const [nodes, setNodes] = useNodesState<FlowGraphNode>(layout.nodes);
  const [edges, setEdges] = useEdgesState(layout.edges);
  const edgeLegend = useMemo(() => buildEdgeLegend(graphCopy), [graphCopy]);
  const nodeLegend = useMemo(() => buildNodeLegend(), []);
  const compactSections = useMemo(() => buildCompactSections(plan), [plan]);

  const handleNodeClick = useCallback<NodeMouseHandler<FlowGraphNode>>(
    (event, node) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button[data-testid^='task-plan-node-']")) {
        return;
      }
      handleToggleNode(node.id);
    },
    [handleToggleNode],
  );

  const handleNodeDragStart = useCallback(
    (event: React.MouseEvent<Element>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button[data-testid^='task-plan-node-']")) {
        event.preventDefault();
      }
    },
    [],
  );

  const handleNodeDrag = useCallback((event: React.MouseEvent<Element>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button[data-testid^='task-plan-node-']")) {
      event.preventDefault();
    }
  }, []);

  const handleNodeDragStop = useCallback((event: React.MouseEvent<Element>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button[data-testid^='task-plan-node-']")) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (plan.state !== "ready" || plan.steps.length === 0) {
      setSelectedStepId(null);
      return;
    }

    if (
      selectedStepId &&
      plan.steps.some((step) => step.id === selectedStepId)
    ) {
      return;
    }

    setSelectedStepId(null);
  }, [plan.state, plan.steps, selectedStepId]);

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout.edges, layout.nodes, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      syncNodeState(current, {
        currentStepId: plan.currentStepId,
        selectedStepId,
        graphCopy,
        onToggle: handleToggleNode,
      }),
    );
  }, [
    graphCopy,
    handleToggleNode,
    plan.currentStepId,
    selectedStepId,
    setNodes,
  ]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const readWidth = (element: HTMLElement | null): number => {
      if (!element) return 0;
      const direct = element.clientWidth || element.getBoundingClientRect().width || 0;
      if (direct > 0) return direct;

      const styled = Number.parseFloat(element.style.width || "0");
      if (Number.isFinite(styled) && styled > 0) return styled;

      return readWidth(element.parentElement);
    };

    const measure = () => {
      const nextWidth = readWidth(node);
      setContainerWidth((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth));
    };

    measure();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
  }, []);

  const resolvedMode: Exclude<TaskPlanGraphMode, "auto"> =
    mode === "auto" ? (containerWidth >= AUTO_FULL_MODE_MIN_WIDTH ? "full" : "compact") : mode;

  if (plan.state !== "ready" || plan.steps.length === 0) return null;

  if (resolvedMode === "compact") {
    return (
      <>
        <div ref={containerRef} className="w-full">
          <div
            aria-label={graphCopy.ariaLabel}
            className="rounded-[22px] border border-border/50 bg-muted/[0.16] p-3"
            data-graph-editable="false"
            data-graph-interactive="true"
            data-graph-mode="compact"
            data-testid="task-plan-graph"
          >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">紧凑任务图</p>
              <p className="text-xs text-muted-foreground">侧边栏摘要模式，仅保留关键推进关系。</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
              onClick={() => setIsFullDialogOpen(true)}
            >
              查看完整图
            </button>
          </div>

          <div className="space-y-3 border-l border-border/60 pl-3" data-testid="task-plan-compact-groups">
            {compactSections.groups.map((group) => (
              <section key={group.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-px flex-1 bg-border/60" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.title}</p>
                </div>
                <div className="space-y-2">
                  {group.steps.map((step) => (
                    <CompactOutlineNode
                      key={step.id}
                      step={step}
                      incomingCount={compactSections.incomingCounts.get(step.id) ?? 0}
                      outgoingCount={compactSections.outgoingCounts.get(step.id) ?? 0}
                      graphCopy={graphCopy}
                      isCurrent={step.id === plan.currentStepId}
                      isSelected={step.id === selectedStepId}
                      onToggle={handleToggleNode}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        </div>

        {isFullDialogOpen ? (
          <>
            <div className="fixed inset-0 z-40 bg-slate-950/35" onClick={() => setIsFullDialogOpen(false)} />
            <section
              role="dialog"
              aria-modal="true"
              aria-label="完整任务计划图"
              className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,920px)] w-[min(1180px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
                <div className="space-y-1">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">完整任务计划图</h1>
                  <p className="text-sm text-muted-foreground">展示完整的 DAG 关系、语义连线和节点详情。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullDialogOpen(false)}
                  aria-label="关闭完整任务计划图"
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <TaskPlanGraphFrame
                  graphCopy={graphCopy}
                  layout={layout}
                  nodes={nodes}
                  edges={edges}
                  edgeLegend={edgeLegend}
                  nodeLegend={nodeLegend}
                  handleNodeClick={handleNodeClick}
                  handleNodeDragStart={handleNodeDragStart}
                  handleNodeDrag={handleNodeDrag}
                  handleNodeDragStop={handleNodeDragStop}
                  testId="task-plan-graph-full-dialog"
                />
              </div>
            </section>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <TaskPlanGraphFrame
        graphCopy={graphCopy}
        layout={layout}
        nodes={nodes}
        edges={edges}
        edgeLegend={edgeLegend}
        nodeLegend={nodeLegend}
        handleNodeClick={handleNodeClick}
        handleNodeDragStart={handleNodeDragStart}
        handleNodeDrag={handleNodeDrag}
        handleNodeDragStop={handleNodeDragStop}
      />
    </div>
  );
}
