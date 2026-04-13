import { StatusBadge } from "@/components/ui/status-badge";

import { formatDateTime } from "./work-page-formatters";
import type { WorkPageData, WorkbenchCopy } from "./work-page-types";

type TaskBriefCardProps = {
  taskShell: WorkPageData["taskShell"];
  scheduleImpact: WorkPageData["scheduleImpact"];
  copy: WorkbenchCopy;
};

function buildPlannedWindow(
  taskShell: WorkPageData["taskShell"],
  scheduleImpact: WorkPageData["scheduleImpact"],
  copy: WorkbenchCopy,
) {
  const start = scheduleImpact.scheduledStartAt ?? taskShell.scheduledStartAt;
  const end = scheduleImpact.scheduledEndAt ?? taskShell.scheduledEndAt;

  if (!start || !end) {
    return copy.noScheduleWindow;
  }

  return `${formatDateTime(start)} → ${formatDateTime(end)}`;
}

export function TaskBriefCard({ taskShell, scheduleImpact, copy }: TaskBriefCardProps) {
  const plannedWindow = buildPlannedWindow(taskShell, scheduleImpact, copy);

  return (
    <section className="rounded-[26px] border border-border/80 bg-card p-4 shadow-[0_18px_44px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge>{copy.currentTask}</StatusBadge>
        <StatusBadge>{taskShell.priority}</StatusBadge>
        <StatusBadge>{scheduleImpact.status}</StatusBadge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.85fr)] lg:items-start">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/[0.85]">
            {copy.taskContext}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[2rem]">
            {taskShell.title}
          </h1>
          {taskShell.prompt ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {taskShell.prompt}
            </p>
          ) : null}
        </div>

        <dl className="grid gap-3 rounded-[22px] border border-border/70 bg-muted/[0.24] p-4 text-sm shadow-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/[0.9]">
              {copy.plannedWindow}
            </dt>
            <dd className="mt-1.5 font-medium text-foreground">{plannedWindow}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/[0.9]">
              {copy.deadline}
            </dt>
            <dd className="mt-1.5 text-foreground">{formatDateTime(taskShell.dueAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/[0.9]">
              {copy.scheduleStatusLabel}
            </dt>
            <dd className="mt-1.5 text-foreground">{scheduleImpact.summary}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
