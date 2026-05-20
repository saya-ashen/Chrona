import { ScheduleMiniCalendar } from "@/components/schedule/schedule-mini-calendar";
import { QueueCard } from "@/components/schedule/panels/schedule-page-panels";
import type {
  SchedulePageData,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import type { Locale } from "@chrona/i18n";
import type { ScheduleViewMode } from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";

import type { TaskConfigFormInput } from "@/components/schedule/forms/task-config-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "./schedule-panel-primitives";

/**
 * Schedule page sidebar — now split into two parts:
 * - LeftSidebar: compact mini calendar
 * - RightSidebar: simplified queue list
 *
 * The parent SchedulePage composes them on either side of the main timeline.
 */

export function ScheduleLeftSidebar({
  locale,
  activeView,
  viewModel,
  localizeHref,
  buildScheduleViewHref,
}: {
  locale: Locale | undefined;
  activeView: ScheduleViewMode;
  viewModel: SchedulePageViewModel;
  localizeHref: (locale: Locale | undefined, href: string) => string;
  buildScheduleViewHref: (
    day: string,
    view: ScheduleViewMode,
    taskId?: string,
  ) => string;
}) {
  const selectedDay = viewModel.calendarDays.find((day) => day.isSelected);

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-visible xl:overflow-y-auto xl:pr-1">
      <ScheduleMiniCalendar
        monthLabel={viewModel.calendarMonthLabel}
        days={viewModel.calendarDays.map((day) => ({
          ...day,
          href: localizeHref(
            locale,
            buildScheduleViewHref(
              day.key,
              activeView,
              viewModel.activeSelectedTaskId,
            ),
          ),
        }))}
      />

      <Card className="space-y-3">
        <CardHeader>
          <CardTitle>Insights</CardTitle>
          <CardDescription>Task distribution and risk signals</CardDescription>
        </CardHeader>
        <div className="space-y-2 text-sm">
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">Selected day</p>
            <p className="mt-1 font-medium text-foreground">{selectedDay?.label ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">Scheduled items</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{selectedDay?.scheduledCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">Risk items</p>
            <p className="mt-1 text-lg font-semibold text-rose-600">{selectedDay?.riskCount ?? 0}</p>
          </div>
        </div>
      </Card>
    </aside>
  );
}

export function ScheduleRightSidebar({
  copy,
  viewData,
  data,
  draggedTask,
  expandedQueueTaskIds,
  isPending,
  refreshProjection,
  toggleQueueCard,
  handleTaskConfigSave,
  handleQueueDragStart,
  handleQueueDragEnd,
  onDeleteTask,
}: {
  copy: SchedulePageCopy;
  viewData: SchedulePageData;
  data: SchedulePageData;
  draggedTask: { kind: "queue" | "scheduled"; taskId: string } | null;
  expandedQueueTaskIds: string[];
  isPending: boolean;
  refreshProjection: () => Promise<void>;
  toggleQueueCard: (taskId: string) => void;
  handleTaskConfigSave: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  handleQueueDragStart: (
    item: UnscheduledItem,
    event: React.DragEvent<HTMLElement>,
  ) => void;
  handleQueueDragEnd: () => void;
  onDeleteTask: (taskId: string) => Promise<void>;
}) {
  return (
    <aside className="min-h-0 overflow-visible xl:overflow-y-auto xl:pl-1">
      <Card className="xl:sticky xl:top-0">
        <CardHeader>
          <CardTitle>{copy.unscheduledQueue}</CardTitle>
          <CardDescription>{copy.unscheduledQueueDescription}</CardDescription>
        </CardHeader>
        <div className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-19rem)]">
          {viewData.unscheduled.length === 0 ? (
            <EmptyState>{copy.noUnscheduledWork}</EmptyState>
          ) : (
            viewData.unscheduled.map((item) => (
              <QueueCard
                key={item.taskId}
                item={item}
                executionRuntimes={data.executionRuntimes}
                defaultExecutionRuntime={data.defaultExecutionRuntime}
                isPending={isPending}
                isDragging={
                  draggedTask?.kind === "queue" &&
                  draggedTask.taskId === item.taskId
                }
                isExpanded={expandedQueueTaskIds.includes(item.taskId)}
                onToggle={() => toggleQueueCard(item.taskId)}
                onMutatedAction={refreshProjection}
                onSaveTaskConfigAction={handleTaskConfigSave}
                onDragStart={handleQueueDragStart}
                onDragEnd={handleQueueDragEnd}
                onDeleteTask={onDeleteTask}
              />
            ))
          )}
        </div>
      </Card>
    </aside>
  );
}
