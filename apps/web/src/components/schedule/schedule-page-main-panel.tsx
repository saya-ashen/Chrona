import { PlanningHeader } from "@/components/schedule/panels/planning-header";
import { Card } from "@/components/ui/card";
import { DayTimeline } from "@/components/schedule/timeline/schedule-page-timeline";
import { ScheduleTaskList } from "@/components/schedule/schedule-task-list";
import type {
  ScheduleGhostBlockPreview,
} from "@chrona/contracts";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineCreateInput,
  TimelineDragItem,
} from "@/components/schedule/schedule-page-types";
import type { PlanningBusyBlock } from "@chrona/domain";
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
  onNavigate,
  localizeHref,
  buildScheduleViewHref,
}: {
  copy: SchedulePageCopy;
  locale: string;
  activeView: ScheduleViewMode;
  viewData: SchedulePageData;
  viewModel: SchedulePageViewModel;
  onNavigate: (href: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localizeHref: (locale: any, href: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          tone: viewData.planningSummary.readyToScheduleCount > 0 ? "info" : undefined,
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
          label: copy.cockpitConnectAi,
          href: localizeHref(locale, "/settings?panel=ai-clients"),
          description: copy.cockpitConnectAiHint,
        },
      ]}
      onNavigate={onNavigate}
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
  ghostPreview,
  externalEvents,
  executionRuntimes,
  defaultExecutionRuntime,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
  onSelectTask,
  onSaveTaskConfigAction,
}: {
  copy: SchedulePageCopy;
  activeView: ScheduleViewMode;
  draggedItem: TimelineDragItem | null;
  activeGroup: SchedulePageViewModel["activeGroup"];
  activeSelectedTaskId: string | undefined;
  conflictTaskIds: Set<string>;
  listItems: SchedulePageData["listItems"];
  ghostPreview: ScheduleGhostBlockPreview | null;
  externalEvents: PlanningBusyBlock[];
  executionRuntimes: SchedulePageData["executionRuntimes"];
  defaultExecutionRuntime: string;
  isPending: boolean;
  onScheduleDrop: (
    item: TimelineDragItem,
    startAt: Date,
    endAt: Date,
  ) => Promise<void>;
  onCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
  onScheduledDragStart: (item: SchedulePageData["scheduled"][number]) => void;
  onDragEnd: () => void;
  onSelectTask: (taskId: string) => void;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden xl:min-h-0">
      <Card className="flex min-h-[34rem] flex-1 flex-col rounded-[24px] p-3 xl:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {copy.scheduledTimeline}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draggedItem ? (
              <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                {copy.dropMode}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-border/45 bg-background/65">
          {activeView === "timeline" ? (
            activeGroup ? (
              <DayTimeline
                items={activeGroup.items}
                dayDate={activeGroup.date}
                selectedDay={activeGroup.key}
                selectedTaskId={activeSelectedTaskId}
                conflictTaskIds={conflictTaskIds}
                ghostPreview={ghostPreview}
                externalEvents={externalEvents}
                draggedItem={draggedItem}
                executionRuntimes={executionRuntimes}
                defaultExecutionRuntime={defaultExecutionRuntime}
                isPending={isPending}
                onScheduleDrop={onScheduleDrop}
                onCreateTaskBlock={onCreateTaskBlock}
                onScheduledDragStart={onScheduledDragStart}
                onDragEnd={onDragEnd}
                onSelectTask={onSelectTask}
              />
            ) : (
              <EmptyState>{copy.noTimelineDay}</EmptyState>
            )
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ScheduleTaskList
                items={listItems}
                executionRuntimes={executionRuntimes}
                defaultExecutionRuntime={defaultExecutionRuntime}
                onSaveTaskConfigAction={onSaveTaskConfigAction}
                isPending={isPending}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
