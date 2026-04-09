import Link from "next/link";
import { acceptScheduleProposal, rejectScheduleProposal } from "@/app/actions/task-actions";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";

type SchedulePageProps = {
  data: {
    scheduled: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
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
      persistedStatus: string;
      actionRequired: string | null;
      scheduleProposalCount: number;
    }>;
    proposals: Array<{
      proposalId: string;
      taskId: string;
      workspaceId: string;
      title: string;
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
      persistedStatus: string;
      scheduleStatus: string | null;
      actionRequired: string | null;
      dueAt: Date | null;
      scheduledEndAt: Date | null;
    }>;
  };
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "-";
}

export function SchedulePage({ data }: SchedulePageProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Plan when work happens, surface AI proposals, and resolve conflicts before execution drifts.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Scheduled Blocks</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            {data.scheduled.length === 0 ? (
              <p>No scheduled blocks yet.</p>
            ) : (
              data.scheduled.map((item) => (
                <div key={item.taskId} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Link
                        href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                        className="font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {item.title}
                      </Link>
                      <p>
                        {formatDate(item.scheduledStartAt)} to {formatDate(item.scheduledEndAt)}
                      </p>
                      <p>Due: {formatDate(item.dueAt)}</p>
                    </div>
                    <div className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                      <p>{item.scheduleStatus ?? "Scheduled"}</p>
                      <p>{item.scheduleSource ?? "unknown"}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Unscheduled Queue</h2>
          <div className="mt-4 space-y-4 text-sm text-muted-foreground">
            {data.unscheduled.length === 0 ? (
              <p>No unscheduled work.</p>
            ) : (
              data.unscheduled.map((item) => (
                <div key={item.taskId} className="rounded-xl border bg-background p-4">
                  <div className="space-y-1">
                    <Link
                      href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {item.title}
                    </Link>
                    <p>Status: {item.persistedStatus}</p>
                    <p>{item.actionRequired ?? "Needs a schedule"}</p>
                    <p>Pending proposals: {item.scheduleProposalCount}</p>
                  </div>
                  <div className="mt-4">
                    <ScheduleEditorForm taskId={item.taskId} allowClear={false} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">AI Proposals</h2>
          <div className="mt-4 space-y-4 text-sm text-muted-foreground">
            {data.proposals.length === 0 ? (
              <p>No pending AI proposals.</p>
            ) : (
              data.proposals.map((proposal) => (
                <div key={proposal.proposalId} className="rounded-xl border bg-background p-4">
                  <div className="space-y-1">
                    <Link
                      href={`/workspaces/${proposal.workspaceId}/tasks/${proposal.taskId}`}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {proposal.title}
                    </Link>
                    <p>{proposal.summary}</p>
                    <p>Proposed by: {proposal.proposedBy}</p>
                    <p>
                      {formatDate(proposal.scheduledStartAt)} to {formatDate(proposal.scheduledEndAt)}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form
                      action={async () => {
                        "use server";
                        await acceptScheduleProposal(proposal.proposalId, "Accepted on schedule page");
                      }}
                    >
                      <button
                        type="submit"
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Accept Proposal
                      </button>
                    </form>
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
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Conflicts / Overdue Risks</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            {data.risks.length === 0 ? (
              <p>No schedule risks detected.</p>
            ) : (
              data.risks.map((item) => (
                <div key={item.taskId} className="rounded-xl border bg-background p-4">
                  <Link
                    href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
                    className="font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1">Risk: {item.scheduleStatus ?? item.persistedStatus}</p>
                  <p>Action: {item.actionRequired ?? "Review schedule impact"}</p>
                  <p>Due: {formatDate(item.dueAt)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
