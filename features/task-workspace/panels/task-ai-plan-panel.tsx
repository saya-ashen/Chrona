"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, Sparkles, WandSparkles } from "lucide-react";
import type { TaskPlanReadModel } from "@chrona/contracts"
import { TaskPlanGraphPanel } from "./task-plan-graph-panel";
import { TaskPlanGenerationPanel } from "../ai/task-plan-generation-panel";
import { taskPlanReadModelToGraphPlan } from "../plan/task-plan-view-model";
import type { TaskConfigFormDraft } from "@features/task-workspace/public/task-config-draft";
import { Button, Card } from "@shared/ui";

type TaskAiPlanPanelProps = {
  taskId: string;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: TaskPlanReadModel | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlanId: string | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onPlanLoaded: (savedPlan: TaskPlanReadModel | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
  previewOnly?: boolean;
};

export function TaskAiPlanPanel({
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
  previewOnly = false,
}: TaskAiPlanPanelProps) {
  const [requestGenerationKey, setRequestGenerationKey] = useState(0);
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
          className: "border-warning/30 bg-warning/15 text-warning-foreground",
        }
      : generationStatus === "accepted"
        ? {
            icon: <CheckCircle2 className="size-4" />,
            label: "Applied",
            className: "border-success/30 bg-success/12 text-success",
          }
        : {
            icon: <Sparkles className="size-4" />,
            label: "No plan",
            className: "border-border/70 bg-muted/35 text-muted-foreground",
          };
  const actionLabel = savedPlan ? "Regenerate plan" : "Generate plan";
  const previewGraph = useMemo(() => taskPlanReadModelToGraphPlan(savedPlan), [savedPlan]);

  if (previewOnly) {
    if (!previewGraph) {
      return (
        <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 text-center text-sm text-muted-foreground">
          No plan available to preview.
        </div>
      );
    }

    return (
      <div className="min-h-64 overflow-hidden rounded-xl border border-border/60 bg-background">
        <TaskPlanGraphPanel
          label="Plan preview"
          plan={previewGraph}
          mode="compact"
          className="min-h-64 w-full"
        />
      </div>
    );
  }
  return (
    <Card
     
     
      className="overflow-hidden rounded-3xl border border-border/70 bg-background/90 shadow-sm"
    >
      <div className="border-b border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_46%),hsl(var(--muted)/0.18)] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-[0.95rem] bg-primary/10 px-2 text-primary shadow-sm ring-1 ring-primary/15">
              <WandSparkles className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">AI plan</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Break this task into concrete steps before you edit or run it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {generationStatus === "generating" ? null : (
              <Button
                type="button"
                onClick={() => setRequestGenerationKey((current) => current + 1)}
                variant="outline"
                size="sm"
                className="rounded-full border-primary/20 bg-background/80 text-primary hover:bg-primary/10"
              >
                {actionLabel}
              </Button>
            )}
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
          requestGenerationKey={requestGenerationKey}
          showRegenerateButton={false}
          showEmptyGenerateButton={false}
        />
      </div>
    </Card>
  );
}
