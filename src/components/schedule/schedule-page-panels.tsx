"use client";

import { Bot, Calendar, ChevronDown, GripVertical } from "lucide-react";
import { type DragEvent, useMemo, useState } from "react";
import { AutomationSuggestionPanel } from "@/components/schedule/automation-suggestion-panel";
import { PreparationChecklist, type PreparationStep } from "@/components/schedule/preparation-checklist";
import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
import { TimeslotSuggestionPanel } from "@/components/schedule/timeslot-suggestion-panel";
import { useSmartAutomation } from "@/hooks/use-ai";
import type { ScheduleSlot } from "@/modules/ai/types";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import {
  getSchedulePageCopy,
  type SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";
import type {
  ScheduleCardItem,
  ScheduleProposal,
  ScheduledItem,
  TodayFocusItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  describeOwner,
  formatDateTime,
  formatShortDay,
  formatTime,
  formatTimeRange,
  getPriorityTone,
  getRunTone,
  getRunnabilityTone,
  getScheduleTone,
  toTaskConfigInitialValues,
} from "@/components/schedule/schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

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
            <LocalizedLink
              key={item.taskId}
              href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1.5 text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <StatusBadge tone={item.tone}>{item.reason}</StatusBadge>
              <span className="max-w-[18rem] truncate">{item.title}</span>
            </LocalizedLink>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

export function ItemMeta({ item }: { item: ScheduleCardItem }) {
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone={getPriorityTone(item.priority)}>
        {item.priority}
      </StatusBadge>
      <StatusBadge>
        {describeOwner(item.ownerType, item.assigneeAgentId, copy)}
      </StatusBadge>
      {item.runnabilitySummary ? (
        <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>
          {item.runnabilitySummary}
        </StatusBadge>
      ) : null}
      {item.scheduleStatus ? (
        <StatusBadge tone={getScheduleTone(item.scheduleStatus)}>
          {copy.planPrefix}: {item.scheduleStatus}
        </StatusBadge>
      ) : null}
      {item.latestRunStatus ? (
        <StatusBadge tone={getRunTone(item.latestRunStatus)}>
          {copy.runPrefix}: {item.latestRunStatus}
        </StatusBadge>
      ) : null}
      {item.approvalPendingCount ? (
        <StatusBadge tone="warning">
          {copy.approvalsPrefix}: {item.approvalPendingCount}
        </StatusBadge>
      ) : null}
    </div>
  );
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string | null | undefined }>;
}) {
  return (
    <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2"
        >
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm text-foreground">{item.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function DayTimelineSummary({
  items,
  dayDate,
}: {
  items: ScheduledItem[];
  dayDate: Date;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const starts = items
    .map((item) => item.scheduledStartAt?.getTime())
    .filter((value): value is number => value !== undefined);
  const ends = items
    .map((item) => item.scheduledEndAt?.getTime())
    .filter((value): value is number => value !== undefined);

  if (starts.length === 0 || ends.length === 0) {
    return (
      <span>
        {formatShortDay(dayDate, locale, copy)} {copy.dayOpenSuffix}
      </span>
    );
  }

  const earliest = new Date(Math.min(...starts));
  const latest = new Date(Math.max(...ends));

  return (
    <span>
      {formatTime(earliest, locale)} → {formatTime(latest, locale)}
    </span>
  );
}

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

  return (
    <>
      <LocalizedLink
        href={buildScheduleHref(selectedDay)}
        aria-label={copy.closeTaskDetails}
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-3xl border border-border/70 bg-background p-5 shadow-2xl md:inset-y-4 md:right-4 md:left-auto md:w-[min(520px,92vw)] md:max-h-none md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <h2
              id="schedule-task-sheet-title"
              className="text-sm font-semibold text-foreground"
            >
              {copy.taskDetails}
            </h2>
            <p className="text-sm text-muted-foreground">
              {copy.taskDetailsDescription}
            </p>
          </div>
          <LocalizedLink
            href={buildScheduleHref(selectedDay)}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {copy.close}
          </LocalizedLink>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1 text-sm text-muted-foreground md:max-h-[calc(100vh-9rem)]">
          <div className="space-y-2">
            <p className="text-base font-medium text-foreground">{item.title}</p>
            <p>
              {formatTimeRange(
                item.scheduledStartAt,
                item.scheduledEndAt,
                locale,
                copy,
              )}
            </p>
            <ItemMeta item={item} />
          </div>

          <DetailGrid
            items={[
              { label: copy.due, value: formatDateTime(item.dueAt, locale) },
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

          <AutomationSuggestionForItem item={item} />

          <TaskDecompositionPanel
            taskId={item.taskId}
            title={item.title}
            description={item.description}
            priority={item.priority}
            dueAt={item.dueAt}
            onApply={async () => {
              // Call batch-decompose API to persist subtasks in DB
              try {
                const res = await fetch("/api/ai/batch-decompose", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ taskId: item.taskId }),
                });
                if (!res.ok) throw new Error("Batch decompose failed");
                // Refresh parent data
                await onMutatedAction();
              } catch (err) {
                console.error("[TaskDecomposition] Failed to apply:", err);
              }
            }}
          />

          <SurfaceCard
            as="div"
            variant="inset"
            padding="sm"
            className="rounded-2xl border-dashed"
          >
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {copy.taskConfig}
            </p>
            <TaskConfigForm
              runtimeAdapters={runtimeAdapters}
              defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
              isPending={isPending}
              initialValues={toTaskConfigInitialValues(item)}
              submitLabel={copy.saveTaskConfig}
              pendingLabel={copy.saving}
              onSubmitAction={(input) => onSaveTaskConfigAction(item.taskId, input)}
            />
          </SurfaceCard>

          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />

          <SurfaceCard
            as="div"
            variant="inset"
            padding="sm"
            className="rounded-2xl border-dashed"
          >
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {copy.adjustBlock}
            </p>
            <ScheduleEditorForm
              taskId={item.taskId}
              dueAt={item.dueAt}
              scheduledStartAt={item.scheduledStartAt}
              scheduledEndAt={item.scheduledEndAt}
              submitLabel={copy.scheduleTask}
              onMutatedAction={onMutatedAction}
            />
          </SurfaceCard>
        </div>
      </section>
    </>
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
  const value = (item.runtimeConfig as { suggestedDurationMinutes?: unknown } | null)
    ?.suggestedDurationMinutes;

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
                  <StatusBadge tone="warning">{item.actionRequired}</StatusBadge>
                ) : null}
                {suggestedDurationMinutes ? (
                  <StatusBadge>
                    {suggestedDurationMinutes}m
                  </StatusBadge>
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
              value: item.scheduleStatus ?? item.persistedStatus ?? copy.needsReview,
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

function AutomationSuggestionForItem({ item }: { item: ScheduledItem }) {
  const [requested, setRequested] = useState(false);

  const { suggestion, isLoading } = useSmartAutomation(
    requested
      ? {
          title: item.title,
          description: item.description ?? undefined,
          priority: item.priority,
          dueAt: item.dueAt,
          scheduledStartAt: item.scheduledStartAt,
          scheduledEndAt: item.scheduledEndAt,
          isRunnable: item.isRunnable,
          runnabilityState: item.runnabilityState,
          ownerType: item.ownerType,
        }
      : null,
  );

  const preparationSteps: PreparationStep[] = useMemo(() => {
    if (!suggestion) return [];
    return suggestion.preparationSteps.map((step, index) => ({
      id: `${item.taskId}-prep-${index}`,
      text: step,
      completed: false,
    }));
  }, [suggestion, item.taskId]);

  return (
    <div className="space-y-3">
      {!requested && !suggestion ? (
        <button
          type="button"
          onClick={() => setRequested(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <Bot className="size-4" />
          <span>AI 自动化建议</span>
        </button>
      ) : (
        <>
          <AutomationSuggestionPanel suggestion={suggestion} isLoading={isLoading} />
          {preparationSteps.length > 0 ? (
            <PreparationChecklist steps={preparationSteps} />
          ) : null}
        </>
      )}
    </div>
  );
}
