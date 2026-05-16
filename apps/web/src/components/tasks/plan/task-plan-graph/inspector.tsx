"use client";

import type { ExecutionActionInput } from "@chrona/contracts/ai";
import { interactionLabel, nodeKindLabel } from "./logic";
import { TaskPlanGraphInspectorDetails } from "./inspector-details";
import { TaskPlanGraphInspectorRunPanel } from "./inspector-run-panel";
import type { GraphCopy, PlanNodeDataModel } from "./types";
import type { TaskExecutionDispatchResult } from "@/components/tasks/task-workspace-query";

export function TaskPlanGraphInspector({
  node,
  graphCopy,
  nodes = [],
  onDispatchExecutionAction,
}: {
  node: PlanNodeDataModel | null;
  graphCopy: GraphCopy;
  nodes?: PlanNodeDataModel[];
  onDispatchExecutionAction?: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
}) {
  if (!node) {
    return (
      <aside className="w-full min-w-0 max-w-full rounded-[24px] border border-border/60 bg-muted/[0.18] p-4">
        <p className="text-sm font-semibold text-foreground">No node selected</p>
        <p className="mt-2 break-words text-sm text-muted-foreground">
          Select a plan node to inspect its goal, status, dependencies, and available next action.
        </p>
      </aside>
    );
  }

  const guidance = resolveInspectorGuidance(node);

  return (
    <aside className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur xl:max-h-[calc(100dvh-2rem)]">
      <div className="shrink-0 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{node.statusLabel ?? node.status}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{interactionLabel(node.interactionType)}</span>
        </div>
        <h3 className="mt-3 break-words text-lg font-semibold text-foreground">{node.title}</h3>
        <p className="mt-2 break-words text-sm text-muted-foreground">{node.summary}</p>
        <p className="mt-3 rounded-2xl border border-border/60 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Next: </span>
          <span className="break-words">{guidance}</span>
        </p>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <TaskPlanGraphInspectorDetails node={node} graphCopy={graphCopy} nodes={nodes} />
        <TaskPlanGraphInspectorRunPanel node={node} onDispatchExecutionAction={onDispatchExecutionAction} />
      </div>
    </aside>
  );
}

function resolveInspectorGuidance(node: PlanNodeDataModel) {
  if (node.nextAction) return node.nextAction;
  if (node.status === "blocked") return "Resolve the blocker before continuing execution.";
  if (node.status === "waiting_for_user" || node.requiresHumanInput) return "Complete the required review or input to continue.";
  if (node.status === "done" || node.status === "skipped") return "Review the completion summary and generated evidence.";
  if (node.status === "active" || node.status === "in_progress") return "Monitor this node while execution continues.";
  return "Select this node when you need to inspect its required inputs and execution context.";
}
