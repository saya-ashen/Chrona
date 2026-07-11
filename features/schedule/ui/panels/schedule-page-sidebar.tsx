import { ScheduleMiniCalendar } from "../schedule-mini-calendar";
import { QueueCard } from "./schedule-page-panels";
import type {
  SchedulePageData,
  UnscheduledItem,
} from "../schedule-page-types";
import type { Locale } from "@chrona/i18n";
import type { ScheduleViewMode } from "../schedule-page-types";
import type { SchedulePageCopy } from "../schedule-page-copy";
import type { SchedulePageViewModel } from "../schedule-page-view-model";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "./schedule-panel-primitives";

/**
 * Schedule page sidebar — now split into two parts:
 * - LeftSidebar: compact mini calendar
 * - RightSidebar: simplified queue list
 *
 * The parent SchedulePage composes them on either side of the main timeline.
 */

export function ScheduleLeftSidebar({
  copy,
  locale,
  activeView,
  viewModel,
  localizeHref,
  buildScheduleViewHref,
}: {
  copy: SchedulePageCopy;
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
        selectedDate={viewModel.activeDayDate}
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
          <CardTitle>{copy.insightsTitle}</CardTitle>
          <CardDescription>{copy.insightsDescription}</CardDescription>
        </CardHeader>
        <div className="space-y-2 text-sm">
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">{copy.selectedDay}</p>
            <p className="mt-1 font-medium text-foreground">{selectedDay?.label ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">{copy.scheduledItems}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{selectedDay?.scheduledCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">{copy.riskItems}</p>
            <p className="mt-1 text-lg font-semibold text-destructive">{selectedDay?.riskCount ?? 0}</p>
          </div>
        </div>
      </Card>
    </aside>
  );
}

export function ScheduleRightSidebar({
  copy,
  viewData,
  draggedTask,
  isPending,
  handleQueueDragStart,
  handleQueueDragEnd,
  onOpenTaskDetails,
  onScheduleTask,
}: {
  copy: SchedulePageCopy;
  viewData: SchedulePageData;
  draggedTask: { kind: "queue" | "scheduled"; taskId: string } | null;
  isPending: boolean;
  handleQueueDragStart: (
    item: UnscheduledItem,
    event: React.DragEvent<HTMLElement>,
  ) => void;
  handleQueueDragEnd: () => void;
  onOpenTaskDetails: (taskId: string) => void;
  onScheduleTask: (taskId: string) => void;
}) {
  return (
    <aside
      aria-label={copy.planningDrawerLabel}
      className="min-h-0 overflow-visible xl:overflow-y-auto xl:pl-1"
    >
      <Tabs
        defaultValue={viewData.summary.riskCount > 0 ? "attention" : "queue"}
        className="h-full min-h-0"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="queue">
            {copy.readyToSchedule}
            <Badge variant="secondary">{viewData.unscheduled.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="attention">
            {copy.needsAttentionTab}
            <Badge variant={viewData.risks.length > 0 ? "destructive" : "secondary"}>
              {viewData.risks.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="min-h-0">
          <Card className="mt-2 xl:sticky xl:top-0">
            <CardHeader>
              <CardTitle>{copy.readyToSchedule}</CardTitle>
              <CardDescription>{copy.readyToScheduleDescription}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-visible pr-0 xl:max-h-[calc(100vh-19rem)] xl:overflow-y-auto xl:pr-3">
              {viewData.unscheduled.length === 0 ? (
                <EmptyState>{copy.noUnscheduledWork}</EmptyState>
              ) : (
                <div className="flex flex-col gap-2">
                  {viewData.unscheduled.map((item) => (
                    <QueueCard
                      key={item.taskId}
                      item={item}
                      isPending={isPending}
                      isDragging={
                        draggedTask?.kind === "queue" &&
                        draggedTask.taskId === item.taskId
                      }
                      onDragStart={handleQueueDragStart}
                      onDragEnd={handleQueueDragEnd}
                      onScheduleTask={onScheduleTask}
                      onOpenTaskDetails={onOpenTaskDetails}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attention" className="min-h-0">
          <Card className="mt-2">
            <CardHeader>
              <CardTitle>{copy.needsAttentionTab}</CardTitle>
              <CardDescription>{copy.attentionDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {viewData.risks.length === 0 ? (
                <EmptyState>{copy.noAttentionItems}</EmptyState>
              ) : (
                viewData.risks.map((item) => (
                  <Card key={item.taskId} size="sm" className="gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.actionRequired ?? item.runnabilitySummary}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenTaskDetails(item.taskId)}
                    >
                      {copy.openTask}
                    </Button>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
