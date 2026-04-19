"use client";

import { useMemo, useState } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

export type ScheduleTaskListItem = {
  taskId: string;
  workspaceId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
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
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  isRunnable: boolean;
  runnabilityState: string;
  runnabilitySummary: string;
};

type ScheduleTaskListProps = {
  items: ScheduleTaskListItem[];
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
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

function describeOwner(ownerType: string, assigneeAgentId: string | null, copy: { agentAssigned: string; agentPrefix: string; humanOwned: string }) {
  if (ownerType === "agent") {
    return assigneeAgentId ? `${copy.agentPrefix} · ${assigneeAgentId}` : copy.agentAssigned;
  }

  return copy.humanOwned;
}

function getPriorityTone(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "critical" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    default:
      return "success" as const;
  }
}

function getScheduleTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "overdue":
    case "blocked":
      return "critical" as const;
    case "atrisk":
    case "at risk":
      return "warning" as const;
    case "scheduled":
    case "inprogress":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

function getRunTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "completed":
      return "success" as const;
    case "waitingforapproval":
    case "waitingforinput":
      return "warning" as const;
    case "failed":
    case "cancelled":
      return "critical" as const;
    default:
      return "info" as const;
  }
}

function getRunnabilityTone(isRunnable: boolean) {
  return isRunnable ? ("success" as const) : ("warning" as const);
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
    runtimeAdapterKey: item.runtimeAdapterKey,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion,
    runtimeModel: item.runtimeModel,
    prompt: item.prompt,
    dueAt: item.dueAt,
    runtimeConfig: item.runtimeConfig,
  };
}

export function ScheduleTaskList({
  items,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
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
    agentAssigned: t("components.scheduleTaskList.agentAssigned"),
    agentPrefix: t("components.scheduleTaskList.agentPrefix"),
    humanOwned: t("components.scheduleTaskList.humanOwned"),
    noSchedule: t("components.scheduleTaskList.noSchedule"),
    noDescription: t("components.scheduleTaskList.noDescription"),
    state: t("components.scheduleTaskList.state"),
    owner: t("components.scheduleTaskList.owner"),
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
    <SurfaceCard variant="highlight" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SurfaceCardHeader>
          <SurfaceCardTitle>{copy.title}</SurfaceCardTitle>
          <SurfaceCardDescription>{copy.description}</SurfaceCardDescription>
        </SurfaceCardHeader>
        <StatusBadge tone="info">{copy.triageBadge}</StatusBadge>
      </div>

      <div className="flex flex-wrap gap-2">
        {listFilters.map((filter) => {
          const isActive = filter.key === activeFilter;

          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={cn(buttonVariants({ variant: isActive ? "secondary" : "outline", size: "sm" }), "gap-2")}
            >
              <span>{filter.label}</span>
              <StatusBadge tone={isActive ? "info" : "neutral"}>{counts[filter.key]}</StatusBadge>
            </button>
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
              <SurfaceCard key={item.taskId} variant="inset" padding="sm" className="rounded-2xl border border-border/70">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <LocalizedLink
                          href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                          className="text-base font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          {item.title}
                        </LocalizedLink>
                        <StatusBadge tone={getPriorityTone(item.priority)}>{item.priority}</StatusBadge>
                        <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>{item.runnabilitySummary}</StatusBadge>
                        <StatusBadge tone={getScheduleTone(item.scheduleStatus)}>
                          {item.scheduleStatus ?? copy.noSchedule}
                        </StatusBadge>
                        {item.latestRunStatus ? (
                          <StatusBadge tone={getRunTone(item.latestRunStatus)}>
                            {copy.runPrefix}: {item.latestRunStatus}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.description ?? copy.noDescription}
                      </p>
                    </div>

                    <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                        <dt className="text-xs uppercase tracking-[0.16em]">{copy.state}</dt>
                        <dd className="mt-1 text-foreground">{item.displayState ?? item.persistedStatus}</dd>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                        <dt className="text-xs uppercase tracking-[0.16em]">{copy.owner}</dt>
                        <dd className="mt-1 text-foreground">{describeOwner(item.ownerType, item.assigneeAgentId, copy)}</dd>
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
                      {item.actionRequired ? <StatusBadge tone="warning">{item.actionRequired}</StatusBadge> : null}
                      {item.approvalPendingCount > 0 ? (
                        <StatusBadge tone="warning">{copy.approvals}: {item.approvalPendingCount}</StatusBadge>
                      ) : null}
                      {item.scheduleProposalCount > 0 ? (
                        <StatusBadge tone="info">{copy.proposals}: {item.scheduleProposalCount}</StatusBadge>
                      ) : null}
                      <StatusBadge>{item.runtimeModel ?? item.runtimeAdapterKey ?? copy.noModel}</StatusBadge>
                    </div>
                  </div>

                  <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto lg:min-w-[220px]">
                    <TaskContextLinks workspaceId={item.workspaceId} taskId={item.taskId} latestRunStatus={item.latestRunStatus} />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setExpandedTaskId(isExpanded ? null : item.taskId)}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {isExpanded ? copy.closeQuickEdit : copy.quickEdit}
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 rounded-2xl border border-border/60 bg-background/75 p-4">
                    <TaskConfigForm
                      runtimeAdapters={runtimeAdapters}
                      defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                      initialValues={toTaskConfigInitialValues(item)}
                      isPending={isPending}
                      submitLabel={copy.saveTaskConfig}
                      pendingLabel={copy.saving}
                      onSubmitAction={async (input) => {
                        await onSaveTaskConfigAction(item.taskId, input);
                        setExpandedTaskId(null);
                      }}
                    />
                  </div>
                ) : null}
              </SurfaceCard>
            );
          })
        )}
      </div>
    </SurfaceCard>
  );
}
