import {
  CompactTodayFocus,
  ScheduleMiniCalendar,
} from "@/components/schedule/schedule-mini-calendar";
import {
  EmptyState,
  ProposalCard,
  QueueCard,
  RiskCard,
} from "@/components/schedule/schedule-page-panels";
import { ConflictCard } from "@/components/schedule/conflict-card";
import { ScheduleActionRail } from "@/components/schedule/schedule-action-rail";
import { ScheduleInlineQuickCreate } from "@/components/schedule/schedule-inline-quick-create";
import type {
  QuickCreateDraft,
  SchedulePageData,
  SecondaryPlanningView,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import type { SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";

export function SchedulePageSidebar({
  copy,
  locale,
  activeView,
  viewData,
  viewModel,
  secondaryView,
  draggedTask,
  expandedQueueTaskIds,
  data,
  isPending,
  refreshProjection,
  setSecondaryView,
  toggleQueueCard,
  handleQueueQuickCreate,
  handleTaskConfigSave,
  handleQueueDragStart,
  handleQueueDragEnd,
  handleApplySuggestion,
  handleAcceptProposal,
  handleRejectProposal,
  localizeHref,
  buildScheduleViewHref,
}: {
  copy: SchedulePageCopy;
  locale: string;
  activeView: "timeline" | "list";
  viewData: SchedulePageData;
  viewModel: SchedulePageViewModel;
  secondaryView: SecondaryPlanningView;
  draggedTask: { kind: "queue" | "scheduled"; taskId: string } | null;
  expandedQueueTaskIds: string[];
  data: SchedulePageData;
  isPending: boolean;
  refreshProjection: () => Promise<void>;
  setSecondaryView: (view: SecondaryPlanningView) => void;
  toggleQueueCard: (taskId: string) => void;
  handleQueueQuickCreate: (
    draft: QuickCreateDraft & { durationMinutes: number },
  ) => Promise<void>;
  handleTaskConfigSave: (
    taskId: string,
    input: Parameters<SchedulePageSidebarProps["handleTaskConfigSave"]>[1],
  ) => Promise<void>;
  handleQueueDragStart: (
    item: UnscheduledItem,
    event: React.DragEvent<HTMLElement>,
  ) => void;
  handleQueueDragEnd: () => void;
  handleApplySuggestion: (
    suggestion: SchedulePageData["suggestions"][number],
  ) => Promise<void>;
  handleAcceptProposal: (proposalId: string) => Promise<void>;
  handleRejectProposal: (proposalId: string) => Promise<void>;
  localizeHref: (locale: string, href: string) => string;
  buildScheduleViewHref: (
    selectedDay?: string,
    selectedView?: string,
    selectedTaskId?: string,
  ) => string;
}) {
  return (
    <>
      <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
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

        <CompactTodayFocus
          title={copy.todayFocus}
          items={viewModel.todayFocusItems}
          emptyMessage={copy.todayFocusEmpty}
        />
      </div>

      <div className="w-[340px] shrink-0 overflow-y-auto">
        <ScheduleActionRail
          id="schedule-cockpit-sidebar"
          ariaLabel={viewModel.activeRailLabel}
          tablistAriaLabel={viewModel.activeRailLabel}
          activeTab={secondaryView}
          onTabChange={setSecondaryView}
          sections={[
            {
              value: "queue",
              label: copy.unscheduledQueue,
              title: copy.unscheduledQueue,
              description: copy.unscheduledQueueDescription,
              body: (
                <div className="space-y-3">
                  <ScheduleInlineQuickCreate
                    mode="queue"
                    selectedDay={viewModel.activeDay}
                    isPending={isPending}
                    submitLabel={copy.quickCreateQueueSubmit}
                    hint={copy.quickCreateQueueHint}
                    compact
                    onSubmit={handleQueueQuickCreate}
                  />
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
                      />
                    ))
                  )}
                </div>
              ),
            },
            {
              value: "risks",
              label: copy.conflictsTitle,
              title: copy.conflictsTitle,
              body:
                viewData.risks.length === 0 ? (
                  <EmptyState>{copy.noScheduleRisks}</EmptyState>
                ) : (
                  viewData.risks
                    .slice(0, 2)
                    .map((item) => <RiskCard key={item.taskId} item={item} />)
                ),
            },
            {
              value: "conflicts",
              label: copy.conflictDetectionTitle,
              title: copy.conflictDetectionTitle,
              body:
                viewData.conflicts.length === 0 ? (
                  <EmptyState>{copy.conflictDetectionEmpty}</EmptyState>
                ) : (
                  <div className="space-y-3">
                    {viewData.conflicts.slice(0, 3).map((conflict) => (
                      <ConflictCard
                        key={conflict.id}
                        conflict={conflict}
                        suggestions={viewData.suggestions}
                        onApplySuggestion={handleApplySuggestion}
                        isPending={isPending}
                      />
                    ))}
                  </div>
                ),
            },
            {
              value: "proposals",
              label: copy.aiProposalsTitle,
              title: copy.aiProposalsTitle,
              body:
                viewData.proposals.length === 0 ? (
                  <EmptyState>{copy.aiProposalsCompactEmpty}</EmptyState>
                ) : (
                  viewData.proposals.slice(0, 2).map((proposal) => (
                    <ProposalCard
                      key={proposal.proposalId}
                      proposal={proposal}
                      isPending={isPending}
                      onAccept={handleAcceptProposal}
                      onReject={handleRejectProposal}
                    />
                  ))
                ),
            },
          ]}
        />
      </div>
    </>
  );
}

type SchedulePageSidebarProps = Parameters<typeof SchedulePageSidebar>[0];
