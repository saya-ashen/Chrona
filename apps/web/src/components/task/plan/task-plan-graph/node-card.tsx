import { CircleHelp, Clock, GitBranch, ListTodo, ShieldCheck, UserRoundPen } from "lucide-react";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import { getShapeClassName, intentLabel, nodeKindLabel, TONE_STYLES } from "./logic";
import type { FlowGraphNode } from "./types";

function formatEstimatedMinutes(value: number | null) {
  return typeof value === "number" ? `${value}m` : null;
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { node, tone, shape, isSelected, isFocus, onSelect, graphCopy } = data;
  const styles = TONE_STYLES[tone];

  const Icon =
    node.kind === "checkpoint"
      ? node.intent === "approval"
        ? ShieldCheck
        : UserRoundPen
      : node.kind === "condition"
        ? GitBranch
        : node.kind === "wait"
          ? Clock
          : node.intent === "input"
            ? CircleHelp
            : ListTodo;

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!top-0 !size-3 !-translate-y-1/2 !border-2 !border-background !bg-border/80" />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        data-testid={`task-plan-node-${node.id}`}
        data-node-tone={tone}
        data-node-shape={shape}
        data-node-selected={isSelected ? "true" : "false"}
        className={cn(
          "rf-node-button group relative w-full overflow-hidden border px-4 py-3 text-left transition-all duration-200",
          "shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)]",
          getShapeClassName(shape),
          styles.border,
          styles.bg,
          styles.text,
          isSelected && "ring-2 ring-foreground/12",
          !isFocus && "saturate-50",
        )}
      >
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
          <div className="mt-1 flex flex-col items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full shadow-sm", styles.dot)} />
            <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span>{nodeKindLabel(node.kind, graphCopy)}</span>
              <span aria-hidden="true">•</span>
              <span>{node.statusLabel}</span>
              {formatEstimatedMinutes(node.estimatedMinutes) ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>{formatEstimatedMinutes(node.estimatedMinutes)}</span>
                </>
              ) : null}
            </div>

            <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{node.title}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{node.summary}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground">{intentLabel(node.intent, graphCopy)}</span>
              {node.executor ? <span className="rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground">{node.executor}</span> : null}
              {node.executionMode ? <span className="rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground">{node.executionMode}</span> : null}
              {node.availableActions.length > 0 ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{node.availableActions.length} actions</span>
              ) : null}
            </div>
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
