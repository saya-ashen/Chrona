import { ScheduleMiniCalendar } from "@/components/schedule/schedule-mini-calendar";
import { ScheduleActionRail } from "@/components/schedule/schedule-action-rail";
import { ScheduleAutomationPanel } from "@/components/schedule/panels/schedule-automation-panel";
import { QueueCard } from "@/components/schedule/schedule-page-panels";
import type {
  SchedulePageData,
  SecondaryPlanningView,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import type { Locale } from "@/i18n/config";
import type { ScheduleViewMode } from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";

import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
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
  secondaryView,
  setSecondaryView,
  onRunAutomationCandidate,
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
  secondaryView: SecondaryPlanningView;
  setSecondaryView: (view: SecondaryPlanningView) => void;
  onRunAutomationCandidate: (taskId: string) => Promise<void>;
}) {
  const recordsByTaskId = new Map(
    [...viewData.listItems, ...viewData.scheduled, ...viewData.unscheduled].map(
      (item) => [item.taskId, item],
    ),
  );

  return (
    <div className="w-72 shrink-0 overflow-hidden">
      <ScheduleActionRail
        id="schedule-cockpit-sidebar"
        ariaLabel={copy.cockpitActionsLabel}
        tablistAriaLabel={copy.cockpitActionsLabel}
        activeTab={secondaryView}
        onTabChange={setSecondaryView}
        sections={[
          {
            value: "queue",
            label: copy.unscheduledQueue,
            title: copy.unscheduledQueue,
            description: copy.unscheduledQueueDescription,
            body:
              viewData.unscheduled.length === 0 ? (
                <EmptyState>{copy.noUnscheduledWork}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {viewData.unscheduled.map((item) => (
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
                    />
                  ))}
                </div>
              ),
          },
          {
            value: "risks",
            label: copy.risksMetric,
            title: copy.conflictsTitle,
            description: copy.noScheduleRisks,
            body:
              viewData.risks.length === 0 ? (
                <EmptyState>{copy.noScheduleRisks}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {viewData.risks.map((item) => (
                    <div
                      key={item.taskId}
                      className="rounded-2xl border border-border/60 bg-background/80 p-3 text-sm"
                    >
                      {item.title}
                    </div>
                  ))}
                </div>
              ),
          },
          {
            value: "proposals",
            label: copy.aiProposalsTitle,
            title: copy.aiProposalsTitle,
            description: copy.noAiProposals,
            body:
              viewData.proposals.length === 0 ? (
                <EmptyState>{copy.noAiProposals}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {viewData.proposals.map((proposal) => (
                    <div
                      key={proposal.proposalId}
                      className="rounded-2xl border border-border/60 bg-background/80 p-3 text-sm"
                    >
                      {proposal.title}
                    </div>
                  ))}
                </div>
              ),
          },
          {
            value: "conflicts",
            label: copy.conflictDetectionTitle,
            title: copy.conflictDetectionTitle,
            description: copy.conflictDetectionEmpty,
            body:
              viewData.conflicts.length === 0 ? (
                <EmptyState>{copy.conflictDetectionEmpty}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {viewData.conflicts.map((conflict) => (
                    <div
                      key={conflict.id}
                      className="rounded-2xl border border-border/60 bg-background/80 p-3 text-sm"
                    >
                      {conflict.description}
                    </div>
                  ))}
                </div>
              ),
          },
        ]}
      />

      <div className="mt-3">
        <ScheduleAutomationPanel
          candidates={viewData.automationCandidates}
          recordsByTaskId={recordsByTaskId}
          copy={copy}
          isPending={isPending}
          onRunCandidate={onRunAutomationCandidate}
        />
      </div>
    </div>
  );
}

// Legacy export for backward compatibility
export function SchedulePageSidebar(_props: Record<string, unknown>) {
  return null;
}
