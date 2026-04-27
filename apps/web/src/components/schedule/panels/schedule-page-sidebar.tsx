import { ScheduleMiniCalendar } from "@/components/schedule/schedule-mini-calendar";
import { QueueCard } from "@/components/schedule/schedule-page-panels";
import type {
  SchedulePageData,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import type { Locale } from "@/i18n/config";
import type { ScheduleViewMode } from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";

import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
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
  return (
    <div className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">
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
    </div>
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
    <div className="w-72 shrink-0 overflow-y-auto">
      <SurfaceCard padding="sm">
        <SurfaceCardHeader>
          <SurfaceCardTitle>{copy.unscheduledQueue}</SurfaceCardTitle>
          <SurfaceCardDescription>{copy.unscheduledQueueDescription}</SurfaceCardDescription>
        </SurfaceCardHeader>
        <div className="mt-3 space-y-2">
          {viewData.unscheduled.length === 0 ? (
            <EmptyState>{copy.noUnscheduledWork}</EmptyState>
          ) : (
            viewData.unscheduled.map((item) => (
              <QueueCard
                key={item.taskId}
                item={item}
                runtimeAdapters={data.runtimeAdapters}
                defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
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
      </SurfaceCard>
    </div>
  );
}

// Legacy export for backward compatibility
export function SchedulePageSidebar(_props: Record<string, unknown>) {
  return null;
}
