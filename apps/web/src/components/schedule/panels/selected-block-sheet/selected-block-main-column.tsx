"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { toTaskConfigInitialValues } from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import { taskPlanResponseToGraphPlan } from "@/components/task/plan/task-plan-view-model";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskPlanGraphResponse } from "@chrona/contracts/ai";
import { cn } from "@/lib/utils";

export function SelectedBlockMainColumn({
  item,
  copy,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  acceptedPlan,
  onDeleteTask,
  onTaskConfigDraftStateChange,
  onSaveTaskConfig,
}: {
  item: ScheduledItem;
  copy: SchedulePageCopy;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  acceptedPlan: TaskPlanGraphResponse | null;
  onDeleteTask?: (taskId: string) => void;
  onTaskConfigDraftStateChange: (state: TaskConfigDraftState) => void;
  onSaveTaskConfig: (input: TaskConfigFormInput) => Promise<void>;
}) {
  const acceptedGraphPlan = taskPlanResponseToGraphPlan(acceptedPlan);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div
      data-testid="selected-block-main-column"
      className="min-h-0 overflow-y-auto border-b border-border/60 px-5 py-5 text-sm text-muted-foreground md:border-b-0 md:border-r md:px-6"
    >
      <div className="space-y-5 pb-6">
        <SurfaceCard
          as="div"
          variant="inset"
          padding="sm"
          className="overflow-hidden rounded-[1.6rem] border-border/70 bg-background shadow-sm"
        >
          <div className="space-y-5">
            <div className="px-1">
              <TaskConfigForm
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                initialValues={toTaskConfigInitialValues(item)}
                submitLabel={copy.saveTaskConfig}
                pendingLabel={copy.saving}
                onDraftStateChange={onTaskConfigDraftStateChange}
                onSubmitAction={onSaveTaskConfig}
              />
            </div>
            {onDeleteTask ? (
              <div className="border-t border-border/60 px-1 pt-4">
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2">
                    <span className="flex-1 text-xs text-red-700">Delete &ldquo;{item.title}&rdquo;?</span>
                    <button
                      type="button"
                      onClick={() => onDeleteTask(item.taskId)}
                      className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "gap-1.5 text-xs text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50",
                    )}
                  >
                    <Trash2 className="size-3.5" />
                    Delete task
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </SurfaceCard>

        {acceptedGraphPlan ? (
          <SurfaceCard
            as="div"
            variant="inset"
            padding="sm"
            className="rounded-[1.5rem] border-border/70 bg-background shadow-sm"
          >
            <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {copy.taskPlanLabel}
            </p>
            <TaskPlanGraph plan={acceptedGraphPlan} />
          </SurfaceCard>
        ) : null}
      </div>
    </div>
  );
}
