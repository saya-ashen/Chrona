"use client";

import { TaskPlanGraph } from "@/components/tasks/plan/task-plan-graph";
import { cn } from "@/lib/utils"
import type { ReactNode } from "react";

type TaskPlanGraphPanelProps = {
  label?: string;
  plan: Parameters<typeof TaskPlanGraph>[0]["plan"];
  mode?: Parameters<typeof TaskPlanGraph>[0]["mode"];
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
  fillHeight?: boolean;
  onSelectedNodeChange?: Parameters<typeof TaskPlanGraph>[0]["onSelectedNodeChange"];
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
  onSelectedNodeChange,
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
        onSelectedNodeChange={onSelectedNodeChange}
        showOverview={showOverview}
      />
    </div>
  );
}
