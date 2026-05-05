"use client";

import { CheckCircle2, Clock3, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { TaskPlanGenerationPanel } from "@/components/task/ai/task-plan-generation-panel";
import { TaskContextLinks } from "@/components/task/shared/task-context-links";
import type { TaskConfigFormDraft } from "@/components/schedule/task-config-form";
import type { TaskPlanGraphResponse } from "@chrona/contracts/ai";
import type { SavedTaskPlan } from "./use-selected-block-plan-state";

export function SelectedBlockAiSidebar({
  workspaceId,
  taskId,
  latestRunStatus,
  workLabel,
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
  workspaceId: string;
  taskId: string;
  latestRunStatus: string | null;
  workLabel: string;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: SavedTaskPlan | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlanId: string | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onPlanLoaded: (savedPlan: SavedTaskPlan | null) => void;
  onApplyPlan: (result: TaskPlanGraphResponse) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
}) {
  const statusConfig = generationStatus === "generating"
    ? {
        icon: <Loader2 className="size-4 animate-spin" />,
        label: "Generating",
        className: "border-primary-border bg-primary-soft text-primary dark:border-primary/30 dark:bg-primary/10 dark:text-primary",
      }
    : generationStatus === "waiting_acceptance"
      ? {
          icon: <Clock3 className="size-4" />,
          label: "Draft ready",
          className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
        }
      : generationStatus === "accepted"
        ? {
            icon: <CheckCircle2 className="size-4" />,
            label: "Applied",
            className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
          }
        : {
            icon: <Sparkles className="size-4" />,
            label: "No plan",
            className: "border-border/70 bg-muted/35 text-muted-foreground",
          };

  return (
    <aside
      data-testid="selected-block-ai-sidebar"
      className="min-h-0 overflow-y-auto border-l border-border/60 bg-[linear-gradient(180deg,hsl(var(--muted)/0.32),hsl(var(--background))_38%)] px-5 py-5 md:px-5"
    >
      <div className="space-y-4 pb-6">
        <div className="rounded-2xl border border-border/70 bg-background/85 p-3 shadow-sm backdrop-blur">
          <TaskContextLinks
            workspaceId={workspaceId}
            taskId={taskId}
            latestRunStatus={latestRunStatus}
            workLabel={workLabel}
            className="w-full [&>a]:flex-1"
          />
        </div>

        <section className="overflow-hidden rounded-3xl border border-border/70 bg-background/90 shadow-sm">
          <div className="border-b border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_46%),hsl(var(--muted)/0.18)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15">
                  <WandSparkles className="size-4.5" />
                </span>
                <div className="text-sm font-semibold text-foreground">AI plan</div>
              </div>
              <div className="flex items-center gap-2">
                {savedPlan?.revision ? (
                  <span className="rounded-full border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm">
                    r{savedPlan.revision}
                  </span>
                ) : null}
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm ${statusConfig.className}`}>
                  {statusConfig.icon}
                  {statusConfig.label}
                </span>
              </div>
            </div>
          </div>
          <div className="p-3">
            <TaskPlanGenerationPanel
              taskId={taskId}
              title={planningTaskDraft.title}
              description={planningTaskDraft.description}
              priority={planningTaskDraft.priority}
              dueAt={planningTaskDraft.dueAt}
              autoRequest={false}
              savedPlan={savedPlan}
              generationStatus={generationStatus}
              onPlanLoaded={onPlanLoaded}
              onApply={onApplyPlan}
              activeAcceptedPlanId={acceptedPlanId}
              hasUnsavedConfigChanges={hasUnsavedConfigChanges}
              unsavedConfigDraft={unsavedConfigDraft}
              onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
