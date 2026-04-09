import Link from "next/link";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";

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
  startRunAction?: (formData: FormData) => Promise<void>;
  updateTaskAction?: (formData: FormData) => Promise<void>;
  proposeScheduleAction?: (formData: FormData) => Promise<void>;
};

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function formatDateTimeInput(value: string | null | undefined) {
  return value ? value.slice(0, 16) : "";
}

function parseDate(value: string | null) {
  return value ? new Date(value) : null;
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "critical" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

function scheduleTone(status: string) {
  if (status === "Overdue") return "critical" as const;
  if (status === "AtRisk") return "warning" as const;
  if (status === "InProgress" || status === "Scheduled") return "info" as const;
  return "neutral" as const;
}

export function TaskPage({ data, startRunAction, updateTaskAction, proposeScheduleAction }: TaskPageProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <SurfaceCard className="space-y-6" padding="lg">
        <SurfaceCardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">{data.task.title}</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {data.task.description ?? "No task description yet."}
              </p>
            </div>
            <TaskContextLinks
              workspaceId={data.task.workspaceId}
              taskId={data.task.id}
              latestRunStatus={data.latestRunSummary?.status ?? null}
              taskLabel="Open Task"
              workLabel={data.latestRunSummary ? "Resume in Workbench" : "Start Work"}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">{data.task.status}</StatusBadge>
            <StatusBadge tone={priorityTone(data.task.priority)}>{data.task.priority}</StatusBadge>
            <StatusBadge tone={scheduleTone(data.task.scheduleStatus)}>{data.task.scheduleStatus}</StatusBadge>
            <StatusBadge>Due {formatDate(data.task.dueAt)}</StatusBadge>
          </div>
        </SurfaceCardHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <SurfaceCard variant="inset" className="space-y-3">
            <SurfaceCardHeader>
              <SurfaceCardTitle>Task Control</SurfaceCardTitle>
              <SurfaceCardDescription>
                Keep the task definition current without leaving the control surface.
              </SurfaceCardDescription>
            </SurfaceCardHeader>
            <form action={updateTaskAction} className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusBadge>Status {data.task.status}</StatusBadge>
                <StatusBadge>Priority {data.task.priority}</StatusBadge>
              </div>
              <Field label="Title">
                <input name="title" required defaultValue={data.task.title} className={inputClassName} />
              </Field>
              <Field label="Description">
                <textarea
                  name="description"
                  rows={5}
                  defaultValue={data.task.description ?? ""}
                  placeholder="Execution context, desired outcome, or constraints"
                  className={textareaClassName}
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Priority">
                  <select name="priority" defaultValue={data.task.priority} className={selectClassName}>
                    {(["Low", "Medium", "High", "Urgent"] as const).map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due">
                  <input
                    type="datetime-local"
                    name="dueAt"
                    defaultValue={formatDateTimeInput(data.task.dueAt)}
                    className={inputClassName}
                  />
                </Field>
              </div>
              <button type="submit" className={buttonVariants({ variant: "default" })}>
                Save Task Details
              </button>
            </form>
          </SurfaceCard>

          <SurfaceCard variant="inset" className="space-y-3">
            <SurfaceCardHeader>
              <SurfaceCardTitle>Scheduling</SurfaceCardTitle>
              <SurfaceCardDescription>
                Keep the task window visible and editable from the same planning surface.
              </SurfaceCardDescription>
            </SurfaceCardHeader>
            <dl className="space-y-2 text-sm text-muted-foreground">
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
            <div className="pt-1">
              <ScheduleEditorForm
                taskId={data.task.id}
                dueAt={parseDate(data.task.dueAt)}
                scheduledStartAt={parseDate(data.task.scheduledStartAt)}
                scheduledEndAt={parseDate(data.task.scheduledEndAt)}
                scheduleSource={(data.task.scheduleSource as "human" | "ai" | "system" | null) ?? "human"}
              />
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard variant="inset" className="space-y-3">
          <SurfaceCardHeader>
            <SurfaceCardTitle>Dependencies</SurfaceCardTitle>
            <SurfaceCardDescription>Track upstream work without opening a second planning surface.</SurfaceCardDescription>
          </SurfaceCardHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            {data.task.dependencies.length === 0 ? (
              <p>No dependencies linked yet.</p>
            ) : (
              data.task.dependencies.map((dependency) => (
                <SurfaceCard key={dependency.id} as="div" variant="default" padding="sm" className="rounded-2xl">
                  <p className="font-medium text-foreground">{dependency.dependsOnTask.title}</p>
                  <p>
                    {dependency.dependencyType} · {dependency.dependsOnTask.status}
                  </p>
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>
      </SurfaceCard>

      <aside className="space-y-4">
        <SurfaceCard>
          <SurfaceCardTitle>Latest Run</SurfaceCardTitle>
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
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>Block Reason</SurfaceCardTitle>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>{data.task.blockReason?.actionRequired ?? "No block"}</p>
            {data.task.blockReason?.scope ? <p>Scope: {data.task.blockReason.scope}</p> : null}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>Pending Schedule Proposals</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.scheduleProposals.length === 0 ? (
              <p>No pending schedule proposals.</p>
            ) : (
              data.scheduleProposals.map((proposal) => (
                <SurfaceCard key={proposal.id} as="div" variant="inset" padding="sm" className="rounded-2xl">
                  <p className="font-medium text-foreground">{proposal.summary}</p>
                  <p>
                    {proposal.source} via {proposal.proposedBy}
                  </p>
                  <p>Status: {proposal.status}</p>
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Create Schedule Proposal</SurfaceCardTitle>
            <SurfaceCardDescription>
              Capture a human planning suggestion so Schedule can review and accept it later.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <form action={proposeScheduleAction} className="mt-3 space-y-3">
            <Field label="Proposal summary">
              <textarea
                name="summary"
                rows={4}
                required
                placeholder="Suggest how this task should move in the schedule"
                className={textareaClassName}
              />
            </Field>
            <div className="grid gap-3">
              <Field label="Proposed due">
                <input
                  type="datetime-local"
                  name="dueAt"
                  defaultValue={formatDateTimeInput(data.task.dueAt)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Proposed start">
                <input
                  type="datetime-local"
                  name="scheduledStartAt"
                  defaultValue={formatDateTimeInput(data.task.scheduledStartAt)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Proposed end">
                <input
                  type="datetime-local"
                  name="scheduledEndAt"
                  defaultValue={formatDateTimeInput(data.task.scheduledEndAt)}
                  className={inputClassName}
                />
              </Field>
            </div>
            <button type="submit" className={buttonVariants({ variant: "outline" })}>
              Create Proposal
            </button>
          </form>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>Recent Approvals</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.approvals.length === 0 ? (
              <p>No recent approvals.</p>
            ) : (
              data.approvals.map((approval) => (
                <SurfaceCard key={approval.id} as="div" variant="inset" padding="sm" className="rounded-2xl">
                  <p className="font-medium text-foreground">{approval.title}</p>
                  <p>{approval.status}</p>
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>Recent Artifacts</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.artifacts.length === 0 ? (
              <p>No artifacts yet.</p>
            ) : (
              data.artifacts.map((artifact) => (
                <SurfaceCard key={artifact.id} as="div" variant="inset" padding="sm" className="rounded-2xl">
                  <p className="font-medium text-foreground">{artifact.title}</p>
                  <p>{artifact.type}</p>
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>Actions</SurfaceCardTitle>
          <div className="mt-3 flex flex-col gap-3">
            <form action={startRunAction} className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-3">
              <Field label="Run prompt">
                <textarea
                  name="prompt"
                  required
                  rows={4}
                  defaultValue={data.task.description ?? `Continue working on: ${data.task.title}`}
                  className={textareaClassName}
                />
              </Field>
              <button type="submit" className={buttonVariants({ variant: "default" })}>
                Start Run
              </button>
            </form>
            <Link href="/schedule" className={buttonVariants({ variant: "outline" })}>
              Open Schedule
            </Link>
            <Link
              href={`/workspaces/${data.task.workspaceId}/work/${data.task.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Open Workbench
            </Link>
          </div>
        </SurfaceCard>
      </aside>
    </div>
  );
}
