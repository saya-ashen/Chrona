import Link from "next/link";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";

type TaskPageProps = {
  data: {
    task: {
      id: string;
      workspaceId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string;
      scheduleSource: string | null;
      blockReason:
        | {
            blockType?: string;
            actionRequired?: string;
            scope?: string;
            since?: string;
          }
        | null;
      dependencies: Array<{
        id: string;
        dependencyType: string;
        dependsOnTask: {
          id: string;
          title: string;
          status: string;
        };
      }>;
    };
    latestRunSummary:
      | {
          id: string;
          status: string;
          startedAt: string | null;
          syncStatus: string;
        }
      | null;
    scheduleProposals: Array<{
      id: string;
      source: string;
      proposedBy: string;
      summary: string;
      status: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
    }>;
    approvals: Array<{
      id: string;
      title: string;
      status: string;
      riskLevel?: string;
      requestedAt?: string;
    }>;
    artifacts: Array<{
      id: string;
      title: string;
      type: string;
      uri?: string;
    }>;
  };
};

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function parseDate(value: string | null) {
  return value ? new Date(value) : null;
}

export function TaskPage({ data }: TaskPageProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{data.task.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.task.description ?? "No task description yet."}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border bg-background p-4">
            <h2 className="text-sm font-semibold">Task Control</h2>
            <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-4">
                <dt>Status</dt>
                <dd>{data.task.status}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Priority</dt>
                <dd>{data.task.priority}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border bg-background p-4">
            <h2 className="text-sm font-semibold">Scheduling</h2>
            <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-4">
                <dt>Due</dt>
                <dd>{formatDate(data.task.dueAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Start</dt>
                <dd>{formatDate(data.task.scheduledStartAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>End</dt>
                <dd>{formatDate(data.task.scheduledEndAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Schedule Status</dt>
                <dd>{data.task.scheduleStatus}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Schedule Source</dt>
                <dd>{data.task.scheduleSource ?? "-"}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <ScheduleEditorForm
                taskId={data.task.id}
                dueAt={parseDate(data.task.dueAt)}
                scheduledStartAt={parseDate(data.task.scheduledStartAt)}
                scheduledEndAt={parseDate(data.task.scheduledEndAt)}
                scheduleSource={(data.task.scheduleSource as "human" | "ai" | "system" | null) ?? "human"}
              />
            </div>
          </section>
        </div>

        <section className="rounded-xl border bg-background p-4">
          <h2 className="text-sm font-semibold">Dependencies</h2>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.task.dependencies.length === 0 ? (
              <p>No dependencies linked yet.</p>
            ) : (
              data.task.dependencies.map((dependency) => (
                <div key={dependency.id} className="rounded-lg border bg-card px-3 py-2">
                  <p className="font-medium text-foreground">{dependency.dependsOnTask.title}</p>
                  <p>
                    {dependency.dependencyType} · {dependency.dependsOnTask.status}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Latest Run</h2>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            {data.latestRunSummary ? (
              <>
                <p>Status: {data.latestRunSummary.status}</p>
                <p>Started: {formatDate(data.latestRunSummary.startedAt)}</p>
                <p>Sync: {data.latestRunSummary.syncStatus}</p>
              </>
            ) : (
              <p>No run started yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Block Reason</h2>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>{data.task.blockReason?.actionRequired ?? "No block"}</p>
            {data.task.blockReason?.scope ? <p>Scope: {data.task.blockReason.scope}</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Pending Schedule Proposals</h2>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.scheduleProposals.length === 0 ? (
              <p>No pending schedule proposals.</p>
            ) : (
              data.scheduleProposals.map((proposal) => (
                <div key={proposal.id} className="rounded-lg border bg-background px-3 py-2">
                  <p className="font-medium text-foreground">{proposal.summary}</p>
                  <p>
                    {proposal.source} via {proposal.proposedBy}
                  </p>
                  <p>Status: {proposal.status}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Recent Approvals</h2>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.approvals.length === 0 ? (
              <p>No recent approvals.</p>
            ) : (
              data.approvals.map((approval) => (
                <div key={approval.id} className="rounded-lg border bg-background px-3 py-2">
                  <p className="font-medium text-foreground">{approval.title}</p>
                  <p>{approval.status}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Recent Artifacts</h2>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.artifacts.length === 0 ? (
              <p>No artifacts yet.</p>
            ) : (
              data.artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-lg border bg-background px-3 py-2">
                  <p className="font-medium text-foreground">{artifact.title}</p>
                  <p>{artifact.type}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Actions</h2>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Start Run
            </button>
            <Link
              href="/schedule"
              className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Open Schedule
            </Link>
            <Link
              href={`/workspaces/${data.task.workspaceId}/work/${data.task.id}`}
              className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Open Work Page
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
