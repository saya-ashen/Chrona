"use client";

import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type TaskShellProps = {
  title: string;
  summary: string;
  taskStatus: { label: string; tone: "neutral" | "info" | "success" | "warning" | "critical" };
  runLabel: string;
  scheduleLabel: string;
  blockerSummary: string;
  sourceSummary: string;
  dueLabel: string;
  taskId: string;
  workspaceId: string;
  statusMeta?: ReactNode;
  labels: {
    ariaLabel: string;
    breadcrumbRoot: string;
    breadcrumbCurrent: string;
    taskList: string;
    inbox: string;
    memory: string;
    openSchedule: string;
    viewTaskDetail: string;
    currentBlocker: string;
    plannedWindow: string;
    deadline: string;
  };
};

export function TaskShell({
  title,
  summary,
  taskStatus,
  runLabel,
  scheduleLabel,
  blockerSummary,
  sourceSummary,
  dueLabel,
  taskId,
  workspaceId,
  statusMeta,
  labels,
}: TaskShellProps) {
  return (
    <section aria-label={labels.ariaLabel} className="rounded-[28px] border bg-card px-5 py-4 shadow-sm sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <LocalizedLink
              href="/schedule"
              className="font-medium text-foreground hover:underline"
            >
              {labels.breadcrumbRoot}
            </LocalizedLink>
            <span>/</span>
            <span className="truncate">{title}</span>
            <span>/</span>
            <span className="font-medium text-foreground">{labels.breadcrumbCurrent}</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{summary}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={taskStatus.tone}>{taskStatus.label}</StatusBadge>
            <StatusBadge>{runLabel}</StatusBadge>
            <StatusBadge>{scheduleLabel}</StatusBadge>
            {statusMeta}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LocalizedLink
            href="/tasks"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {labels.taskList}
          </LocalizedLink>
          <LocalizedLink
            href="/inbox"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {labels.inbox}
          </LocalizedLink>
          <LocalizedLink
            href="/memory"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {labels.memory}
          </LocalizedLink>
          <LocalizedLink
            href="/schedule"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {labels.openSchedule}
          </LocalizedLink>
          <LocalizedLink
            href={`/workspaces/${workspaceId}/tasks/${taskId}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {labels.viewTaskDetail}
          </LocalizedLink>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="rounded-[22px] border border-border/60 bg-background/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {labels.currentBlocker}
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{blockerSummary}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-border/60 bg-background/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {labels.plannedWindow}
            </p>
            <p className="mt-2 text-sm text-foreground">{sourceSummary}</p>
          </div>
          <div className="rounded-[22px] border border-border/60 bg-background/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {labels.deadline}
            </p>
            <p className="mt-2 text-sm text-foreground">{dueLabel}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
