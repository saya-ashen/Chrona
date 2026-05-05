"use client";

import { Sparkles } from "lucide-react";
import { TaskPlanGenerationPanel } from "@/components/task/ai/task-plan-generation-panel";
import type { TaskPlanGraphResponse } from "@chrona/contracts/ai";
import type { ScheduledItem, LegacyPlanGraph } from "@/components/schedule/schedule-page-types";
import { SurfaceCard } from "@/components/ui/surface-card";

function toCompactPlan(planResult: TaskPlanGraphResponse | null) {
  const graph = planResult?.planGraph as LegacyPlanGraph | undefined;
  if (!graph?.nodes) {
    return [] as Array<{
      id: string;
      title: string;
      status: string;
      priority: string | null;
    }>;
  }

  return graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    status: node.status,
    priority: node.priority,
  }));
}

export function AiInsightsPanel({
  item,
  planResult,
  onPlanLoaded,
  onApplyDecomposition,
}: {
  item: ScheduledItem;
  planResult: TaskPlanGraphResponse | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPlanLoaded?: (savedPlan: any) => void;
  onApplyDecomposition: (result: TaskPlanGraphResponse) => Promise<void>;
}) {
  const compactNodes = toCompactPlan(planResult);

  return (
    <div className="space-y-3">
      <SurfaceCard className="border-border/70 bg-background shadow-sm">
        <div className="space-y-3 p-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/80">
            <Sparkles className="size-3.5 text-primary" />
            AI Task Plan
          </div>
          {compactNodes.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Graph plan nodes will appear here after planning.
            </p>
          ) : (
            <div className="space-y-2">
              {compactNodes.map((node) => (
                <div
                  key={node.id}
                  className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="text-sm font-medium text-foreground">
                    {node.title}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>

      <TaskPlanGenerationPanel
        taskId={item.taskId}
        title={item.title}
        description={item.description}
        priority={item.priority}
        dueAt={item.dueAt}
        autoRequest={false}
        onPlanLoaded={onPlanLoaded}
        onApply={onApplyDecomposition}
      />
    </div>
  );
}
