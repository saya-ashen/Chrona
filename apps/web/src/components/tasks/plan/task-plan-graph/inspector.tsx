"use client";

import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { interactionLabel, nodeKindLabel } from "./logic";
import { TaskPlanGraphInspectorDetails } from "./inspector-details";
import { TaskPlanGraphInspectorRunPanel } from "./inspector-run-panel";
import type { GraphCopy, PlanNodeDataModel } from "./types";
import type { TaskExecutionDispatchResult } from "@/components/tasks/task-workspace-query";

export function TaskPlanGraphInspector({
  node,
  graphCopy,
  nodes = [],
  onSubmitCheckpointAction,
  onDispatchExecutionAction,
}: {
  node: PlanNodeDataModel | null;
  graphCopy: GraphCopy;
  nodes?: PlanNodeDataModel[];
  onSubmitCheckpointAction?: (action: SubmitCheckpointActionInput) => Promise<TaskExecutionDispatchResult>;
  onDispatchExecutionAction?: (action: ExecutionActionInput) => Promise<{ message: string }>;
}) {
  if (!node) {
    return (
      <aside className="w-full min-w-0 max-w-full rounded-[24px] border border-border bg-card p-4 text-card-foreground shadow-sm">
        <p className="text-sm font-semibold text-foreground">{graphCopy.inspectorEmptyTitle}</p>
        <p className="mt-2 break-words text-sm text-muted-foreground">{graphCopy.inspectorEmpty}</p>
      </aside>
    );
  }

  const guidance = resolveInspectorGuidance(node, graphCopy);

  return (
    <aside className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[26px] border border-border bg-card p-4 text-card-foreground shadow-sm xl:max-h-[calc(100dvh-2rem)]">
      <div className="relative shrink-0 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
          <span className="rounded-full border border-primary/20 bg-primary-soft px-2 py-1 text-[10px] font-medium text-primary">{node.statusLabel ?? node.status}</span>
          <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{interactionLabel(node.interactionType)}</span>
        </div>
        <h3 className="mt-3 break-words text-lg font-semibold text-foreground">{node.title}</h3>
        <p className="mt-2 break-words text-sm text-muted-foreground">{node.summary}</p>
        <p className="mt-3 rounded-2xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{graphCopy.inspectorNextPrefix}: </span>
          <span className="break-words">{guidance}</span>
        </p>
      </div>

      <div className="relative mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <TaskPlanGraphInspectorDetails node={node} graphCopy={graphCopy} nodes={nodes} tone="light" />
        <TaskPlanGraphInspectorRunPanel
          node={node}
          graphCopy={graphCopy}
          onSubmitCheckpointAction={onSubmitCheckpointAction}
          onDispatchExecutionAction={onDispatchExecutionAction}
        />
      </div>
    </aside>
  );
}

function resolveInspectorGuidance(node: PlanNodeDataModel, graphCopy: GraphCopy) {
  if (node.nextAction) return node.nextAction;
  if (node.status === "blocked") return graphCopy.inspectorGuidanceBlocked;
  if (node.status === "waiting_for_user" || node.requiresHumanInput) return graphCopy.inspectorGuidanceInput;
  if (node.status === "done" || node.status === "skipped") return graphCopy.inspectorGuidanceDone;
  if (node.status === "active" || node.status === "in_progress") return graphCopy.inspectorGuidanceActive;
  return graphCopy.inspectorGuidanceDefault;
}
