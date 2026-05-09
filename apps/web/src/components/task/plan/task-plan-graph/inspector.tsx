"use client";

import { interactionLabel, nodeKindLabel } from "./logic";
import { TaskPlanGraphInspectorDetails } from "./inspector-details";
import { TaskPlanGraphInspectorRunPanel } from "./inspector-run-panel";
import type { GraphCopy, PlanNodeDataModel } from "./types";

export function TaskPlanGraphInspector({
  node,
  graphCopy,
  nodes = [],
}: {
  node: PlanNodeDataModel | null;
  graphCopy: GraphCopy;
  nodes?: PlanNodeDataModel[];
}) {
  if (!node) {
    return (
      <aside className="w-full min-w-0 max-w-full rounded-[24px] border border-border/60 bg-muted/[0.18] p-4">
        <p className="text-sm font-semibold text-foreground">{graphCopy.inspectorTitle}</p>
        <p className="mt-2 text-sm text-muted-foreground">{graphCopy.inspectorEmpty}</p>
      </aside>
    );
  }

  return (
    <aside className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur xl:max-h-[calc(100dvh-2rem)]">
      <div className="shrink-0 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{nodeKindLabel(node.kind ?? node.type, graphCopy)}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{node.statusLabel ?? node.status}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{interactionLabel(node.interactionType)}</span>
        </div>
        <h3 className="mt-3 text-lg font-semibold text-foreground">{node.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{node.summary}</p>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <TaskPlanGraphInspectorDetails node={node} graphCopy={graphCopy} nodes={nodes} />
        <TaskPlanGraphInspectorRunPanel node={node} />
      </div>
    </aside>
  );
}
