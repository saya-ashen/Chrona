"use client";

import {
  Calendar,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import { type DragEvent, useState } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { getSchedulePageCopy, type SchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type {
  ScheduleProposal,
  TodayFocusItem,
  UnscheduledItem,
  ScheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  formatDateTime,
  getPriorityTone,
  getRunnabilityTone,
  toTaskConfigInitialValues,
} from "@/components/schedule/schedule-page-utils";
import { TimeslotSuggestionPanel } from "@/components/schedule/timeslot-suggestion-panel";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader, SurfaceCardTitle } from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";
import type { ScheduleSlot } from "@/modules/ai/types";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { DetailGrid, EmptyState, ItemMeta, TodayFocusLink } from "./schedule-panel-primitives";

export { DayTimelineSummary } from "./schedule-panel-primitives";
export { SelectedBlockSheet } from "./selected-block-sheet";

export function TodayFocusCard({
  items,
  emptyMessage,
  copy,
}: {
  items: TodayFocusItem[];
  emptyMessage: string;
  copy: SchedulePageCopy;
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>{copy.todayFocus}</SurfaceCardTitle>
      </SurfaceCardHeader>

      {items.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState>{emptyMessage}</EmptyState>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-6 pb-6 text-sm">
          {items.map((item) => (
            <TodayFocusLink key={item.taskId} item={item} />
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function QueueTaskConfigEditor({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onSaveTaskConfigAction,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
}) {
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <TaskConfigForm
      runtimeAdapters={runtimeAdapters}
      defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
      isPending={isPending}
      initialValues={toTaskConfigInitialValues(item)}
      submitLabel={copy.saveTaskConfig}
      pendingLabel={copy.saving}
      onSubmitAction={(input) => onSaveTaskConfigAction(item.taskId, input)}
    />
  );
}

function getQueueSuggestedDuration(item: UnscheduledItem) {
  const value = (
    item.runtimeConfig as { suggestedDurationMinutes?: unknown } | null
  )?.suggestedDurationMinutes;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(15, Math.round(value / 15) * 15);
}

export function QueueCard({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isDragging,
  isPending,
  isExpanded,
  currentSchedule,
  onToggle,
  onMutatedAction,
  onSaveTaskConfigAction,
  onScheduleSlot,
  onDragStart,
  onDragEnd,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isDragging: boolean;
  isPending: boolean;
  isExpanded: boolean;
  currentSchedule?: ScheduleSlot[];
  onToggle: () => void;
  onMutatedAction: () => Promise<void>;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  onScheduleSlot?: (taskId: string, startAt: Date, endAt: Date) => void;
  onDragStart: (item: UnscheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const suggestedDurationMinutes = getQueueSuggestedDuration(item);
  const [showTimeslots, setShowTimeslots] = useState(false);

  return (
    <SurfaceCard
      as="div"
      variant="inset"
      className={cn(
        "rounded-2xl p-0",
        isDragging && "border-primary/40 bg-primary/5",
      )}
    >
      <div
        draggable={!isPending}
        aria-label={`Drag ${item.title} to the timeline`}
        onDragStart={(event) => onDragStart(item, event)}
        onDragEnd={onDragEnd}
        className={cn(
          "flex cursor-grab items-start gap-3 rounded-2xl px-4 py-3 active:cursor-grabbing",
          isPending && "cursor-not-allowed",
        )}
      >
        <div className="mt-0.5 rounded-xl border border-dashed border-border/70 bg-background/70 p-2 text-muted-foreground">
          <GripVertical className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <LocalizedLink
                href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                draggable={false}
                className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {item.title}
              </LocalizedLink>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={getPriorityTone(item.priority)}>
                  {item.priority}
                </StatusBadge>
                <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>
                  {item.runnabilitySummary}
                </StatusBadge>
                {item.dueAt ? (
                  <StatusBadge>
                    {copy.due} {formatDateTime(item.dueAt, locale)}
                  </StatusBadge>
                ) : null}
                {item.actionRequired ? (
                  <StatusBadge tone="warning">
                    {item.actionRequired}
                  </StatusBadge>
                ) : null}
                {suggestedDurationMinutes ? (
                  <StatusBadge>{suggestedDurationMinutes}m</StatusBadge>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPending ? copy.schedulingUpdating : copy.dragHint}
          </p>
          {suggestedDurationMinutes ? (
            <button
              type="button"
              onClick={() => setShowTimeslots((v) => !v)}
              className={cn(
                "mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition",
                showTimeslots
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-primary",
              )}
            >
              <Calendar className="size-3" />
              {showTimeslots ? "Hide Suggestions" : "Suggest Time"}
            </button>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-4">
          <DetailGrid
            items={[
              { label: copy.due, value: formatDateTime(item.dueAt, locale) },
              {
                label: copy.pendingProposals,
                value: String(item.scheduleProposalCount),
              },
              { label: copy.runnable, value: item.runnabilitySummary },
              { label: copy.model, value: item.runtimeModel ?? "-" },
              {
                label: copy.latestRun,
                value: item.latestRunStatus ?? copy.noActiveRun,
              },
            ]}
          />

          <SurfaceCard
            as="div"
            variant="default"
            padding="sm"
            className="rounded-2xl border-dashed"
          >
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {copy.taskConfig}
            </p>
            <QueueTaskConfigEditor
              item={item}
              runtimeAdapters={runtimeAdapters}
              defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
              isPending={isPending}
              onSaveTaskConfigAction={onSaveTaskConfigAction}
            />
          </SurfaceCard>

          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />

          {showTimeslots && suggestedDurationMinutes ? (
            <TimeslotSuggestionPanel
              taskId={item.taskId}
              title={item.title}
              priority={item.priority}
              estimatedMinutes={suggestedDurationMinutes}
              dueAt={item.dueAt}
              currentSchedule={currentSchedule ?? []}
              onSchedule={(startAt, endAt) =>
                onScheduleSlot?.(item.taskId, startAt, endAt)
              }
            />
          ) : null}

          <SurfaceCard
            as="div"
            variant="default"
            padding="sm"
            className="rounded-2xl border-dashed"
          >
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {copy.placeOnTimeline}
            </p>
            <ScheduleEditorForm
              taskId={item.taskId}
              dueAt={item.dueAt}
              allowClear={false}
              submitLabel={copy.scheduleTask}
              onMutatedAction={onMutatedAction}
            />
          </SurfaceCard>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

export function ProposalCard({
  proposal,
  isPending,
  onAccept,
  onReject,
}: {
  proposal: ScheduleProposal;
  isPending: boolean;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <SurfaceCard as="div" variant="inset" className="rounded-2xl">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <LocalizedLink
            href={`/workspaces/${proposal.workspaceId}/tasks/${proposal.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {proposal.title}
          </LocalizedLink>
          <ItemMeta item={proposal} />
        </div>
        <p>{proposal.summary}</p>
        <DetailGrid
          items={[
            { label: copy.proposedBy, value: proposal.proposedBy },
            {
              label: copy.candidateBlock,
              value: `${formatDateTime(proposal.scheduledStartAt, locale)} → ${formatDateTime(proposal.scheduledEndAt, locale)}`,
            },
            {
              label: copy.dueImpact,
              value: formatDateTime(proposal.dueAt, locale),
            },
            { label: copy.source, value: proposal.source },
          ]}
        />
        <TaskContextLinks
          workspaceId={proposal.workspaceId}
          taskId={proposal.taskId}
          workLabel={t("common.openWorkbench")}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void onAccept(proposal.proposalId);
            }}
            className={buttonVariants({ variant: "default" })}
          >
            {copy.acceptProposal}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void onReject(proposal.proposalId);
            }}
            className={buttonVariants({ variant: "outline" })}
          >
            {copy.rejectProposal}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function RiskCard({ item }: { item: ScheduledItem }) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <SurfaceCard as="div" variant="inset" className="rounded-2xl">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <LocalizedLink
            href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {item.title}
          </LocalizedLink>
          <ItemMeta item={item} />
        </div>
        <DetailGrid
          items={[
            {
              label: copy.risk,
              value:
                item.scheduleStatus ?? item.persistedStatus ?? copy.needsReview,
            },
            {
              label: copy.action,
              value: item.actionRequired ?? copy.reviewScheduleImpact,
            },
            {
              label: copy.plannedWindow,
              value: `${formatDateTime(item.scheduledStartAt, locale)} → ${formatDateTime(item.scheduledEndAt, locale)}`,
            },
            { label: copy.due, value: formatDateTime(item.dueAt, locale) },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />
          <LocalizedLink
            href="/inbox"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {copy.openInbox}
          </LocalizedLink>
        </div>
      </div>
    </SurfaceCard>
  );
}
