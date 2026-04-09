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

function groupScheduledByDay(items: SchedulePageProps["data"]["scheduled"]) {
  const groups = new Map<string, { label: string; items: typeof items }>();

  for (const item of items) {
    const key = item.scheduledStartAt ? item.scheduledStartAt.toISOString().slice(0, 10) : "unspecified";
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      label: formatDayHeading(item.scheduledStartAt),
      items: [item],
    });
  }

  return [...groups.values()];
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

function TimelineCard({ item }: { item: SchedulePageProps["data"]["scheduled"][number] }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Link
              href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
              className="text-base font-medium text-foreground transition-colors hover:text-primary"
            >
              {item.title}
            </Link>
            <ItemMeta item={item} />
          </div>
          <div className="text-sm text-muted-foreground">
            <p>
              {formatDateTime(item.scheduledStartAt)} → {formatDateTime(item.scheduledEndAt)}
            </p>
            <p>Due {formatDateTime(item.dueAt)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <Link href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`} className="hover:text-primary">
            Open Task
          </Link>
          <Link href={`/workspaces/${item.workspaceId}/work/${item.taskId}`} className="hover:text-primary">
            Open Work
          </Link>
        </div>

        {item.actionRequired ? <p className="text-sm text-muted-foreground">Next: {item.actionRequired}</p> : null}

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
    </div>
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

export function SchedulePage({ data }: SchedulePageProps) {
  const scheduledGroups = groupScheduledByDay(data.scheduled);

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
                  The current plan, grouped by start day so you can adjust blocks without leaving the page.
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
                scheduledGroups.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        {group.items.length} block{group.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {group.items.map((item) => (
                        <TimelineCard key={item.taskId} item={item} />
                      ))}
                    </div>
                  </div>
                ))
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
    </div>
  );
}
