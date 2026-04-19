"use client";

import type { TaskPlanGraphResponse } from "@/modules/ai/types";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";

export function AiInsightsPanel({
  item,
  onApplyDecomposition,
}: {
  item: ScheduledItem;
  onApplyDecomposition: (result: TaskPlanGraphResponse) => Promise<void>;
}) {
  return (
    <TaskDecompositionPanel
      taskId={item.taskId}
      title={item.title}
      description={item.description}
      priority={item.priority}
      dueAt={item.dueAt}
      autoRequest
      onApply={onApplyDecomposition}
    />
  );
}
