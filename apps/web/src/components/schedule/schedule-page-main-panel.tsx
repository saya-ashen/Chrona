import { PlanningHeader } from "@/components/schedule/planning-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DayTimeline } from "@/components/schedule/schedule-page-timeline";
import { ScheduleTaskList } from "@/components/schedule/schedule-task-list";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineDragItem,
} from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";
import type { TaskConfigFormInput } from "@/components/schedule/forms/task-config-form";
import { EmptyState } from "./panels/schedule-panel-primitives";

export function SchedulePageHeader({
  copy,
  locale,
  activeView,
  viewData,
  viewModel,
  onOpenQuickAdd,
  localizeHref,
  buildScheduleViewHref,
}: {
  copy: SchedulePageCopy;
  locale: string;
  activeView: ScheduleViewMode;
  viewData: SchedulePageData;
  viewModel: SchedulePageViewModel;
  onOpenQuickAdd: () => void;
  localizeHref: (locale: any, href: string) => string;
  buildScheduleViewHref: (...args: any[]) => string;
}) {
  return (
    <PlanningHeader
      ariaLabel={copy.pageTitle}
      title={copy.pageTitle}
      activeDayLabel={viewModel.activeGroup?.label ?? viewModel.activeDay}
      summary={viewModel.cockpitSummary}
      dateSwitcherLabel={copy.dateSwitcher}
      dayLinks={[
        {
          label: copy.today,
          href: localizeHref(
            locale,
            buildScheduleViewHref(viewModel.todayKey, activeView),
          ),
          current: viewModel.activeDay === viewModel.todayKey,
        },
        {
          label: copy.tomorrow,
          href: localizeHref(
            locale,
            buildScheduleViewHref(viewModel.tomorrowKey, activeView),
          ),
          current: viewModel.activeDay === viewModel.tomorrowKey,
        },
      ]}
      activeView={activeView}
      timelineHref={localizeHref(
        locale,
        buildScheduleViewHref(
          viewModel.activeDay,
          "timeline",
          viewModel.activeSelectedTaskId,
        ),
      )}
      listHref={localizeHref(
        locale,
        buildScheduleViewHref(
          viewModel.activeDay,
          "list",
          viewModel.activeSelectedTaskId,
        ),
      )}
      timelineLabel={copy.timeline}
      listLabel={copy.list}
      metrics={[
        {
          label: copy.cockpitTodayLoad,
          value: `${viewData.planningSummary.todayLoadMinutes}m`,
          hint: copy.cockpitTodayLoadHint,
        },
        {
          label: copy.queueMetric,
          value: String(viewData.planningSummary.readyToScheduleCount),
          hint: copy.cockpitQueueHint,
          tone: viewData.summary.unscheduledCount > 0 ? "info" : undefined,
        },
        {
          label: copy.risksMetric,
          value: String(viewData.summary.riskCount),
          hint: copy.cockpitRisksHint,
          tone: viewData.summary.riskCount > 0 ? "critical" : undefined,
        },
        {
          label: copy.cockpitSuggestions,
          value: String(
            viewData.summary.proposalCount +
              viewData.automationCandidates.length,
          ),
          hint: copy.cockpitSuggestionsHint,
          tone:
            viewData.summary.proposalCount > 0 ||
            viewData.automationCandidates.length > 0
              ? "info"
              : undefined,
        },
      ]}
      actions={[
        {
          label: copy.cockpitQuickAdd,
          onClick: onOpenQuickAdd,
          description: copy.cockpitQuickAddHint,
        },
        {
          label: copy.cockpitReviewSuggestions,
          href: "#schedule-cockpit-sidebar",
          description: copy.cockpitReviewSuggestionsHint,
        },
        {
          label: copy.cockpitAutoArrange,
          description: copy.cockpitAutoArrangeHint,
          disabled: true,
        },
        {
          label: copy.cockpitPlanWithAi,
          description: copy.cockpitPlanWithAiHint,
          disabled: true,
        },
      ]}
    />
  );
}

export function SchedulePageMainPanel({
  copy,
  activeView,
  draggedItem,
  activeGroup,
  activeSelectedTaskId,
  conflictTaskIds,
  listItems,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
  onSaveTaskConfigAction,
}: {
  copy: SchedulePageCopy;
  activeView: ScheduleViewMode;
  draggedItem: TimelineDragItem | null;
  activeGroup: SchedulePageViewModel["activeGroup"];
  activeSelectedTaskId: string | undefined;
  conflictTaskIds: Set<string>;
  listItems: SchedulePageData["listItems"];
  runtimeAdapters: SchedulePageData["runtimeAdapters"];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onScheduleDrop: (
    item: TimelineDragItem,
    startAt: Date,
    endAt: Date,
  ) => Promise<void>;
  onCreateTaskBlock: (input: any) => Promise<void>;
  onScheduledDragStart: (item: SchedulePageData["scheduled"][number]) => void;
  onDragEnd: () => void;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SurfaceCard variant="highlight" className="flex min-h-0 flex-1 flex-col rounded-[30px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {copy.scheduledTimeline}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draggedItem ? (
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                {copy.dropMode}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/55 bg-background/70 p-3">
          {activeView === "timeline" ? (
            activeGroup ? (
              <DayTimeline
                items={activeGroup.items}
                dayDate={activeGroup.date}
                selectedDay={activeGroup.key}
                selectedTaskId={activeSelectedTaskId}
                conflictTaskIds={conflictTaskIds}
                draggedItem={draggedItem}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                onScheduleDrop={onScheduleDrop}
                onCreateTaskBlock={onCreateTaskBlock}
                onScheduledDragStart={onScheduledDragStart}
                onDragEnd={onDragEnd}
              />
            ) : (
              <EmptyState>{copy.noTimelineDay}</EmptyState>
            )
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ScheduleTaskList
                items={listItems}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                onSaveTaskConfigAction={onSaveTaskConfigAction}
                isPending={isPending}
              />
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
