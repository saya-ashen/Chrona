"use client";

import { TaskPlanGraph } from "@/components/tasks/plan/task-plan-graph";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type TaskPlanGraphPanelProps = {
  label?: string;
  plan: Parameters<typeof TaskPlanGraph>[0]["plan"];
  mode?: Parameters<typeof TaskPlanGraph>[0]["mode"];
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
  fillHeight?: boolean;
  inspectorPlacement?: Parameters<typeof TaskPlanGraph>[0]["inspectorPlacement"];
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraph>[0]["onSelectedNodeChange"];
  onDispatchExecutionAction?: Parameters<typeof TaskPlanGraph>[0]["onDispatchExecutionAction"];
  dismissSelectionOnOutsideClick?: Parameters<typeof TaskPlanGraph>[0]["dismissSelectionOnOutsideClick"];
  showOverview?: Parameters<typeof TaskPlanGraph>[0]["showOverview"];
};

export function TaskPlanGraphPanel({
  label = "Task Plan",
  plan,
  mode,
  summary,
  actions,
  className,
  fillHeight = false,
  inspectorPlacement,
  onSelectedNodeChange,
  onDispatchExecutionAction,
  dismissSelectionOnOutsideClick,
  showOverview,
}: TaskPlanGraphPanelProps) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden text-foreground",
        fillHeight && "h-full min-h-0",
        className,
      )}
    >
      <div className="sr-only">
        {label} {summary}
      </div>
      {actions ? (
        <div className="absolute right-2.5 top-2.5 z-[8] rounded-full border border-border bg-card p-1 shadow-sm [&_button]:border-border [&_button]:bg-background [&_button]:text-foreground [&_button]:shadow-sm [&_button:hover]:bg-accent/40">
          {actions}
        </div>
      ) : null}
      <TaskPlanGraph
        plan={plan}
        mode={mode}
        fillHeight={fillHeight}
        className={fillHeight ? "relative z-[1] min-h-0 flex-1" : "relative z-[1]"}
        inspectorPlacement={inspectorPlacement}
        onSelectedNodeChange={onSelectedNodeChange}
        onDispatchExecutionAction={onDispatchExecutionAction}
        dismissSelectionOnOutsideClick={dismissSelectionOnOutsideClick}
        showOverview={showOverview}
      />
    </div>
  );
}
