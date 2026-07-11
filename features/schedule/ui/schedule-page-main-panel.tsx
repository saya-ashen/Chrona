import { PlanningHeader } from "./panels/planning-header";
import { Card } from "@/components/ui/card";
import { DayTimeline } from "./timeline/schedule-page-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, Clock } from "lucide-react";
import type {
  ScheduleGhostBlockPreview,
} from "@chrona/contracts";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineCreateInput,
  TimelineDragItem,
} from "./schedule-page-types";
import type { PlanningBusyBlock } from "@chrona/domain";
import type { SchedulePageCopy } from "./schedule-page-copy";
import type { SchedulePageViewModel } from "./schedule-page-view-model";
import type { Locale } from "@chrona/i18n";
import { EmptyState } from "./panels/schedule-panel-primitives";

export function SchedulePageHeader({
  copy,
  locale,
  activeView,
  viewModel,
  onNavigate,
  localizeHref,
  buildScheduleViewHref,
  onScheduleTask,
}: {
  copy: SchedulePageCopy;
  locale: Locale;
  activeView: ScheduleViewMode;
  viewData: SchedulePageData;
  viewModel: SchedulePageViewModel;
  onNavigate: (href: string) => void;
  localizeHref: (locale: Locale | undefined, href: string) => string;
  buildScheduleViewHref: (
    day: string,
    view: ScheduleViewMode,
    taskId?: string,
  ) => string;
  onScheduleTask: () => void;
}) {
  const previousDay = new Date(viewModel.activeDayDate);
  previousDay.setDate(previousDay.getDate() - 1);
  const nextDay = new Date(viewModel.activeDayDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const toDayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const summary = copy.dayPlanningSummaryTemplate
    .replace("{queue}", String(viewModel.display.planningDrawer.readyCount))
    .replace(
      "{risks}",
      String(viewModel.display.planningDrawer.attentionCount),
    );

  return (
    <PlanningHeader
      ariaLabel={copy.pageTitle}
      title={copy.pageTitle}
      activeDayLabel={viewModel.activeGroup?.label ?? viewModel.activeDay}
      summary={summary}
      dayLinks={[
        {
          label: copy.previousDay,
          kind: "previous",
          href: localizeHref(
            locale,
            buildScheduleViewHref(toDayKey(previousDay), activeView),
          ),
        },
        {
          label: copy.today,
          kind: "today",
          href: localizeHref(
            locale,
            buildScheduleViewHref(viewModel.todayKey, activeView),
          ),
          current: viewModel.activeDay === viewModel.todayKey,
        },
        {
          label: copy.nextDay,
          kind: "next",
          href: localizeHref(
            locale,
            buildScheduleViewHref(toDayKey(nextDay), activeView),
          ),
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
      listLabel={copy.agenda}
      primaryAction={{
        label: copy.scheduleTaskAction,
        onClick: onScheduleTask,
      }}
      onNavigate={onNavigate}
    />
  );
}
function DayEmptyState({
  copy,
  readyCount,
  onScheduleTask,
}: {
  copy: SchedulePageCopy;
  readyCount: number;
  onScheduleTask: () => void;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <CalendarDays className="size-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">
        {copy.dayEmptyTitle}
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {readyCount > 0
          ? copy.dayEmptyWithQueueDescription
          : copy.dayEmptyDescription}
      </p>
      <Button type="button" className="mt-4" onClick={onScheduleTask}>
        {copy.scheduleTaskAction}
      </Button>
    </div>
  );
}

function SelectedDayAgenda({
  copy,
  items,
  locale,
  onSelectTask,
}: {
  copy: SchedulePageCopy;
  items: NonNullable<SchedulePageViewModel["activeGroup"]>["items"];
  locale: Locale;
  onSelectTask: (taskId: string) => void;
}) {
  if (items.length === 0) {
    return <EmptyState>{copy.noAgendaItems}</EmptyState>;
  }

  return (
    <section aria-label={copy.selectedDayAgenda} className="space-y-2 p-3">
      {items.map((item) => (
        <Card
          key={item.workBlockId ?? item.taskId}
          size="sm"
          className="flex-row items-center gap-3 rounded-xl p-3"
        >
          <div className="flex w-28 shrink-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
            {item.scheduledStartAt
              ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(item.scheduledStartAt)
              : copy.timeNotSet}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{item.title}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="outline">{item.priority}</Badge>
              {item.actionRequired ? (
                <Badge variant="destructive">{item.actionRequired}</Badge>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSelectTask(item.workBlockId ?? item.taskId)}
          >
            {copy.openTask}
          </Button>
        </Card>
      ))}
    </section>
  );
}


export function SchedulePageMainPanel({
  copy,
  activeView,
  locale,
  draggedItem,
  activeGroup,
  activeSelectedTaskId,
  conflictTaskIds,
  ghostPreview,
  externalEvents,
  executionRuntimes,
  defaultExecutionRuntime,
  availableAiClients,
  readyCount,
  onScheduleTask,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
  onSelectTask,
}: {
  copy: SchedulePageCopy;
  activeView: ScheduleViewMode;
  locale: Locale;
  draggedItem: TimelineDragItem | null;
  activeGroup: SchedulePageViewModel["activeGroup"];
  activeSelectedTaskId: string | undefined;
  conflictTaskIds: Set<string>;
  ghostPreview: ScheduleGhostBlockPreview | null;
  externalEvents: PlanningBusyBlock[];
  executionRuntimes: SchedulePageData["executionRuntimes"];
  defaultExecutionRuntime: string;
  availableAiClients?: SchedulePageData["availableAiClients"];
  readyCount: number;
  onScheduleTask: () => void;
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
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden xl:min-h-0">
      <Card className="flex min-h-[28rem] flex-1 flex-col rounded-[24px] p-3 xl:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {activeView === "timeline"
                ? copy.dayWorkspaceTitle
                : copy.selectedDayAgenda}
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
                availableAiClients={availableAiClients}
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
          ) : activeGroup && activeGroup.items.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SelectedDayAgenda
                copy={copy}
                items={activeGroup.items}
                locale={locale}
                onSelectTask={onSelectTask}
              />
            </div>
          ) : (
            <DayEmptyState
              copy={copy}
              readyCount={readyCount}
              onScheduleTask={onScheduleTask}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
