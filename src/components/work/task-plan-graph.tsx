"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type PlanStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";
  needsUserInput: boolean;
  type?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
};

type PlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
};

type TaskPlanGraphProps = {
  plan: {
    state: "empty" | "ready";
    currentStepId: string | null;
    steps: PlanStep[];
    edges?: PlanEdge[];
  };
};

// ────────────────────────────────────────────────────────────
// i18n copy
// ────────────────────────────────────────────────────────────

const DEFAULT_GRAPH_COPY = {
  ariaLabel: "Task plan graph",
  statusInProgress: "In progress",
  statusWaitingForUser: "Waiting for user",
  statusDone: "Done",
  statusBlocked: "Blocked",
  statusPending: "Pending",
  edgeDependsOn: "Depends on",
  edgeBranchesTo: "Branches to",
  edgeUnblocks: "Unblocks",
  edgeFeedsOutput: "Output feeds",
  edgeSequential: "Sequential",
  outgoingEdges: "Out {count}",
  incomingEdges: "In {count}",
  needsUserInput: "Needs user input",
  detailStatus: "Status",
  detailType: "Type",
  detailExecutionMode: "Execution mode",
  detailPriority: "Priority",
  detailEstimatedDuration: "Estimated duration",
  detailLinkedTask: "Linked task",
  detailDescription: "Description",
} as const;

type GraphCopyType = Record<keyof typeof DEFAULT_GRAPH_COPY, string>;

function getStatusLabel(status: PlanStep["status"], c: GraphCopyType) {
  switch (status) {
    case "in_progress": return c.statusInProgress;
    case "waiting_for_user": return c.statusWaitingForUser;
    case "done": return c.statusDone;
    case "blocked": return c.statusBlocked;
    default: return c.statusPending;
  }
}

function getEdgeLabel(type: string, c: GraphCopyType) {
  switch (type) {
    case "depends_on": return c.edgeDependsOn;
    case "branches_to": return c.edgeBranchesTo;
    case "unblocks": return c.edgeUnblocks;
    case "feeds_output": return c.edgeFeedsOutput;
    default: return c.edgeSequential;
  }
}

// ────────────────────────────────────────────────────────────
// Node visual config
// ────────────────────────────────────────────────────────────

type NodeTone =
  | "child-task" | "waiting" | "checkpoint" | "decision"
  | "deliverable" | "tool-action" | "done" | "blocked" | "current" | "default";

function getNodeTone(step: PlanStep): NodeTone {
  if (step.executionMode === "child_task" || step.linkedTaskId) return "child-task";
  if (step.needsUserInput || step.status === "waiting_for_user") return "waiting";
  if (step.type === "checkpoint") return "checkpoint";
  if (step.type === "decision") return "decision";
  if (step.type === "deliverable") return "deliverable";
  if (step.type === "tool_action") return "tool-action";
  if (step.status === "done") return "done";
  if (step.status === "blocked") return "blocked";
  if (step.status === "in_progress") return "current";
  return "default";
}

const TONE_STYLES: Record<NodeTone, { border: string; bg: string; ring: string; dot: string }> = {
  "child-task":  { border: "border-emerald-400/60", bg: "bg-emerald-50 dark:bg-emerald-950/30", ring: "ring-emerald-400/30", dot: "bg-emerald-500" },
  waiting:       { border: "border-amber-400/60",   bg: "bg-amber-50 dark:bg-amber-950/30",     ring: "ring-amber-400/30",   dot: "bg-amber-500" },
  checkpoint:    { border: "border-violet-400/60",   bg: "bg-violet-50 dark:bg-violet-950/30",   ring: "ring-violet-400/30",  dot: "bg-violet-500" },
  decision:      { border: "border-fuchsia-400/60",  bg: "bg-fuchsia-50 dark:bg-fuchsia-950/30", ring: "ring-fuchsia-400/30", dot: "bg-fuchsia-500" },
  deliverable:   { border: "border-cyan-400/60",     bg: "bg-cyan-50 dark:bg-cyan-950/30",       ring: "ring-cyan-400/30",    dot: "bg-cyan-500" },
  "tool-action": { border: "border-indigo-400/60",   bg: "bg-indigo-50 dark:bg-indigo-950/30",   ring: "ring-indigo-400/30",  dot: "bg-indigo-500" },
  done:          { border: "border-slate-300/60",     bg: "bg-slate-50 dark:bg-slate-900/30",     ring: "ring-slate-300/30",   dot: "bg-slate-400" },
  blocked:       { border: "border-rose-400/60",      bg: "bg-rose-50 dark:bg-rose-950/30",       ring: "ring-rose-400/30",    dot: "bg-rose-500" },
  current:       { border: "border-sky-400/60",       bg: "bg-sky-50 dark:bg-sky-950/30",         ring: "ring-sky-400/30",     dot: "bg-sky-500" },
  default:       { border: "border-border/50",        bg: "bg-background",                        ring: "ring-border/20",      dot: "bg-muted-foreground/40" },
};

const EDGE_DASH: Record<string, string> = {
  depends_on: "6,4",
  branches_to: "3,3",
  feeds_output: "8,3",
};

function edgeColor(type: string) {
  switch (type) {
    case "depends_on": return "stroke-violet-400/60";
    case "branches_to": return "stroke-fuchsia-400/60";
    case "unblocks": return "stroke-emerald-400/60";
    case "feeds_output": return "stroke-cyan-400/60";
    default: return "stroke-muted-foreground/25";
  }
}

// ────────────────────────────────────────────────────────────
// DetailItem
// ────────────────────────────────────────────────────────────

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-foreground">{value}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// FlowNode
// ────────────────────────────────────────────────────────────

function FlowNode({
  step,
  tone,
  isCurrent,
  isSelected,
  onClick,
  graphCopy,
}: {
  step: PlanStep;
  tone: NodeTone;
  isCurrent: boolean;
  isSelected: boolean;
  onClick: () => void;
  graphCopy: GraphCopyType;
}) {
  const s = TONE_STYLES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`task-plan-node-${step.id}`}
      data-node-tone={tone}
      data-node-current={isCurrent ? "true" : "false"}
      className={cn(
        "group relative w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200",
        s.border, s.bg,
        isCurrent && "ring-2",
        isCurrent && s.ring,
        isSelected && !isCurrent && "ring-1 ring-foreground/10",
        "hover:shadow-md hover:shadow-black/5",
      )}
    >
      {/* Status dot */}
      <div className="flex items-start gap-3">
        <div className="mt-1.5 flex flex-col items-center gap-1">
          <span className={cn("size-2.5 rounded-full shadow-sm", s.dot)} />
        </div>
        <div className="min-w-0 flex-1">
          {/* Phase + chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {step.phase}
            </span>
            {step.type && step.type !== step.phase?.toLowerCase() ? (
              <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {step.type}
              </span>
            ) : null}
            {typeof step.estimatedMinutes === "number" ? (
              <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {step.estimatedMinutes}m
              </span>
            ) : null}
          </div>
          {/* Title */}
          <p className="mt-1 text-sm font-medium leading-snug text-foreground">
            {step.title}
          </p>
          {/* Objective — collapsed unless selected */}
          {isSelected ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.objective}</p>
          ) : null}
        </div>
        {/* Status badge */}
        <span className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          step.status === "done" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
          step.status === "in_progress" && "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
          step.status === "waiting_for_user" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
          step.status === "blocked" && "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
          step.status === "pending" && "bg-muted text-muted-foreground",
        )}>
          {getStatusLabel(step.status, graphCopy)}
        </span>
      </div>

      {/* Expanded detail panel */}
      {isSelected ? (
        <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
          <div className="grid gap-1.5 sm:grid-cols-3">
            <DetailItem label={graphCopy.detailType} value={step.type ?? "step"} />
            <DetailItem label={graphCopy.detailExecutionMode} value={step.executionMode ?? "none"} />
            <DetailItem label={graphCopy.detailPriority} value={step.priority ?? "-"} />
          </div>
          {step.linkedTaskId ? (
            <DetailItem label={graphCopy.detailLinkedTask} value={step.linkedTaskId} />
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// SVG Connector
// ────────────────────────────────────────────────────────────

function FlowConnector({
  edge,
  fromRect,
  toRect,
  containerRect,
  graphCopy,
}: {
  edge: PlanEdge;
  fromRect: DOMRect;
  toRect: DOMRect;
  containerRect: DOMRect;
  graphCopy: GraphCopyType;
}) {
  // Bottom center of from → Top center of to (relative to container)
  const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
  const y1 = fromRect.bottom - containerRect.top;
  const x2 = toRect.left + toRect.width / 2 - containerRect.left;
  const y2 = toRect.top - containerRect.top;

  const midY = (y1 + y2) / 2;
  const dx = Math.abs(x2 - x1);

  // Curved path
  const path = dx < 4
    ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${x1} ${y1 + 20}, ${x1} ${midY}, ${(x1 + x2) / 2} ${midY} S ${x2} ${y2 - 20}, ${x2} ${y2}`;

  const dash = EDGE_DASH[edge.type];
  const label = getEdgeLabel(edge.type, graphCopy);

  return (
    <g>
      <path
        d={path}
        fill="none"
        className={cn("transition-colors", edgeColor(edge.type))}
        strokeWidth={1.5}
        strokeDasharray={dash}
        markerEnd="url(#flowArrow)"
      />
      {/* Edge label at midpoint */}
      {edge.type !== "sequential" ? (
        <text
          x={(x1 + x2) / 2}
          y={midY - 4}
          textAnchor="middle"
          className="fill-muted-foreground/50 text-[9px]"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

export function TaskPlanGraph({ plan }: TaskPlanGraphProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const { messages } = useI18n();
  const graphCopy = { ...DEFAULT_GRAPH_COPY, ...(messages.components?.taskPlanGraph ?? {}) } as GraphCopyType;

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [rects, setRects] = useState<Map<string, DOMRect>>(new Map());
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  // Collect node positions for SVG connectors
  useEffect(() => {
    if (plan.state !== "ready" || !containerRef.current) return;

    const measure = () => {
      const cr = containerRef.current?.getBoundingClientRect();
      if (!cr) return;
      setContainerRect(cr);

      const newRects = new Map<string, DOMRect>();
      for (const [id, el] of nodeRefs.current.entries()) {
        newRects.set(id, el.getBoundingClientRect());
      }
      setRects(newRects);
    };

    // Measure after layout settles
    const timer = setTimeout(measure, 50);
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [plan.state, plan.steps.length, selectedStepId]);

  const edgesByFrom = useMemo(() => {
    const map = new Map<string, PlanEdge[]>();
    for (const edge of plan.edges ?? []) {
      const list = map.get(edge.fromNodeId) ?? [];
      list.push(edge);
      map.set(edge.fromNodeId, list);
    }
    return map;
  }, [plan.edges]);

  // All edges flat
  const allEdges = useMemo(() => plan.edges ?? [], [plan.edges]);

  useEffect(() => {
    if (plan.state !== "ready" || plan.steps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && plan.steps.some((s) => s.id === selectedStepId)) return;
    setSelectedStepId(null);
  }, [plan.state, plan.steps, selectedStepId]);

  if (plan.state !== "ready" || plan.steps.length === 0) return null;

  const svgHeight = containerRef.current?.scrollHeight ?? 0;
  const svgWidth = containerRef.current?.scrollWidth ?? 0;

  return (
    <div
      ref={containerRef}
      aria-label={graphCopy.ariaLabel}
      className="relative"
      data-testid="task-plan-graph"
    >
      {/* SVG overlay for connectors */}
      {containerRect && allEdges.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-0"
          width={svgWidth}
          height={svgHeight}
          style={{ overflow: "visible" }}
        >
          <defs>
            <marker
              id="flowArrow"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path
                d="M 0 0 L 8 3 L 0 6 Z"
                className="fill-muted-foreground/30"
              />
            </marker>
          </defs>
          {allEdges.map((edge) => {
            const fromRect = rects.get(edge.fromNodeId);
            const toRect = rects.get(edge.toNodeId);
            if (!fromRect || !toRect) return null;
            return (
              <FlowConnector
                key={edge.id}
                edge={edge}
                fromRect={fromRect}
                toRect={toRect}
                containerRect={containerRect}
                graphCopy={graphCopy}
              />
            );
          })}
        </svg>
      ) : null}

      {/* Nodes */}
      <div className="relative z-10 space-y-4">
        {plan.steps.map((step) => {
          const tone = getNodeTone(step);
          const isCurrent = step.id === plan.currentStepId;
          const isSelected = step.id === selectedStepId;

          return (
            <div
              key={step.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(step.id, el);
                else nodeRefs.current.delete(step.id);
              }}
            >
              <FlowNode
                step={step}
                tone={tone}
                isCurrent={isCurrent}
                isSelected={isSelected}
                onClick={() => setSelectedStepId(isSelected ? null : step.id)}
                graphCopy={graphCopy}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
