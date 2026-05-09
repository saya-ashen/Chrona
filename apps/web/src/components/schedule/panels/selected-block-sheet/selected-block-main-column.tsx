"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { toTaskConfigInitialValues } from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigExecutionRuntime,
  type TaskConfigFormInput,
} from "@/components/schedule/task-config-form";
import { TaskEditPanel } from "@/components/task/panels/task-edit-panel";
import { TaskPlanGraphPanel } from "@/components/task/panels/task-plan-graph-panel";
import { taskPlanReadModelToGraphPlan } from "@/components/task/plan/task-plan-view-model";
import { buttonVariants } from "@/components/ui/button";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import { cn } from "@/lib/utils";

export function SelectedBlockMainColumn({
  item,
  copy,
  executionRuntimes,
  defaultExecutionRuntime,
  isPending,
  acceptedPlan,
  onDeleteTask,
  onTaskConfigDraftStateChange,
  onSaveTaskConfig,
}: {
  item: ScheduledItem;
  copy: SchedulePageCopy;
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  isPending: boolean;
  acceptedPlan: TaskPlanReadModel | null;
  onDeleteTask?: (taskId: string) => void;
  onTaskConfigDraftStateChange: (state: TaskConfigDraftState) => void;
  onSaveTaskConfig: (input: TaskConfigFormInput) => Promise<void>;
}) {
  const acceptedGraphPlan = taskPlanReadModelToGraphPlan(acceptedPlan);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div
      data-testid="selected-block-main-column"
      className="min-w-0 border-b border-border/60 px-5 py-5 text-sm text-muted-foreground md:border-b-0 md:border-r md:px-6"
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
                  <button
                    type="button"
                    onClick={() => onDeleteTask(item.taskId)}
                    className={buttonVariants({ variant: "destructive", size: "sm" })}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "default" }),
                    "border-destructive/25 text-destructive hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive",
                  )}
                >
                  <Trash2 className="size-4" />
                  Delete task
                </button>
              )
            ) : null}
            onDraftStateChange={onTaskConfigDraftStateChange}
            onSubmitAction={onSaveTaskConfig}
          />
        </TaskEditPanel>

        {acceptedGraphPlan ? (
          <TaskPlanGraphPanel label={copy.taskPlanLabel} plan={acceptedGraphPlan} />
        ) : null}
      </div>
    </div>
  );
}
