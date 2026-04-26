"use client";

import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import { toTaskConfigInitialValues } from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";
import { toPlanGraphPlan } from "./plan-utils";

export function SelectedBlockMainColumn({
  item,
  copy,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  acceptedPlan,
  onMutatedAction,
  onTaskConfigDraftStateChange,
  onSaveTaskConfig,
}: {
  item: ScheduledItem;
  copy: SchedulePageCopy;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  acceptedPlan: TaskPlanGraphResponse | null;
  onMutatedAction: () => Promise<void>;
  onTaskConfigDraftStateChange: (state: TaskConfigDraftState) => void;
  onSaveTaskConfig: (input: TaskConfigFormInput) => Promise<void>;
}) {
  const acceptedGraphPlan = toPlanGraphPlan(acceptedPlan);

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
              <ScheduleEditorForm
                taskId={item.taskId}
                dueAt={item.dueAt}
                scheduledStartAt={item.scheduledStartAt}
                scheduledEndAt={item.scheduledEndAt}
                submitLabel={copy.scheduleTask}
                onMutatedAction={onMutatedAction}
              />
            </div>
            <div className="border-t border-border/60 bg-muted/[0.12] px-1 pt-4">
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
