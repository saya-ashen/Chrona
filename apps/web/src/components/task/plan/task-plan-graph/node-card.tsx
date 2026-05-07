import { CircleHelp, Clock, GitBranch, ListTodo, ShieldCheck, UserCheck } from "lucide-react";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./constants";
import {
  getCompactStatusLabel,
  getShapeClassName,
  getShapeStyle,
  getStatusLabel,
  nodeShapeForStep,
  TONE_STYLES,
} from "./logic";
import type { FlowGraphNode } from "./types";

function formatEstimatedDuration(minutes?: number | null) {
  if (typeof minutes !== "number") return "-";
  return `${minutes} min`;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-foreground">{value}</p>
    </div>
  );
}

function PlanNodeCard({ data }: NodeProps<FlowGraphNode>) {
  const { step, tone, isCurrent, isSelected, onToggle, graphCopy } = data;
  const s = TONE_STYLES[tone];
  const shape = nodeShapeForStep(step);
  const dt = step.displayType ?? step.type ?? "task";
  const meta = (step.metadata && typeof step.metadata === "object" ? step.metadata : {}) as Record<string, unknown>;

  const checkpointType = meta.checkpointType as string | undefined;
  const checkpointOptions = meta.options as string[] | undefined;
  const waitFor = meta.waitFor as string | undefined;
  const waitTimeout = meta.timeout as { minutes?: number } | undefined;
  const branches = meta.branches as Array<{ label?: string }> | undefined;
  const conditionText = meta.condition as string | undefined;
  const evaluationBy = meta.evaluationBy as string | undefined;
  const executor = meta.executor as string | undefined;
  const mode = meta.mode as string | undefined;
  const isRequired = meta.required as boolean | undefined;

  const Icon =
    dt === "checkpoint"
      ? checkpointType === "approve"
        ? ShieldCheck
        : checkpointType === "confirm"
          ? UserCheck
          : CircleHelp
      : dt === "condition"
        ? GitBranch
        : dt === "wait"
          ? Clock
          : ListTodo;

  const typeLabel =
    dt === "condition"
      ? graphCopy.nodeTypeCondition
      : dt === "wait"
        ? graphCopy.nodeTypeWait
        : dt === "checkpoint"
          ? graphCopy.nodeTypeCheckpoint
          : graphCopy.nodeTypeTask;

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
        data-node-display-type={dt}
        data-node-current={isCurrent ? "true" : "false"}
        data-node-selected={isSelected ? "true" : "false"}
        className={cn(
          "rf-node-button group relative w-full border px-3 py-2.5 text-left transition-all duration-200",
          "shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)]",
          getShapeClassName(shape),
          s.border,
          s.bg,
          isCurrent && "ring-2",
          isCurrent && s.ring,
          isSelected && !isCurrent && "ring-1 ring-foreground/10",
        )}
        style={getShapeStyle(shape)}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex flex-col items-center gap-1">
            <span className={cn("size-2 rounded-full shadow-sm", s.dot)} />
            <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="min-w-0 text-[10px] leading-snug text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                <span className="font-semibold uppercase tracking-[0.12em]">{typeLabel}</span>
                {checkpointType ? (
                  <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[9px]">{checkpointType}</span>
                ) : null}
                {!isSelected ? <span aria-hidden="true">·</span> : null}
                {!isSelected ? <span>{getCompactStatusLabel(step.status, graphCopy)}</span> : null}
                {typeof step.estimatedMinutes === "number" ? <span aria-hidden="true">·</span> : null}
                {typeof step.estimatedMinutes === "number" ? <span>{step.estimatedMinutes}m</span> : null}
              </div>
            </div>
            <p className="mt-1 text-sm font-medium leading-snug text-foreground line-clamp-2">{step.title}</p>

            {checkpointType && meta.prompt ? (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-1">{String(meta.prompt)}</p>
            ) : conditionText ? (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-1">{conditionText}</p>
            ) : waitFor ? (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-1">{waitFor}</p>
            ) : null}

            {isSelected ? (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1 text-[10px] leading-none text-muted-foreground">
                  <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{getStatusLabel(step.status, graphCopy)}</span>
                  {executor ? <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{executor}</span> : null}
                  {mode ? <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{mode}</span> : null}
                  {isRequired !== undefined ? (
                    <span className={cn("rounded-full px-1.5 py-0.5", isRequired ? "bg-amber-100 text-amber-800" : "bg-foreground/5")}>
                      {isRequired ? graphCopy.badgeRequired : graphCopy.badgeOptional}
                    </span>
                  ) : null}
                  {typeof step.estimatedMinutes === "number" ? (
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{step.estimatedMinutes}m</span>
                  ) : null}
                  {evaluationBy ? <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{evaluationBy}</span> : null}
                  {branches ? (
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{branches.length} 分支</span>
                  ) : null}
                </div>

                {dt === "condition" && branches && branches.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {branches.map((branch, index) => (
                      <span
                        key={index}
                        className="rounded-full border border-yellow-300 bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800"
                      >
                        {branch.label ?? `分支 ${index + 1}`}
                      </span>
                    ))}
                  </div>
                ) : null}

                {dt === "checkpoint" && checkpointOptions && checkpointOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {checkpointOptions.slice(0, 3).map((option, index) => (
                      <span
                        key={index}
                        className="rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-800"
                      >
                        {option}
                      </span>
                    ))}
                  </div>
                ) : null}

                {dt === "wait" && waitTimeout?.minutes ? (
                  <p className="text-[10px] text-muted-foreground">超时: {waitTimeout.minutes} 分钟</p>
                ) : null}

                <p className="text-xs leading-relaxed text-muted-foreground">{step.objective}</p>
              </div>
            ) : checkpointOptions && checkpointOptions.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {checkpointOptions.slice(0, 2).map((option, index) => (
                  <span
                    key={index}
                    className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0 text-[9px] text-violet-700"
                  >
                    {option}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {isSelected ? (
          <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
            <DetailItem label={graphCopy.detailDescription} value={step.objective} />
            <div className="grid gap-1.5 sm:grid-cols-2">
              <DetailItem label={graphCopy.detailType} value={typeLabel} />
              <DetailItem label={graphCopy.detailExecutionMode} value={mode ?? step.executionMode ?? "none"} />
              <DetailItem label={graphCopy.detailPriority} value={step.priority ?? "-"} />
              <DetailItem label={graphCopy.detailEstimatedDuration} value={formatEstimatedDuration(step.estimatedMinutes)} />
            </div>
            {step.linkedTaskId ? <DetailItem label={graphCopy.detailLinkedTask} value={step.linkedTaskId} /> : null}
            {step.executionClassification ? (
              <DetailItem label={graphCopy.detailExecutionClassification} value={step.executionClassification} />
            ) : null}
            {step.readiness ? <DetailItem label={graphCopy.detailReadiness} value={step.readiness} /> : null}
            {step.nextAction ? <DetailItem label={graphCopy.detailNextAction} value={step.nextAction} /> : null}
            {step.dependencies && step.dependencies.length > 0 ? (
              <DetailItem label={graphCopy.detailDependencies} value={step.dependencies.join(", ")} />
            ) : null}
            {step.requiredInfo && step.requiredInfo.length > 0 ? (
              <DetailItem label={graphCopy.detailRequiredInfo} value={step.requiredInfo.join(", ")} />
            ) : null}
            {step.completionSummary ? (
              <DetailItem label={graphCopy.detailCompletionSummary} value={step.completionSummary} />
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

export const nodeTypes: NodeTypes = {
  taskPlanNode: PlanNodeCard,
};
