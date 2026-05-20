"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { toTaskConfigInitialValues } from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigFormDraft,
  type TaskConfigExecutionRuntime,
  type TaskConfigFormInput,
} from "@/components/schedule/forms/task-config-form";
import { TaskAiPlanPanel } from "@/components/tasks/panels/task-ai-plan-panel";
import { TaskEditPanel } from "@/components/tasks/panels/task-edit-panel";
import { Button } from "@/components/ui/button";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { SavedTaskPlan } from "./use-selected-block-plan-state";

export function SelectedBlockMainColumn({
  item,
  copy,
  executionRuntimes,
  defaultExecutionRuntime,
  isPending,
  planningTaskDraft,
  savedPlan,
  generationStatus,
  acceptedPlan,
  hasUnsavedConfigChanges,
  unsavedConfigDraft,
  onDeleteTask,
  onTaskConfigDraftStateChange,
  onSaveTaskConfig,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
}: {
  item: ScheduledItem;
  copy: SchedulePageCopy;
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  isPending: boolean;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: SavedTaskPlan | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlan: TaskPlanReadModel | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onDeleteTask?: (taskId: string) => void;
  onTaskConfigDraftStateChange: (state: TaskConfigDraftState) => void;
  onSaveTaskConfig: (input: TaskConfigFormInput) => Promise<void>;
  onPlanLoaded: (savedPlan: SavedTaskPlan | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div
      data-testid="selected-block-main-column"
      className="min-w-0 px-5 py-5 text-sm text-muted-foreground md:px-6"
    >
      <div className="space-y-5">
        <TaskEditPanel>
          <TaskConfigForm
            executionRuntimes={executionRuntimes}
            defaultExecutionRuntime={defaultExecutionRuntime}
            isPending={isPending}
            initialValues={toTaskConfigInitialValues(item)}
            submitLabel={copy.saveTaskConfig}
            pendingLabel={copy.saving}
            footerActions={onDeleteTask ? (
              showDeleteConfirm ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <span>Delete &ldquo;{item.title}&rdquo;?</span>
                  <Button
                    type="button"
                    onClick={() => onDeleteTask(item.taskId)}
                    variant="destructive" size="sm"
                  >
                    Confirm delete
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    variant="ghost" size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  variant="outline"
                  size="default"
                  className="border-destructive/25 text-destructive hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete task
                </Button>
              )
            ) : null}
            onDraftStateChange={onTaskConfigDraftStateChange}
            onSubmitAction={onSaveTaskConfig}
          />
        </TaskEditPanel>

        <TaskAiPlanPanel
          taskId={item.taskId}
          planningTaskDraft={planningTaskDraft}
          savedPlan={savedPlan}
          generationStatus={generationStatus}
          acceptedPlanId={acceptedPlan?.id ?? null}
          hasUnsavedConfigChanges={hasUnsavedConfigChanges}
          unsavedConfigDraft={unsavedConfigDraft}
          onPlanLoaded={onPlanLoaded}
          onApplyPlan={onApplyPlan}
          onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
        />
      </div>
    </div>
  );
}
