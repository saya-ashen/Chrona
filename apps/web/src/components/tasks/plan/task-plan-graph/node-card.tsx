import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Check, Circle, Clock3, ClipboardCheck, GitBranch, Hammer, Hand, Minus, MoreHorizontal, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { nodeKindLabel, TONE_STYLES } from "./logic";
import {
  TASK_PLAN_GRAPH_THEME,
  resolveInteractionTheme,
  resolveNodeKindTheme,
  resolveRuntimeSpotlightTheme,
} from "./theme";
import type { FlowGraphNode, PlanNodeStatus } from "./types";

function resolveExecutionStatus(node: FlowGraphNode["data"]["node"]) {
  if (node.status === "skipped") return "skipped";
  if (node.status === "done" || node.status === "completed") return "completed";
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

const TARGET_HANDLE_OFFSET = "44%";
const SOURCE_HANDLE_OFFSET = "56%";
const CENTER_HANDLE_OFFSET = "50%";

function sideHandleStyle(side: "top" | "right" | "bottom" | "left", type: "source" | "target") {
  const offset = type === "target" ? TARGET_HANDLE_OFFSET : SOURCE_HANDLE_OFFSET;
  return side === "top" || side === "bottom"
    ? { ...HIDDEN_HANDLE_STYLE, left: offset }
    : { ...HIDDEN_HANDLE_STYLE, top: offset };
}

function centerHandleStyle() {
  return { ...HIDDEN_HANDLE_STYLE, left: CENTER_HANDLE_OFFSET };
}

function isCheckpointNode(node: FlowGraphNode["data"]["node"]) {
  const kind = node.displayType ?? node.kind ?? node.type;
  return kind === "checkpoint" || kind === "user_input";
}

function isConditionNode(node: FlowGraphNode["data"]["node"]) {
  const kind = node.displayType ?? node.kind ?? node.type;
  return kind === "condition";
}

function isWaitNode(node: FlowGraphNode["data"]["node"]) {
  const kind = node.displayType ?? node.kind ?? node.type;
  return kind === "wait";
}

function TypeIcon({ node, className }: { node: FlowGraphNode["data"]["node"]; className?: string }) {
  if (isCheckpointNode(node)) return <ClipboardCheck className={className} aria-hidden="true" />;
  if (isConditionNode(node)) return <GitBranch className={className} aria-hidden="true" />;
  if (isWaitNode(node)) return <Clock3 className={className} aria-hidden="true" />;
  return <Hammer className={className} aria-hidden="true" />;
}

type StatusChipTheme = {
  className: string;
  icon: React.ReactNode;
};

const STATUS_CHIP_THEME_BY_STATUS: Partial<Record<PlanNodeStatus, StatusChipTheme>> = {
  done: {
    className: "border-emerald-100/55 bg-emerald-300/18 text-emerald-50 shadow-[0_0_18px_rgba(110,231,183,0.28)]",
    icon: <Check className="size-2.5" aria-hidden="true" />,
  },
  completed: {
    className: "border-emerald-100/55 bg-emerald-300/18 text-emerald-50 shadow-[0_0_18px_rgba(110,231,183,0.28)]",
    icon: <Check className="size-2.5" aria-hidden="true" />,
  },
  active: {
    className: "animate-pulse border-cyan-100/60 bg-cyan-300/20 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.32)]",
    icon: <MoreHorizontal className="size-3" aria-hidden="true" />,
  },
  in_progress: {
    className: "animate-pulse border-cyan-100/60 bg-cyan-300/20 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.32)]",
    icon: <MoreHorizontal className="size-3" aria-hidden="true" />,
  },
  waiting: {
    className: "border-fuchsia-100/55 bg-fuchsia-300/18 text-fuchsia-50 shadow-[0_0_18px_rgba(217,70,239,0.28)]",
    icon: <Hand className="size-2.5" aria-hidden="true" />,
  },
  waiting_for_user: {
    className: "border-fuchsia-100/55 bg-fuchsia-300/18 text-fuchsia-50 shadow-[0_0_18px_rgba(217,70,239,0.28)]",
    icon: <Hand className="size-2.5" aria-hidden="true" />,
  },
  waiting_for_approval: {
    className: "border-fuchsia-100/55 bg-fuchsia-300/18 text-fuchsia-50 shadow-[0_0_18px_rgba(217,70,239,0.28)]",
    icon: <Hand className="size-2.5" aria-hidden="true" />,
  },
  blocked: {
    className: "border-rose-100/65 bg-rose-300/22 text-rose-50 shadow-[0_0_18px_rgba(251,113,133,0.32)]",
    icon: <TriangleAlert className="size-2.5" aria-hidden="true" />,
  },
  failed: {
    className: "border-rose-100/65 bg-rose-300/22 text-rose-50 shadow-[0_0_18px_rgba(251,113,133,0.32)]",
    icon: <TriangleAlert className="size-2.5" aria-hidden="true" />,
  },
  degraded: {
    className: "border-rose-100/65 bg-rose-300/22 text-rose-50 shadow-[0_0_18px_rgba(251,113,133,0.32)]",
    icon: <TriangleAlert className="size-2.5" aria-hidden="true" />,
  },
  skipped: {
    className: "border-slate-300/40 bg-slate-600/20 text-slate-300",
    icon: <Minus className="size-2.5" aria-hidden="true" />,
  },
  cancelled: {
    className: "border-slate-400/35 bg-slate-700/22 text-slate-300",
    icon: <X className="size-2.5" aria-hidden="true" />,
  },
  invalidated: {
    className: "border-slate-400/35 bg-slate-700/22 text-slate-300",
    icon: <X className="size-2.5" aria-hidden="true" />,
  },
  ready: {
    className: "border-violet-200/40 bg-violet-300/12 text-violet-100",
    icon: <Circle className="size-2.5 fill-current/20" aria-hidden="true" />,
  },
} satisfies Partial<Record<PlanNodeStatus, StatusChipTheme>>;

const IDLE_STATUS_CHIP_THEME = {
  className: "border-slate-300/30 bg-slate-600/16 text-slate-300",
  icon: <Circle className="size-2.5" aria-hidden="true" />,
} satisfies StatusChipTheme;

type NodeCardPreparedData = NodeProps<FlowGraphNode>["data"];

type NodeFrameProps = {
  children: React.ReactNode;
  data: NodeCardPreparedData;
  executionStatus: ReturnType<typeof resolveExecutionStatus>;
  interactionFrame: ReturnType<typeof resolveInteractionTheme>;
  kindTheme: ReturnType<typeof resolveNodeKindTheme>;
  requiresAction: boolean;
  runtimeSpotlight: ReturnType<typeof resolveRuntimeSpotlightTheme>;
  statusTheme: StatusChipTheme;
  styles: (typeof TONE_STYLES)[keyof typeof TONE_STYLES];
};

type NodeFrameSharedProps = Omit<NodeFrameProps, "children">;

type NodeFrameShellProps = NodeFrameProps & {
  accentClassName: string;
  className?: string;
  decorations?: React.ReactNode;
  rail?: React.ReactNode;
};

type NodeCardContentProps = {
  data: NodeCardPreparedData;
  estimatedLabel: string | null;
  interactionFrame: ReturnType<typeof resolveInteractionTheme>;
  kindTheme: ReturnType<typeof resolveNodeKindTheme>;
  runtimeSpotlight: ReturnType<typeof resolveRuntimeSpotlightTheme>;
  styles: (typeof TONE_STYLES)[keyof typeof TONE_STYLES];
};

function statusChipTheme(status: PlanNodeStatus) {
  return STATUS_CHIP_THEME_BY_STATUS[status] ?? IDLE_STATUS_CHIP_THEME;
}

function NodeFrameShell({
  accentClassName,
  children,
  className,
  data,
  decorations,
  executionStatus,
  interactionFrame,
  kindTheme,
  rail,
  requiresAction,
  runtimeSpotlight,
  statusTheme,
  styles,
}: NodeFrameShellProps) {
  const { node, stepNumber, tone, shape, isSelected, isCurrent, isFocus, visualWeight, onSelect } = data;

  return (
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
        "rf-node-button group relative w-full overflow-hidden border text-left text-slate-100 transition duration-200",
        "shadow-[0_18px_45px_rgba(2,6,23,0.28)] backdrop-blur hover:-translate-y-0.5 hover:border-white/28 hover:shadow-[0_22px_60px_rgba(8,47,73,0.34)]",
        className,
        styles.border,
        styles.bg,
        styles.text,
        isSelected && "ring-2 ring-white/55",
        isCurrent && "shadow-[0_0_0_1px_rgba(103,232,249,0.45),0_24px_80px_rgba(34,211,238,0.25)]",
        runtimeSpotlight?.ring,
        TASK_PLAN_GRAPH_THEME.visualWeightClassNames[visualWeight],
        visualWeight === "normal" && isFocus && "brightness-100",
      )}
    >
      {runtimeSpotlight ? <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 animate-pulse", runtimeSpotlight.glow, className)} /> : null}
      <span aria-hidden="true" className={cn("pointer-events-none absolute top-0 h-1 bg-gradient-to-r", accentClassName, interactionFrame.accent)} />
      {rail}
      <span aria-hidden="true" className={cn("pointer-events-none absolute -right-10 -top-10 size-24 rounded-full blur-2xl transition group-hover:bg-cyan-200/13", kindTheme.halo)} />
      <span aria-hidden="true" className={cn("pointer-events-none absolute z-10 grid size-4 place-items-center rounded-full border", kindTheme.statusOffset, statusTheme.className)}>
        {statusTheme.icon}
      </span>
      {decorations}
      {children}
    </button>
  );
}

function TaskNodeFrame(props: NodeFrameProps) {
  return (
    <NodeFrameShell
      {...props}
      accentClassName="inset-x-0"
      className={props.kindTheme.card}
      rail={<span aria-hidden="true" className={cn("pointer-events-none absolute left-0 top-0 h-full w-1", props.kindTheme.rail)} />}
    />
  );
}

function CheckpointNodeFrame(props: NodeFrameProps) {
  return (
    <NodeFrameShell
      {...props}
      accentClassName="inset-x-0"
      className={props.kindTheme.card}
      rail={<span aria-hidden="true" className={cn("pointer-events-none absolute left-0 top-0 h-full w-1.5 rounded-l-[18px]", props.kindTheme.rail)} />}
      decorations={
        <>
          <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-2 h-[calc(100%-1rem)] w-px rounded-full bg-emerald-50/28" />
          <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-8 w-8 rounded-bl-[18px] border-b border-l border-emerald-100/18 bg-emerald-200/[0.035]" />
        </>
      }
    />
  );
}

function ConditionNodeFrame(props: NodeFrameProps) {
  return (
    <NodeFrameShell
      {...props}
      accentClassName="left-8 right-8"
      className={props.kindTheme.card}
      decorations={
        <>
          <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-10 w-px -translate-y-1/2 bg-gradient-to-b from-transparent via-fuchsia-100/35 to-transparent" />
          <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-10 w-px -translate-y-1/2 bg-gradient-to-b from-transparent via-fuchsia-100/35 to-transparent" />
          <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-7 w-3 -translate-y-1/2 rounded-r-full border-y border-r border-fuchsia-100/22 bg-fuchsia-200/8" />
          <span aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 h-7 w-3 -translate-y-1/2 rounded-l-full border-y border-l border-fuchsia-100/22 bg-fuchsia-200/8" />
          <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-8 flex gap-1">
            <span className="h-1 w-2 rounded-full bg-fuchsia-100/38" />
            <span className="h-1 w-2 rounded-full bg-fuchsia-100/22" />
          </span>
        </>
      }
    />
  );
}

function WaitNodeFrame(props: NodeFrameProps) {
  return (
    <NodeFrameShell
      {...props}
      accentClassName="left-6 right-6"
      className={props.kindTheme.card}
      rail={<span aria-hidden="true" className={cn("pointer-events-none absolute left-3 top-0 h-1/2 w-1 translate-y-1/2 rounded-full", props.kindTheme.rail)} />}
      decorations={<span aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-1 h-px bg-gradient-to-r from-transparent via-slate-200/24 to-transparent" />}
    />
  );
}

function NodeCardContent({ data, estimatedLabel, interactionFrame, kindTheme, runtimeSpotlight, styles }: NodeCardContentProps) {
  const { graphCopy, node, stepNumber } = data;
  const anchorClassName = isCheckpointNode(node) ? "rounded-[10px_16px_10px_10px]" : isConditionNode(node) ? "rounded-[10px]" : undefined;

  return (
    <div className={cn("relative grid items-start", kindTheme.content, isWaitNode(node) && "items-center")}>
      <TypeAnchor node={node} stepNumber={stepNumber} className={anchorClassName} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 pr-6 text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          <span className={cn("size-2 rounded-full shadow-[0_0_14px_currentColor]", styles.dot)} />
          <span className={cn("truncate rounded-full border px-1.5 py-0.5", kindTheme.badge)}>{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
        </div>

        <p className="mt-1.5 break-words pr-6 text-[13px] font-semibold leading-snug text-slate-50 line-clamp-2">{node.title}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]", interactionFrame.badge)}>
            {interactionFrame.label}
          </span>
          {runtimeSpotlight ? (
            <span className={cn("rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]", runtimeSpotlight.badge)}>
              {runtimeSpotlight.label}
            </span>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-300">{node.statusLabel ?? node.status}</span>
          )}
          {estimatedLabel ? (
            <span className="truncate rounded-full border border-white/8 bg-slate-950/35 px-2 py-0.5 text-[10px] font-medium text-slate-300">{estimatedLabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TypeAnchor({ node, stepNumber, className }: { node: FlowGraphNode["data"]["node"]; stepNumber: number; className?: string }) {
  const kindTheme = resolveNodeKindTheme(node);
  const shapeClassName = isConditionNode(node) ? "rounded-[14px]" : isWaitNode(node) ? "rounded-[999px]" : "rounded-xl";
  return (
    <div className={cn("relative grid size-8 shrink-0 place-items-center border shadow-inner shadow-white/10", shapeClassName, kindTheme.anchor, className)}>
      <TypeIcon node={node} className="size-3.5" />
      <span className="absolute -bottom-1 -right-1 grid size-3.5 place-items-center rounded-full border border-slate-950/70 bg-slate-950/85 text-[8px] font-bold leading-none text-slate-100">
        {stepNumber}
      </span>
    </div>
  );
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { node, tone } = data;
  const styles = TONE_STYLES[tone];
  const runtimeSpotlight = resolveRuntimeSpotlightTheme(node);
  const interactionFrame = resolveInteractionTheme(node);
  const kindTheme = resolveNodeKindTheme(node);
  const isCheckpoint = isCheckpointNode(node);
  const isCondition = isConditionNode(node);
  const isWait = isWaitNode(node);
  const statusTheme = statusChipTheme(node.status);
  const durationLabel = formatEstimatedMinutes(node.estimatedMinutes ?? null);
  const executionStatus = resolveExecutionStatus(node);
  const requiresAction = node.status === "blocked" || executionStatus === "approval-needed";
  const estimatedLabel = durationLabel ?? (node.priority ? `${node.priority} priority` : null);
  const frameProps = {
    data,
    executionStatus,
    interactionFrame,
    kindTheme,
    requiresAction,
    runtimeSpotlight,
    statusTheme,
    styles,
  } satisfies NodeFrameSharedProps;
  const content = (
    <NodeCardContent
      data={data}
      estimatedLabel={estimatedLabel}
      interactionFrame={interactionFrame}
      kindTheme={kindTheme}
      runtimeSpotlight={runtimeSpotlight}
      styles={styles}
    />
  );

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle id="top-target" type="target" position={Position.Top} style={sideHandleStyle("top", "target")} className="!bg-transparent" />
      <Handle id="top-center-target" type="target" position={Position.Top} style={centerHandleStyle()} className="!bg-transparent" />
      <Handle id="left-target" type="target" position={Position.Left} style={sideHandleStyle("left", "target")} className="!bg-transparent" />
      <Handle id="top-source" type="source" position={Position.Top} style={sideHandleStyle("top", "source")} className="!bg-transparent" />
      <Handle id="top-center-source" type="source" position={Position.Top} style={centerHandleStyle()} className="!bg-transparent" />
      <Handle id="left-source" type="source" position={Position.Left} style={sideHandleStyle("left", "source")} className="!bg-transparent" />
      {isCheckpoint ? (
        <CheckpointNodeFrame {...frameProps}>{content}</CheckpointNodeFrame>
      ) : isCondition ? (
        <ConditionNodeFrame {...frameProps}>{content}</ConditionNodeFrame>
      ) : isWait ? (
        <WaitNodeFrame {...frameProps}>{content}</WaitNodeFrame>
      ) : (
        <TaskNodeFrame {...frameProps}>{content}</TaskNodeFrame>
      )}
      <Handle id="right-target" type="target" position={Position.Right} style={sideHandleStyle("right", "target")} className="!bg-transparent" />
      <Handle id="bottom-target" type="target" position={Position.Bottom} style={sideHandleStyle("bottom", "target")} className="!bg-transparent" />
      <Handle id="bottom-center-target" type="target" position={Position.Bottom} style={centerHandleStyle()} className="!bg-transparent" />
      <Handle id="right-source" type="source" position={Position.Right} style={sideHandleStyle("right", "source")} className="!bg-transparent" />
      <Handle id="bottom-source" type="source" position={Position.Bottom} style={sideHandleStyle("bottom", "source")} className="!bg-transparent" />
      <Handle id="bottom-center-source" type="source" position={Position.Bottom} style={centerHandleStyle()} className="!bg-transparent" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};
