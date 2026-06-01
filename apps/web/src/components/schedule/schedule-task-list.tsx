"use client";

import { useMemo, useState } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigExecutionRuntime,
} from "@/components/schedule/forms/task-config-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";
import { useI18n, useLocale } from "@chrona/i18n/react";

export type ScheduleTaskListItem = {
  taskId: string;
  workspaceId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  priority: string;
  persistedStatus: string;
  displayState: string | null;
  actionRequired: string | null;
  approvalPendingCount: number;
  latestRunStatus: string | null;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  scheduleStatus: string | null;
  scheduleSource: string | null;
  scheduleProposalCount: number;
  lastActivityAt: Date | null;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: string;
  autoExecuteTiming: string;
  sourceManaged?: {
    source: "external_calendar";
    eventId: string;
    sourceName: string;
    sourceColor: string;
    description: string | null;
    immutableFields: readonly ["title", "scheduledStartAt", "scheduledEndAt"];
  } | null;
  executionRuntime: string;
  executionConfig: unknown;
  isRunnable: boolean;
  runnabilityState: string;
  runnabilitySummary: string;
};

type ScheduleTaskListProps = {
  items: ScheduleTaskListItem[];
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  isPending: boolean;
  onSaveTaskConfigAction: (taskId: string, input: TaskConfigFormInput) => Promise<void>;
};

type ListFilterKey =
  | "all"
  | "running"
  | "waitingForApproval"
  | "blocked"
  | "failed"
  | "unscheduled"
  | "overdue"
  | "notRunnable";

function formatDateTime(locale: string, value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function getPriorityTone(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "destructive" as const;
    case "high":
      return "secondary" as const;
    case "medium":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function getScheduleTone(status: string | null | undefined) {
  if (!status) {
    return "outline" as const;
  }

  switch (status.toLowerCase()) {
    case "overdue":
    case "blocked":
      return "destructive" as const;
    case "atrisk":
    case "at risk":
      return "secondary" as const;
    case "scheduled":
    case "inprogress":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function getRunTone(status: string | null | undefined) {
  if (!status) {
    return "outline" as const;
  }

  switch (status.toLowerCase()) {
    case "completed":
      return "secondary" as const;
    case "waitingforapproval":
    case "waitingforinput":
      return "secondary" as const;
    case "failed":
    case "cancelled":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function getRunnabilityTone(isRunnable: boolean) {
  return isRunnable ? ("secondary" as const) : ("destructive" as const);
}

function getTaskDisplayState(item: ScheduleTaskListItem) {
  if (item.displayState) {
    return item.displayState;
  }

  if (item.latestRunStatus) {
    return item.latestRunStatus;
  }

  if (item.scheduleStatus && item.scheduleStatus !== "Unscheduled") {
    return item.scheduleStatus;
  }

  if (item.isRunnable) {
    return item.runnabilitySummary;
  }

  return item.persistedStatus;
}

function matchesFilter(item: ScheduleTaskListItem, filter: ListFilterKey) {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return item.persistedStatus === "Running" || item.latestRunStatus === "Running" || item.latestRunStatus === "Pending";
    case "waitingForApproval":
      return item.latestRunStatus === "WaitingForApproval" || item.displayState === "WaitingForApproval";
    case "blocked":
      return (
        item.persistedStatus === "Blocked" &&
        item.latestRunStatus !== "WaitingForApproval" &&
        item.latestRunStatus !== "Failed"
      );
    case "failed":
      return item.latestRunStatus === "Failed";
    case "unscheduled":
      return item.scheduleStatus === "Unscheduled";
    case "overdue":
      return item.scheduleStatus === "Overdue";
    case "notRunnable":
      return !item.isRunnable;
  }
}

function toTaskConfigInitialValues(item: ScheduleTaskListItem) {
  return {
    title: item.title,
    description: item.description,
    priority: item.priority as TaskConfigFormInput["priority"],
    executionRuntime: item.executionRuntime,
    executionConfig: item.executionConfig,
    dueAt: item.dueAt,
    scheduledStartAt: item.scheduledStartAt,
    scheduledEndAt: item.scheduledEndAt,
    autoPlanGeneration: item.autoPlanGeneration,
    autoExecute: item.autoExecute,
    autoPlanGenerationTiming: item.autoPlanGenerationTiming,
    autoExecuteTiming: item.autoExecuteTiming,
  };
}

export function ScheduleTaskList({
  items,
  executionRuntimes,
  defaultExecutionRuntime,
  isPending,
  onSaveTaskConfigAction,
}: ScheduleTaskListProps) {
  const { t } = useI18n();
  const locale = useLocale();
  const [activeFilter, setActiveFilter] = useState<ListFilterKey>("all");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const copy = {
    title: t("components.scheduleTaskList.title"),
    description: t("components.scheduleTaskList.description"),
    triageBadge: t("components.scheduleTaskList.triageBadge"),
    showingPrefix: t("components.scheduleTaskList.showingPrefix"),
    showingSuffix: t("components.scheduleTaskList.showingSuffix"),
    noSchedule: t("components.scheduleTaskList.noSchedule"),
    noDescription: t("components.scheduleTaskList.noDescription"),
    state: t("components.scheduleTaskList.state"),
    due: t("components.scheduleTaskList.due"),
    scheduled: t("components.scheduleTaskList.scheduled"),
    notPlaced: t("components.scheduleTaskList.notPlaced"),
    runPrefix: t("components.scheduleTaskList.runPrefix"),
    approvals: t("components.scheduleTaskList.approvals"),
    proposals: t("components.scheduleTaskList.proposals"),
    noModel: t("components.scheduleTaskList.noModel"),
    closeQuickEdit: t("components.scheduleTaskList.closeQuickEdit"),
    quickEdit: t("components.scheduleTaskList.quickEdit"),
    saveTaskConfig: t("components.scheduleTaskList.saveTaskConfig"),
    saving: t("components.scheduleTaskList.saving"),
    calendarDescription: t("components.taskConfigForm.calendarDescription"),
    chronaNotesEmpty: t("components.taskConfigForm.chronaNotesEmpty"),
  };

  const listFilters: Array<{ key: ListFilterKey; label: string; emptyMessage: string }> = [
    { key: "all", label: t("components.scheduleTaskList.all"), emptyMessage: t("components.scheduleTaskList.emptyAll") },
    { key: "running", label: t("components.scheduleTaskList.running"), emptyMessage: t("components.scheduleTaskList.emptyRunning") },
    {
      key: "waitingForApproval",
      label: t("components.scheduleTaskList.waitingForApproval"),
      emptyMessage: t("components.scheduleTaskList.emptyWaitingForApproval"),
    },
    { key: "blocked", label: t("components.scheduleTaskList.blocked"), emptyMessage: t("components.scheduleTaskList.emptyBlocked") },
    { key: "failed", label: t("components.scheduleTaskList.failed"), emptyMessage: t("components.scheduleTaskList.emptyFailed") },
    {
      key: "unscheduled",
      label: t("components.scheduleTaskList.unscheduled"),
      emptyMessage: t("components.scheduleTaskList.emptyUnscheduled"),
    },
    { key: "overdue", label: t("components.scheduleTaskList.overdue"), emptyMessage: t("components.scheduleTaskList.emptyOverdue") },
    {
      key: "notRunnable",
      label: t("components.scheduleTaskList.notRunnable"),
      emptyMessage: t("components.scheduleTaskList.emptyNotRunnable"),
    },
  ];

  const counts = useMemo(
    () =>
      Object.fromEntries(
        listFilters.map((filter) => [filter.key, items.filter((item) => matchesFilter(item, filter.key)).length]),
      ) as Record<ListFilterKey, number>,
    [items, listFilters],
  );

  const activeFilterConfig = listFilters.find((filter) => filter.key === activeFilter) ?? listFilters[0];
  const filteredItems = useMemo(() => items.filter((item) => matchesFilter(item, activeFilter)), [activeFilter, items]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <Badge variant="secondary">{copy.triageBadge}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {listFilters.map((filter) => {
          const isActive = filter.key === activeFilter;

          return (
            <Button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              variant={isActive ? "secondary" : "outline"}
              size="sm"
              className="gap-2"
            >
              <span>{filter.label}</span>
              <Badge variant={isActive ? "secondary" : "outline"}>{counts[filter.key]}</Badge>
            </Button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        {copy.showingPrefix} <span className="font-medium text-foreground">{activeFilterConfig.label}</span> {copy.showingSuffix}
      </p>

      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
            {activeFilterConfig.emptyMessage}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedTaskId === item.taskId;

            return (
              <Card key={item.taskId} className="overflow-visible rounded-2xl border border-border/70">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <LocalizedLink
                          href={`/tasks/${item.taskId}`}
                          className="text-base font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          {item.title}
                        </LocalizedLink>
                        <Badge variant={getPriorityTone(item.priority)}>{item.priority}</Badge>
                        <Badge variant={getRunnabilityTone(item.isRunnable)}>{item.runnabilitySummary}</Badge>
                        <Badge variant={getScheduleTone(item.scheduleStatus)}>
                          {item.scheduleStatus ?? copy.noSchedule}
                        </Badge>
                        {item.latestRunStatus ? (
                          <Badge variant={getRunTone(item.latestRunStatus)}>
                            {copy.runPrefix}: {item.latestRunStatus}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.sourceManaged
                          ? item.description || item.sourceManaged.description || copy.chronaNotesEmpty
                          : item.description ?? copy.noDescription}
                      </p>
                    </div>

                    <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                        <dt className="text-xs uppercase tracking-[0.16em]">{copy.state}</dt>
                        <dd className="mt-1 text-foreground">{getTaskDisplayState(item)}</dd>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                        <dt className="text-xs uppercase tracking-[0.16em]">{copy.due}</dt>
                        <dd className="mt-1 text-foreground">{formatDateTime(locale, item.dueAt)}</dd>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                        <dt className="text-xs uppercase tracking-[0.16em]">{copy.scheduled}</dt>
                        <dd className="mt-1 text-foreground">
                          {item.scheduledStartAt
                            ? `${formatDateTime(locale, item.scheduledStartAt)} → ${formatDateTime(locale, item.scheduledEndAt)}`
                            : copy.notPlaced}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.actionRequired ? <Badge variant="secondary">{item.actionRequired}</Badge> : null}
                      {item.approvalPendingCount > 0 ? (
                        <Badge variant="secondary">{copy.approvals}: {item.approvalPendingCount}</Badge>
                      ) : null}
                      {item.scheduleProposalCount > 0 ? (
                        <Badge variant="secondary">{copy.proposals}: {item.scheduleProposalCount}</Badge>
                      ) : null}
                      <Badge>{item.executionRuntime || copy.noModel}</Badge>
                    </div>
                  </div>

                  <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto lg:min-w-[220px]">
                    <TaskContextLinks taskId={item.taskId} />
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => setExpandedTaskId(isExpanded ? null : item.taskId)}
                      variant="outline"
                      size="sm"
                    >
                      {isExpanded ? copy.closeQuickEdit : copy.quickEdit}
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 rounded-2xl border border-border/60 bg-background/75 p-4">
                      <TaskConfigForm
                      executionRuntimes={executionRuntimes}
                      defaultExecutionRuntime={defaultExecutionRuntime}
                      initialValues={toTaskConfigInitialValues(item)}
                      isPending={isPending}
                      lockedFields={item.sourceManaged?.immutableFields}
                      lockedFieldsHint={item.sourceManaged ? `Synced from ${item.sourceManaged.sourceName}. Title and time are managed by the calendar source.` : undefined}
                      sourceDescription={item.sourceManaged?.description ?? null}
                      sourceDescriptionLabel={item.sourceManaged ? `${copy.calendarDescription} · ${item.sourceManaged.sourceName}` : undefined}
                      submitLabel={copy.saveTaskConfig}
                      pendingLabel={copy.saving}
                      onSubmitAction={async (input) => {
                        await onSaveTaskConfigAction(item.taskId, input);
                        setExpandedTaskId(null);
                      }}
                    />
                  </div>
                ) : null}
              </Card>
            );
          })
        )}
      </div>
    </Card>
  );
}
