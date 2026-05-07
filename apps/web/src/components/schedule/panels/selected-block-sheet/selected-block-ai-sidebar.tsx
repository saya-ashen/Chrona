"use client";

import { TaskAiPlanPanel } from "@/components/task/panels/task-ai-plan-panel";
import type { TaskConfigFormDraft } from "@/components/schedule/task-config-form";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { SavedTaskPlan } from "./use-selected-block-plan-state";

export function SelectedBlockAiSidebar({
  taskId,
  planningTaskDraft,
  savedPlan,
  generationStatus,
  acceptedPlanId,
  hasUnsavedConfigChanges,
  unsavedConfigDraft,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
}: {
  taskId: string;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: SavedTaskPlan | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlanId: string | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onPlanLoaded: (savedPlan: SavedTaskPlan | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
}) {
  return (
    <aside
      data-testid="selected-block-ai-sidebar"
      className="min-w-0 border-l border-border/60 bg-[linear-gradient(180deg,hsl(var(--muted)/0.32),hsl(var(--background))_38%)] px-5 py-5 md:sticky md:top-0 md:self-start"
    >
      <div>
        <TaskAiPlanPanel
          taskId={taskId}
          planningTaskDraft={planningTaskDraft}
          savedPlan={savedPlan}
          generationStatus={generationStatus}
          acceptedPlanId={acceptedPlanId}
          hasUnsavedConfigChanges={hasUnsavedConfigChanges}
          unsavedConfigDraft={unsavedConfigDraft}
          onPlanLoaded={onPlanLoaded}
          onApplyPlan={onApplyPlan}
          onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
        />
      </div>
    </aside>
  );
}
