"use client";

import {
  Calendar,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import { type DragEvent, useCallback, useState } from "react";
import { TimeslotSuggestionPanel } from "@/components/schedule/timeslot-suggestion-panel";
import type { ScheduleSlot, TaskPlanGraphResponse, TaskPlanNode } from "@/modules/ai/types";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";

/**
 * Convert a TaskPlanGraphResponse into the plan shape that TaskPlanGraph component expects.
 */
function toPlanGraphPlan(res: TaskPlanGraphResponse | null) {
  if (!res?.planGraph?.nodes?.length) return null;
  const g = res.planGraph;
  const steps = g.nodes.map((n: TaskPlanNode) => ({
    id: n.id,
    title: n.title,
    objective: n.objective,
    phase: n.phase ?? n.type,
    status: (n.status === "skipped" ? "done" : n.status) as
      | "pending"
      | "in_progress"
      | "waiting_for_user"
      | "done"
      | "blocked",
    needsUserInput: n.needsUserInput || n.status === "waiting_for_user",
    type: n.type,
    linkedTaskId: n.linkedTaskId,
    executionMode: n.executionMode,
    estimatedMinutes: n.estimatedMinutes,
    priority: n.priority,
  }));
  const currentStepId =
    steps.find((s) => ["in_progress", "waiting_for_user", "blocked"].includes(s.status))?.id ?? null;
  return {
    state: "ready" as const,
    currentStepId,
    steps,
    edges: g.edges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      type: e.type,
    })),
  };
}
import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
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
  toTimestamp,
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

export function DetailGrid({
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

function CompactMetaPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "inline-flex min-w-[9rem] items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-xs",
        tone === "accent"
          ? "border-primary/20 bg-primary/[0.08] text-foreground"
          : "border-border/60 bg-background/80 text-foreground",
      )}
    >
      <span className="uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value ?? "-"}</span>
    </div>
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
    .map((item) => toTimestamp(item.scheduledStartAt))
    .filter((value): value is number => value !== null);
  const ends = items
    .map((item) => toTimestamp(item.scheduledEndAt))
    .filter((value): value is number => value !== null);

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

  // Accepted plan state — only shown on left after user confirms
  const [acceptedPlan, setAcceptedPlan] = useState<TaskPlanGraphResponse | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const handleAcceptedPlanLoaded = useCallback((saved: {
    id: string;
    status: "draft" | "accepted" | "superseded" | "archived";
    prompt: string | null;
    revision: number | null;
    summary: string | null;
    updatedAt: string;
    plan: TaskPlanGraphResponse["planGraph"] | null;
  } | null) => {
    if (saved?.status !== "accepted" || !saved.plan) {
      return;
    }

    setAcceptedPlan((current) => {
      if (
        current?.savedPlan?.id === saved.id
        && current.savedPlan?.status === saved.status
        && current.savedPlan?.revision === (saved.revision ?? 0)
        && current.savedPlan?.updatedAt === saved.updatedAt
      ) {
        return current;
      }

      return {
        source: "saved",
        planGraph: saved.plan,
        savedPlan: {
          id: saved.id,
          status: saved.status,
          prompt: saved.prompt,
          revision: saved.revision ?? 0,
          summary: saved.summary ?? null,
          updatedAt: saved.updatedAt,
        },
      };
    });
  }, []);

  const handleApplyPlan = async (result: TaskPlanGraphResponse) => {
    if (!result.savedPlan?.id) return;
    setIsApplying(true);
    try {
      const res = await fetch("/api/ai/task-plan/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: item.taskId,
          planId: result.savedPlan.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to accept plan");
      setAcceptedPlan({
        ...result,
        source: "saved",
        savedPlan: result.savedPlan
          ? {
              ...result.savedPlan,
              status: "accepted",
            }
          : result.savedPlan,
        planGraph: result.planGraph
          ? {
              ...result.planGraph,
              status: "accepted",
            }
          : result.planGraph,
      });
      await onMutatedAction();
    } catch (err) {
      console.error("[TaskPlan] Accept failed:", err);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <LocalizedLink
        href={buildScheduleHref(selectedDay)}
        aria-label={copy.closeTaskDetails}
        className="fixed inset-0 z-40 bg-slate-950/35"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] rounded-t-[2rem] border border-border/70 bg-background shadow-[0_-24px_80px_-32px_rgba(15,23,42,0.55)] md:inset-y-4 md:left-1/2 md:w-[min(1180px,calc(100vw-2rem))] md:max-h-none md:-translate-x-1/2 md:rounded-[2rem]"
      >
        <div className="flex max-h-[92vh] min-h-0 flex-col md:max-h-[calc(100vh-2rem)]">
          <div className="border-b border-border/70 bg-muted/[0.12] px-5 py-4 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.taskDetailsEyebrow}
                  </p>
                  <h2
                    id="schedule-task-sheet-title"
                    className="text-xl font-semibold tracking-tight text-foreground"
                  >
                    {item.title}
                  </h2>
                </div>
                <ItemMeta item={item} />
                <div className="flex flex-wrap gap-2">
                  <CompactMetaPill
                    label={copy.scheduledWindow}
                    value={formatTimeRange(
                      item.scheduledStartAt,
                      item.scheduledEndAt,
                      locale,
                      copy,
                    )}
                    tone="accent"
                  />
                  <CompactMetaPill
                    label={copy.due}
                    value={formatDateTime(item.dueAt, locale)}
                  />
                  <CompactMetaPill
                    label={copy.currentPlan}
                    value={item.scheduleStatus ?? copy.scheduledMetric}
                  />
                  <CompactMetaPill
                    label={copy.latestRun}
                    value={item.latestRunStatus ?? copy.noActiveRun}
                  />
                  <CompactMetaPill
                    label={copy.nextAction}
                    value={item.actionRequired ?? copy.stayOnPlan}
                  />
                  <CompactMetaPill
                    label={copy.taskPlanLabel}
                    value={acceptedPlan?.savedPlan?.revision
                      ? `Accepted · r${acceptedPlan.savedPlan.revision}`
                      : acceptedPlan?.savedPlan?.status === "accepted"
                        ? "Accepted"
                        : "No accepted plan"}
                    tone={acceptedPlan?.savedPlan?.status === "accepted" ? "accent" : "default"}
                  />
                </div>
              </div>
              <LocalizedLink
                href={buildScheduleHref(selectedDay)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {copy.close}
              </LocalizedLink>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_320px]">
            <div
              data-testid="selected-block-main-column"
              className="min-h-0 overflow-y-auto border-b border-border/60 px-5 py-5 text-sm text-muted-foreground md:border-b-0 md:border-r md:px-6"
            >
              <div className="space-y-5 pb-6">
                <SurfaceCard
                  as="div"
                  variant="inset"
                  padding="sm"
                  className="overflow-hidden rounded-[1.6rem] border-border/70 bg-background shadow-sm"
                >
                  <div className="space-y-5">
                    <div className="px-1">
                      <ScheduleEditorForm
                        taskId={item.taskId}
                        dueAt={item.dueAt}
                        scheduledStartAt={item.scheduledStartAt}
                        scheduledEndAt={item.scheduledEndAt}
                        submitLabel={copy.scheduleTask}
                        onMutatedAction={onMutatedAction}
                      />
                    </div>
                    <div className="border-t border-border/60 bg-muted/[0.12] px-1 pt-4">
                      <TaskConfigForm
                        runtimeAdapters={runtimeAdapters}
                        defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                        isPending={isPending}
                        initialValues={toTaskConfigInitialValues(item)}
                        submitLabel={copy.saveTaskConfig}
                        pendingLabel={copy.saving}
                        onSubmitAction={(input) =>
                          onSaveTaskConfigAction(item.taskId, input)
                        }
                      />
                    </div>
                  </div>
                </SurfaceCard>

                {/* Accepted Task Plan Graph — only shown after user confirms */}
                {(() => {
                  const plan = toPlanGraphPlan(acceptedPlan);
                  if (plan) {
                    return (
                      <SurfaceCard
                        as="div"
                        variant="inset"
                        padding="sm"
                        className="rounded-[1.5rem] border-border/70 bg-background shadow-sm"
                      >
                        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          {copy.taskPlanLabel}
                        </p>
                        <TaskPlanGraph plan={plan} />
                      </SurfaceCard>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            <aside
              data-testid="selected-block-ai-sidebar"
              className="min-h-0 overflow-y-auto bg-muted/10 px-5 py-5 md:px-5"
            >
              <div className="space-y-4 pb-6">
                <div className="rounded-[1rem] border border-border/60 bg-background/80 p-3 shadow-sm">
                  <TaskContextLinks
                    workspaceId={item.workspaceId}
                    taskId={item.taskId}
                    latestRunStatus={item.latestRunStatus}
                    workLabel={t("common.openWorkbench")}
                    className="w-full [&>a]:flex-1"
                  />
                </div>

                <TaskDecompositionPanel
                  taskId={item.taskId}
                  title={item.title}
                  description={item.description}
                  priority={item.priority}
                  dueAt={item.dueAt}
                  autoRequest
                  onPlanLoaded={handleAcceptedPlanLoaded}
                  onApply={handleApplyPlan}
                  activeAcceptedPlanId={acceptedPlan?.savedPlan?.id ?? null}
                />
              </div>
            </aside>
          </div>
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



