import Link from "next/link";
import { acceptScheduleProposal, rejectScheduleProposal } from "@/app/actions/task-actions";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";

type SchedulePageProps = {
  data: {
    summary: {
      scheduledCount: number;
      unscheduledCount: number;
      proposalCount: number;
      riskCount: number;
    };
    scheduled: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
      ownerType: string;
      assigneeAgentId: string | null;
      persistedStatus: string;
      actionRequired: string | null;
      approvalPendingCount: number;
      scheduleStatus: string | null;
      scheduleSource: string | null;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
      latestRunStatus: string | null;
    }>;
    unscheduled: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
      ownerType: string;
      assigneeAgentId: string | null;
      persistedStatus: string;
      actionRequired: string | null;
      approvalPendingCount: number;
      dueAt: Date | null;
      latestRunStatus: string | null;
      scheduleProposalCount: number;
    }>;
    proposals: Array<{
      proposalId: string;
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
      ownerType: string;
      assigneeAgentId: string | null;
      source: string;
      proposedBy: string;
      summary: string;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
    }>;
    risks: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
      ownerType: string;
      assigneeAgentId: string | null;
      persistedStatus: string;
      scheduleStatus: string | null;
      actionRequired: string | null;
      approvalPendingCount: number;
      latestRunStatus: string | null;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
    }>;
  };
};

type ScheduleCardItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  persistedStatus?: string;
  scheduleStatus?: string | null;
  scheduleSource?: string | null;
  actionRequired?: string | null;
  approvalPendingCount?: number;
  latestRunStatus?: string | null;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
};

type ScheduledItem = SchedulePageProps["data"]["scheduled"][number];

type ScheduledDayGroup = {
  key: string;
  label: string;
  items: ScheduledItem[];
  proposalCount: number;
  riskCount: number;
};

type CompressedTimelineHour = {
  hour: number;
  startMinute: number;
  endMinute: number;
  visualStart: number;
  visualHeight: number;
  active: boolean;
};

function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatTime(value: Date | null | undefined) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDayHeading(value: Date | null | undefined) {
  if (!value) {
    return "No scheduled start";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

function describeOwner(ownerType: string, assigneeAgentId: string | null) {
  if (ownerType === "agent") {
    return assigneeAgentId ? `Agent · ${assigneeAgentId}` : "Agent-assigned";
  }

  return "Human-owned";
}

function formatTimeRange(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start && !end) {
    return "Time not set";
  }

  return `${formatTime(start)} → ${formatTime(end)}`;
}

function getPriorityAccent(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-amber-500";
    case "medium":
      return "bg-sky-500";
    default:
      return "bg-emerald-500";
  }
}

function getDayKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "unspecified";
}

function formatShortDay(value: Date | null | undefined) {
  if (!value) {
    return "Unscheduled";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
  }).format(value);
}

function formatDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function getTodayKey() {
  return formatDateKey(startOfDay(new Date()));
}

function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function buildCompressedTimeline(items: ScheduledItem[]) {
  const activeHourHeight = 72;
  const idleHourHeight = 22;
  const dayStartMinute = 0;
  const dayEndMinute = 24 * 60;
  const hourActivity = Array.from({ length: 24 }, () => false);

  for (const item of items) {
    const start = item.scheduledStartAt ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes() : null;
    const end = item.scheduledEndAt ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes() : null;

    if (start === null) {
      continue;
    }

    const safeEnd = Math.max(end ?? start + 60, start + 45);
    const firstHour = Math.floor(start / 60);
    const lastHour = Math.min(23, Math.floor((safeEnd - 1) / 60));

    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      hourActivity[hour] = true;
    }
  }

  const hours: CompressedTimelineHour[] = [];
  let visualCursor = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const visualHeight = hourActivity[hour] ? activeHourHeight : idleHourHeight;
    hours.push({
      hour,
      startMinute: hour * 60,
      endMinute: (hour + 1) * 60,
      visualStart: visualCursor,
      visualHeight,
      active: hourActivity[hour],
    });
    visualCursor += visualHeight;
  }

  const compressedGapCount = hourActivity.filter((active) => !active).length;
  const visualMinutes = visualCursor / activeHourHeight * 60;

  function mapMinuteToY(minute: number) {
    const safeMinute = Math.min(Math.max(minute, dayStartMinute), dayEndMinute);
    if (safeMinute === dayEndMinute) {
      return visualCursor;
    }

    const hourIndex = Math.min(23, Math.floor(safeMinute / 60));
    const hour = hours[hourIndex];
    const minuteWithinHour = safeMinute - hour.startMinute;
    return hour.visualStart + (minuteWithinHour / 60) * hour.visualHeight;
  }

  return {
    hours,
    totalVisualHeight: Math.max(visualCursor, 320),
    compressedGapCount,
    visualMinutes,
    mapMinuteToY,
  };
}

function groupScheduledByDay(
  items: SchedulePageProps["data"]["scheduled"],
  proposals: SchedulePageProps["data"]["proposals"],
  risks: SchedulePageProps["data"]["risks"],
) {
  const proposalCounts = new Map<string, number>();
  const riskCounts = new Map<string, number>();
  const groups = new Map<string, ScheduledDayGroup>();

  for (const proposal of proposals) {
    const key = getDayKey(proposal.scheduledStartAt);
    proposalCounts.set(key, (proposalCounts.get(key) ?? 0) + 1);
  }

  for (const risk of risks) {
    const key = getDayKey(risk.scheduledStartAt);
    riskCounts.set(key, (riskCounts.get(key) ?? 0) + 1);
  }

  for (const item of items) {
    const key = getDayKey(item.scheduledStartAt);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      label: formatDayHeading(item.scheduledStartAt),
      items: [item],
      proposalCount: proposalCounts.get(key) ?? 0,
      riskCount: riskCounts.get(key) ?? 0,
    });
  }

  return [...groups.values()]
    .map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function ItemMeta({ item }: { item: ScheduleCardItem }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span className="rounded-full border px-2 py-1">{item.priority}</span>
      <span className="rounded-full border px-2 py-1">{describeOwner(item.ownerType, item.assigneeAgentId)}</span>
      {item.persistedStatus ? <span className="rounded-full border px-2 py-1">Status: {item.persistedStatus}</span> : null}
      {item.scheduleStatus ? <span className="rounded-full border px-2 py-1">Plan: {item.scheduleStatus}</span> : null}
      {item.scheduleSource ? <span className="rounded-full border px-2 py-1">Source: {item.scheduleSource}</span> : null}
      {item.latestRunStatus ? <span className="rounded-full border px-2 py-1">Run: {item.latestRunStatus}</span> : null}
      {item.approvalPendingCount ? (
        <span className="rounded-full border px-2 py-1">Approvals: {item.approvalPendingCount}</span>
      ) : null}
    </div>
  );
}

function DayTimelineSummary({ items }: { items: SchedulePageProps["data"]["scheduled"] }) {
  const starts = items.map((item) => item.scheduledStartAt?.getTime()).filter((value): value is number => value !== undefined);
  const ends = items.map((item) => item.scheduledEndAt?.getTime()).filter((value): value is number => value !== undefined);

  if (starts.length === 0 || ends.length === 0) {
    return <span>Time range pending</span>;
  }

  const earliest = new Date(Math.min(...starts));
  const latest = new Date(Math.max(...ends));

  return <span>{formatTime(earliest)} → {formatTime(latest)}</span>;
}

function buildScheduleHref(day: string, taskId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  return `/schedule?${params.toString()}`;
}

function WeekStrip({ groups, selectedDay }: { groups: ScheduledDayGroup[]; selectedDay: string }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        {groups.map((group) => {
          const isActive = group.key === selectedDay;

          return (
            <Link
              key={group.key}
              href={buildScheduleHref(group.key)}
              className={`rounded-xl border px-3 py-3 transition-colors hover:border-primary/50 hover:bg-muted/60 ${
                isActive ? "border-primary bg-primary/5" : "bg-card"
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{formatShortDay(group.items[0]?.scheduledStartAt ?? null)}</p>
                  {group.riskCount > 0 ? <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-label="Risk day" /> : null}
                </div>
                <p className="text-xs text-muted-foreground">{group.label}</p>
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                  <span>{group.items.length} block{group.items.length === 1 ? "" : "s"}</span>
                  {group.proposalCount > 0 ? <span>{group.proposalCount} proposal{group.proposalCount === 1 ? "" : "s"}</span> : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DayTimeline({ items, selectedDay, selectedTaskId }: { items: ScheduledItem[]; selectedDay: string; selectedTaskId?: string }) {
  const compressedTimeline = buildCompressedTimeline(items);
  const timelineHeight = compressedTimeline.totalVisualHeight;

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{formatDayHeading(items[0]?.scheduledStartAt ?? null)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <DayTimelineSummary items={items} /> · {items.length} scheduled block{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <p>Full-day timeline · scroll inside</p>
          <p className="mt-1 normal-case tracking-normal">
            Timeline compressed: 24h shown as {formatDurationMinutes(Math.round(compressedTimeline.visualMinutes))}
            {compressedTimeline.compressedGapCount > 0 ? ` · ${compressedTimeline.compressedGapCount} quiet hours compressed` : ""}
          </p>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-y-auto rounded-xl border bg-card/30 pr-2">
        <div className="flex gap-3">
          <div className="sticky left-0 top-0 hidden w-16 shrink-0 self-start bg-background/95 py-2 sm:block">
            <div className="relative" style={{ height: `${timelineHeight}px` }}>
              {compressedTimeline.hours.map((hour) => (
                <div key={hour.hour} className="absolute left-0 right-0" style={{ top: `${hour.visualStart}px` }}>
                  <span className="-translate-y-1/2 text-xs text-muted-foreground">{formatTime(new Date(2026, 0, 1, hour.hour, 0))}</span>
                </div>
              ))}
              <div className="absolute left-0 right-0" style={{ top: `${timelineHeight}px` }}>
                <span className="-translate-y-1/2 text-xs text-muted-foreground">11:59 PM</span>
              </div>
            </div>
          </div>

          <div className="relative flex-1 rounded-xl border bg-card/50" style={{ height: `${timelineHeight}px` }}>
            {compressedTimeline.hours.map((hour) => (
              <div key={hour.hour} className="absolute inset-x-0" style={{ top: `${hour.visualStart}px`, height: `${hour.visualHeight}px` }}>
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
                {!hour.active ? <div className="absolute inset-x-3 inset-y-1 rounded-md bg-muted/35" /> : null}
              </div>
            ))}
            <div className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: `${timelineHeight}px` }} />

            {items.map((item) => {
              const accent = getPriorityAccent(item.priority);
              const start = item.scheduledStartAt ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes() : 0;
              const end = item.scheduledEndAt ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes() : start + 60;
              const safeEnd = Math.max(end, start + 45);
              const top = compressedTimeline.mapMinuteToY(start);
              const height = Math.max(compressedTimeline.mapMinuteToY(safeEnd) - top, 56);
              const isSelected = selectedTaskId === item.taskId;

              return (
                <Link
                  key={item.taskId}
                  href={buildScheduleHref(selectedDay, item.taskId)}
                  className={`absolute left-3 right-3 rounded-xl border bg-background/95 p-3 shadow-sm transition-colors hover:border-primary/50 ${
                    isSelected ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                  style={{ top: `${top}px`, minHeight: "56px", height: `${height}px` }}
                >
                  <div className="flex h-full gap-3 overflow-hidden">
                    <div className={`w-1 shrink-0 rounded-full ${accent}`} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
                        <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{item.priority}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatTimeRange(item.scheduledStartAt, item.scheduledEndAt)}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{describeOwner(item.ownerType, item.assigneeAgentId)}</p>
                      {item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
                        <div className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted-foreground">
                          {item.scheduleStatus === "Overdue" ? <span className="rounded-full border border-red-200 px-2 py-0.5 text-red-600">Overdue</span> : null}
                          {item.approvalPendingCount ? <span className="rounded-full border px-2 py-0.5">Approval pending</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedBlockSheet({ item, selectedDay }: { item: ScheduledItem; selectedDay: string }) {
  return (
    <>
      <Link
        href={buildScheduleHref(selectedDay)}
        aria-label="Close task details"
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-3xl border bg-background p-5 shadow-2xl md:inset-y-4 md:right-4 md:left-auto md:w-[min(520px,92vw)] md:max-h-none md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <h2 id="schedule-task-sheet-title" className="text-sm font-semibold text-foreground">Task Details</h2>
            <p className="text-sm text-muted-foreground">Review the selected block in a floating panel, then return to the timeline.</p>
          </div>
          <Link href={buildScheduleHref(selectedDay)} className="rounded-full border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted">
            Close
          </Link>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1 text-sm text-muted-foreground md:max-h-[calc(100vh-9rem)]">
          <div className="space-y-2">
            <p className="text-base font-medium text-foreground">{item.title}</p>
            <p>{formatTimeRange(item.scheduledStartAt, item.scheduledEndAt)}</p>
            <ItemMeta item={item} />
          </div>

          <div className="grid gap-1">
            <p>Due: {formatDateTime(item.dueAt)}</p>
            <p>Current plan: {item.scheduleStatus ?? "Scheduled"}</p>
            <p>Latest run: {item.latestRunStatus ?? "No active run"}</p>
            {item.actionRequired ? <p>Next action: {item.actionRequired}</p> : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`} className="hover:text-primary">
              Open Task
            </Link>
            <Link href={`/workspaces/${item.workspaceId}/work/${item.taskId}`} className="hover:text-primary">
              Open Work
            </Link>
          </div>

          <div className="rounded-xl border border-dashed p-3">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Adjust block</p>
            <ScheduleEditorForm
              taskId={item.taskId}
              dueAt={item.dueAt}
              scheduledStartAt={item.scheduledStartAt}
              scheduledEndAt={item.scheduledEndAt}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function QueueCard({ item }: { item: SchedulePageProps["data"]["unscheduled"][number] }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="space-y-3">
        <div className="space-y-2">
          <Link
            href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {item.title}
          </Link>
          <ItemMeta item={item} />
        </div>

        <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Due: {formatDateTime(item.dueAt)}</p>
          <p>Pending proposals: {item.scheduleProposalCount}</p>
          <p>Needs: {item.actionRequired ?? "A planned time block"}</p>
          <p>Latest run: {item.latestRunStatus ?? "No active run"}</p>
        </div>

        <div className="rounded-xl border border-dashed p-3">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Place on timeline</p>
          <ScheduleEditorForm taskId={item.taskId} dueAt={item.dueAt} allowClear={false} submitLabel="Schedule Task" />
        </div>
      </div>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: SchedulePageProps["data"]["proposals"][number] }) {
  return (
    <div key={proposal.proposalId} className="rounded-xl border bg-background p-4">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <Link
            href={`/workspaces/${proposal.workspaceId}/tasks/${proposal.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {proposal.title}
          </Link>
          <ItemMeta item={proposal} />
        </div>
        <p>{proposal.summary}</p>
        <div className="grid gap-1">
          <p>Proposed by: {proposal.proposedBy}</p>
          <p>
            Candidate block: {formatDateTime(proposal.scheduledStartAt)} → {formatDateTime(proposal.scheduledEndAt)}
          </p>
          <p>Due impact reference: {formatDateTime(proposal.dueAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form
            action={async () => {
              "use server";
              await acceptScheduleProposal(proposal.proposalId, "Accepted on schedule page");
            }}
          >
            <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Accept Proposal
            </button>
          </form>
          <Link href={`/workspaces/${proposal.workspaceId}/tasks/${proposal.taskId}`} className="rounded-md border px-3 py-2 text-sm text-foreground">
            Review Task
          </Link>
          <form
            action={async () => {
              "use server";
              await rejectScheduleProposal(proposal.proposalId, "Rejected on schedule page");
            }}
          >
            <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
              Reject Proposal
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RiskCard({ item }: { item: SchedulePageProps["data"]["risks"][number] }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <Link
            href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {item.title}
          </Link>
          <ItemMeta item={item} />
        </div>
        <div className="grid gap-1">
          <p>Risk: {item.scheduleStatus ?? item.persistedStatus}</p>
          <p>Action: {item.actionRequired ?? "Review schedule impact"}</p>
          <p>
            Planned window: {formatDateTime(item.scheduledStartAt)} → {formatDateTime(item.scheduledEndAt)}
          </p>
          <p>Due: {formatDateTime(item.dueAt)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/workspaces/${item.workspaceId}/work/${item.taskId}`} className="hover:text-primary">
            Open Work
          </Link>
          <Link href="/inbox" className="hover:text-primary">
            Open Inbox
          </Link>
          <Link href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`} className="hover:text-primary">
            Reschedule in Task
          </Link>
        </div>
      </div>
    </div>
  );
}

export function SchedulePage({
  data,
  selectedDay,
  selectedTaskId,
}: SchedulePageProps & { selectedDay?: string; selectedTaskId?: string }) {
  const scheduledGroups = groupScheduledByDay(data.scheduled, data.proposals, data.risks);
  const todayKey = getTodayKey();
  const fallbackDay = scheduledGroups.find((group) => group.key === todayKey)?.key ?? scheduledGroups[0]?.key;
  const activeDay = scheduledGroups.find((group) => group.key === selectedDay)?.key ?? fallbackDay;
  const activeGroup = scheduledGroups.find((group) => group.key === activeDay) ?? null;
  const selectedItem = activeGroup?.items.find((item) => item.taskId === selectedTaskId) ?? null;
  const tomorrowKey = formatDateKey(addDays(startOfDay(new Date()), 1));

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            Use this page as the global planning workbench for the default workspace: place unscheduled work,
            review AI suggestions, and resolve schedule risks before execution drifts.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={buildScheduleHref(todayKey)} className="rounded-full border px-3 py-2 text-foreground transition-colors hover:bg-muted">
            Today
          </Link>
          <Link href={buildScheduleHref(tomorrowKey)} className="rounded-full border px-3 py-2 text-foreground transition-colors hover:bg-muted">
            Tomorrow
          </Link>
          <Link
            href={buildScheduleHref(activeDay ?? todayKey)}
            className="rounded-full border px-3 py-2 text-foreground transition-colors hover:bg-muted"
          >
            This Week
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Scheduled" value={data.summary.scheduledCount} hint="Committed blocks on the current plan." />
          <MetricCard label="Queue" value={data.summary.unscheduledCount} hint="Tasks still waiting to enter the timeline." />
          <MetricCard label="AI Proposals" value={data.summary.proposalCount} hint="Pending suggestions that need a decision." />
          <MetricCard label="Risks" value={data.summary.riskCount} hint="At-risk, overdue, or interrupted work." />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Scheduled Timeline</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use the week strip to switch days, then inspect a single scheduled block without reopening the whole page.
                </p>
              </div>
              <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Default workspace
              </span>
            </div>

            <div className="mt-4 space-y-4">
              {scheduledGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4 text-sm text-muted-foreground">
                  No scheduled blocks yet. Start from the queue below and place the first task on the timeline.
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Week Overview</h3>
                    <WeekStrip groups={scheduledGroups} selectedDay={activeDay ?? todayKey} />
                  </div>
                  {activeGroup ? <DayTimeline items={activeGroup.items} selectedDay={activeGroup.key} selectedTaskId={selectedTaskId} /> : null}
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Unscheduled Queue</h2>
              <p className="text-sm text-muted-foreground">
                Tasks that still need a time block. Prioritize urgent work, then place it directly onto the plan.
              </p>
            </div>

            <div className="mt-4 space-y-4 text-sm text-muted-foreground">
              {data.unscheduled.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4">
                  No unscheduled work. New tasks that lose their plan or need initial placement will appear here.
                </div>
              ) : (
                data.unscheduled.map((item) => <QueueCard key={item.taskId} item={item} />)
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">AI Proposals</h2>
              <p className="text-sm text-muted-foreground">
                Review AI-generated suggestions as explicit planning decisions before they change the timeline.
              </p>
            </div>
            <div className="mt-4 space-y-4 text-sm text-muted-foreground">
              {data.proposals.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4">
                  No pending AI proposals. When planner automation suggests a new block, it will appear here for review.
                </div>
              ) : (
                data.proposals.map((proposal) => <ProposalCard key={proposal.proposalId} proposal={proposal} />)
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Conflicts / Overdue Risks</h2>
              <p className="text-sm text-muted-foreground">
                Exceptions that threaten the plan. Use these entries to jump straight into recovery or rescheduling.
              </p>
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              {data.risks.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4">
                  No schedule risks detected. Blocked, overdue, or interrupted work will surface here.
                </div>
              ) : (
                data.risks.map((item) => <RiskCard key={item.taskId} item={item} />)
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Planning Guide</h2>
              <p className="text-sm text-muted-foreground">
                Use Schedule for global arrangement, Task pages for single-task plan details, and Work pages for execution diagnosis.
              </p>
            </div>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p>1. Clear the highest-risk items first.</p>
              <p>2. Place unscheduled work into concrete time blocks.</p>
              <p>3. Review AI proposals as reversible diffs, not automatic truth.</p>
              <p>4. Jump to Inbox when approvals or inputs are what actually block the schedule.</p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/tasks" className="hover:text-primary">
                  Open Task Center
                </Link>
                <Link href="/inbox" className="hover:text-primary">
                  Open Inbox
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {selectedItem && activeDay ? <SelectedBlockSheet item={selectedItem} selectedDay={activeDay} /> : null}
    </div>
  );
}
