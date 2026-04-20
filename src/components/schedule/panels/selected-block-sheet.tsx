import { useState } from "react";
import { Calendar, Sparkles } from "lucide-react";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import {
  getSchedulePageCopy,
  type SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import {
  formatDateTime,
  formatTimeRange,
  toTaskConfigInitialValues,
} from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useI18n, useLocale } from "@/i18n/client";
import { AiInsightsPanel } from "@/components/schedule/ai-insights-panel";
import { ScheduleTaskPlanSubtasks } from "@/components/schedule/schedule-task-plan-subtasks";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";
import { applyTaskPlanGraphResult } from "@/components/schedule/schedule-task-plan-utils";
import { ItemMeta, DetailGrid } from "@/components/schedule/panels/schedule-page-panels";

export function SelectedBlockSheet({
  item,
  selectedDay,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onSaveTaskConfigAction,
  onMutatedAction,
  buildScheduleHref,
}: {
  item: ScheduledItem;
  selectedDay: string;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  onMutatedAction: () => Promise<void>;
  buildScheduleHref: (day: string, taskId?: string) => string;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const [subtasksRefreshKey, setSubtasksRefreshKey] = useState(0);
  const [planResult, setPlanResult] = useState<TaskPlanGraphResponse | null>(null);

  return (
    <>
      <LocalizedLink
        href={buildScheduleHref(selectedDay)}
        aria-label={copy.closeTaskDetails}
        className="fixed inset-0 z-40 bg-slate-950/35"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] rounded-t-[2rem] border border-border/70 bg-background shadow-[0_-24px_80px_-32px_rgba(15,23,42,0.55)] md:inset-y-4 md:left-1/2 md:w-[min(1180px,calc(100vw-2rem))] md:max-h-none md:-translate-x-1/2 md:rounded-[2rem]"
      >
        <div className="flex max-h-[92vh] min-h-0 flex-col md:max-h-[calc(100vh-2rem)]">
          <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 md:px-6">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {copy.taskDetailsEyebrow}
              </p>
              <div className="space-y-1">
                <h2
                  id="schedule-task-sheet-title"
                  className="text-xl font-semibold tracking-tight text-foreground"
                >
                  {item.title}
                </h2>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  {copy.taskDetailsSummary}
                </p>
              </div>
              <ItemMeta item={item} />
            </div>
            <LocalizedLink
              href={buildScheduleHref(selectedDay)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {copy.close}
            </LocalizedLink>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_300px]">
            <div
              data-testid="selected-block-main-column"
              className="min-h-0 overflow-y-auto border-b border-border/60 px-5 py-5 text-sm text-muted-foreground md:border-b-0 md:border-r md:px-6"
            >
              <div className="space-y-5 pb-6">
                <SurfaceCard
                  as="div"
                  variant="inset"
                  padding="sm"
                  className="rounded-[1.5rem] border-border/70 bg-background shadow-sm"
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                          {copy.adjustBlock}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatTimeRange(
                            item.scheduledStartAt,
                            item.scheduledEndAt,
                            locale,
                            copy,
                          )}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="size-3.5 text-muted-foreground" />
                          {formatDateTime(item.dueAt, locale)}
                        </div>
                      </div>
                    </div>
                    <ScheduleEditorForm
                      taskId={item.taskId}
                      dueAt={item.dueAt}
                      scheduledStartAt={item.scheduledStartAt}
                      scheduledEndAt={item.scheduledEndAt}
                      submitLabel={copy.scheduleTask}
                      onMutatedAction={onMutatedAction}
                    />
                  </div>
                </SurfaceCard>

                <DetailGrid
                  items={[
                    {
                      label: copy.due,
                      value: formatDateTime(item.dueAt, locale),
                    },
                    {
                      label: copy.currentPlan,
                      value: item.scheduleStatus ?? copy.scheduledMetric,
                    },
                    {
                      label: copy.latestRun,
                      value: item.latestRunStatus ?? copy.noActiveRun,
                    },
                    {
                      label: copy.nextAction,
                      value: item.actionRequired ?? copy.stayOnPlan,
                    },
                  ]}
                />

                <SurfaceCard
                  as="div"
                  variant="inset"
                  padding="sm"
                  className="rounded-[1.5rem] border-border/70 bg-background shadow-sm"
                >
                  <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {copy.taskConfig}
                  </p>
                  <TaskConfigForm
                    runtimeAdapters={runtimeAdapters}
                    defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                    isPending={isPending}
                    initialValues={toTaskConfigInitialValues(item)}
                    submitLabel={copy.saveTaskConfig}
                    pendingLabel={copy.saving}
                    onSubmitAction={(input) =>
                      onSaveTaskConfigAction(item.taskId, input)
                    }
                  />
                </SurfaceCard>

                <ScheduleTaskPlanSubtasks
                  parentTaskId={item.taskId}
                  workspaceId={item.workspaceId}
                  refreshKey={subtasksRefreshKey}
                  planResult={planResult}
                />
              </div>
            </div>

            <aside
              data-testid="selected-block-ai-sidebar"
              className="min-h-0 overflow-y-auto bg-muted/10 px-5 py-5 md:px-5"
            >
              <div className="space-y-4 pb-6">
                <SurfaceCard className="border-border/70 bg-background shadow-sm">
                  <div className="space-y-3 p-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/80">
                      <Sparkles className="size-3.5 text-primary" />
                      {copy.aiSidebarTitle}
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {copy.aiSidebarDescription}
                    </p>
                  </div>
                </SurfaceCard>

                <AiInsightsPanel
                  item={item}
                  planResult={planResult}
                  onPlanLoaded={setPlanResult}
                  onApplyDecomposition={async (result) => {
                    const applied = await applyTaskPlanGraphResult({
                      taskId: item.taskId,
                      result,
                    });
                    if (!applied.ok) {
                      console.error("[TaskDecomposition] Failed to apply:", applied.error);
                      return;
                    }
                    setSubtasksRefreshKey((k) => k + 1);
                    await onMutatedAction();
                  }}
                />

                <TaskContextLinks
                  workspaceId={item.workspaceId}
                  taskId={item.taskId}
                  latestRunStatus={item.latestRunStatus}
                  workLabel={t("common.openWorkbench")}
                />
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
