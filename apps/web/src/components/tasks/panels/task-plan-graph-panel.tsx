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
  dismissSelectionOnOutsideClick,
  showOverview,
}: TaskPlanGraphPanelProps) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-slate-900/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.94)_64%,rgba(30,41,59,0.96))] p-1.5 text-slate-100 shadow-[0_18px_60px_rgba(15,23,42,0.22)] ring-1 ring-white/8",
        fillHeight && "h-full min-h-0",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-24 rounded-full bg-cyan-400/16 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900/70 to-transparent" />
      <div className="sr-only">
        {label} {summary}
      </div>
      {actions ? (
        <div className="absolute right-2.5 top-2.5 z-[8] rounded-full border border-white/10 bg-slate-950/70 p-1 shadow-[0_12px_34px_rgba(15,23,42,0.28)] backdrop-blur [&_button]:border-white/10 [&_button]:bg-white/10 [&_button]:text-slate-100 [&_button]:shadow-sm [&_button:hover]:bg-white/15">
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
        dismissSelectionOnOutsideClick={dismissSelectionOnOutsideClick}
        showOverview={showOverview}
      />
    </div>
  );
}
