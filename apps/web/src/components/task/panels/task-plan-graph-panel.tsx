"use client";

import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type TaskPlanGraphPanelProps = {
  label?: string;
  plan: Parameters<typeof TaskPlanGraph>[0]["plan"];
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
  fillHeight?: boolean;
  inspectorPlacement?: Parameters<typeof TaskPlanGraph>[0]["inspectorPlacement"];
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraph>[0]["onSelectedNodeChange"];
  dismissSelectionOnOutsideClick?: Parameters<typeof TaskPlanGraph>[0]["dismissSelectionOnOutsideClick"];
};

export function TaskPlanGraphPanel({
  label = "Task Plan",
  plan,
  summary,
  actions,
  className,
  fillHeight = false,
  inspectorPlacement,
  onSelectedNodeChange,
  dismissSelectionOnOutsideClick,
}: TaskPlanGraphPanelProps) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-[1.35rem] border border-border/50 bg-background/65 p-2 shadow-[0_18px_60px_rgba(15,23,42,0.06)]", fillHeight && "h-full min-h-0", className)}>
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="min-w-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/75">
            {label}
          </p>
          {summary ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {summary}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <TaskPlanGraph
        plan={plan}
        fillHeight={fillHeight}
        className={fillHeight ? "min-h-0 flex-1" : undefined}
        inspectorPlacement={inspectorPlacement}
        onSelectedNodeChange={onSelectedNodeChange}
        dismissSelectionOnOutsideClick={dismissSelectionOnOutsideClick}
      />
    </div>
  );
}
