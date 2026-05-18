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
      <aside className="w-full min-w-0 max-w-full rounded-[24px] border border-white/10 bg-slate-950/88 p-4 text-slate-100 shadow-[0_18px_48px_rgba(2,6,23,0.35)] backdrop-blur-xl">
        <p className="text-sm font-semibold text-white">No node selected</p>
        <p className="mt-2 break-words text-sm text-slate-400">
          Select a plan node to inspect its goal, status, dependencies, and available next action.
        </p>
      </aside>
    );
  }

  const guidance = resolveInspectorGuidance(node);

  return (
    <aside className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/88 p-4 text-slate-100 shadow-[0_24px_70px_rgba(2,6,23,0.45)] backdrop-blur-xl xl:max-h-[calc(100dvh-2rem)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_30%_0%,rgba(34,211,238,0.18),transparent_48%)]" />
      <div className="relative shrink-0 border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-100">{node.statusLabel ?? node.status}</span>
          <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-violet-100">{interactionLabel(node.interactionType)}</span>
        </div>
        <h3 className="mt-3 break-words text-lg font-semibold text-white">{node.title}</h3>
        <p className="mt-2 break-words text-sm text-slate-400">{node.summary}</p>
        <p className="mt-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-3 py-2 text-sm text-slate-300">
          <span className="font-medium text-cyan-100">Next: </span>
          <span className="break-words">{guidance}</span>
        </p>
      </div>

      <div className="relative mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
