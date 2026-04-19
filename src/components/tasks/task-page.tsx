import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskAiSidebar } from "@/components/tasks/task-ai-sidebar";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";

type TaskPageProps = {
  data: {
    task: {
      id: string;
      workspaceId: string;
      title: string;
      description: string | null;
      runtimeModel: string | null;
      prompt: string | null;
      runtimeConfig: unknown;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string;
      scheduleSource: string | null;
      isRunnable: boolean;
      runnabilitySummary: string;
      runnabilityState?: string;
      ownerType?: string;
      savedAiPlan?: {
        id: string;
        status: "draft" | "accepted" | "superseded" | "archived";
        prompt: string | null;
        revision?: number;
        summary?: string | null;
        updatedAt: string;
        plan?: {
          id: string;
          taskId: string;
          status: "draft" | "accepted" | "superseded" | "archived";
          revision: number;
          source: "ai" | "user" | "mixed";
          generatedBy: string | null;
          prompt: string | null;
          summary: string | null;
          changeSummary: string | null;
          createdAt: string;
          updatedAt: string;
          nodes: Array<{
            id: string;
            type: string;
            title: string;
            objective: string;
            description: string | null;
            status: "pending" | "in_progress" | "waiting_for_user" | "blocked" | "done" | "skipped";
            phase: string | null;
            estimatedMinutes: number | null;
            priority: string | null;
            executionMode: "none" | "child_task" | "inline_action";
            linkedTaskId: string | null;
            needsUserInput: boolean;
          }>;
          edges: Array<{
            id: string;
            fromNodeId: string;
            toNodeId: string;
            type: string;
          }>;
        };
      } | null;
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
  copy?: Partial<typeof DEFAULT_COPY>;
};

const DEFAULT_COPY = {
  eyebrow: "Secondary task detail",
  fallbackDescription: "Use this page for reference, deep links, and heavier context that would clutter Schedule.",
  backToSchedule: "Back to Schedule",
  openWorkbench: "Open Workbench",
  returnToSchedule: "Return to Schedule",
  dueBadgePrefix: "Due",
  primarySurfacesTitle: "Use the primary surfaces",
  primarySurfacesDescription:
    "Keep core planning and task configuration in Schedule, then move into Work for execution and collaboration.",
  editPlanning: "Edit planning in Schedule",
  continueExecution: "Continue execution in Work",
  runtimeConfigurationTitle: "Runtime configuration",
  runtimeConfigurationDescription:
    "Keep the runnable definition visible here, but treat Schedule as the default place to edit it.",
  model: "Model",
  needsModel: "Needs model",
  runnability: "Runnability",
  prompt: "Prompt",
  noPrompt: "No prompt saved yet. Configure one in Schedule before execution.",
  runtimeParams: "Runtime params",
  noRuntimeParams: "No advanced runtime params saved.",
  planningContextTitle: "Planning context",
  planningContextDescription:
    "Keep the current plan visible without turning this page back into the main planning surface.",
  due: "Due",
  start: "Start",
  end: "End",
  scheduleStatus: "Schedule status",
  scheduleSource: "Schedule source",
  noBlockingAction: "No blocking action recorded.",
  dependenciesTitle: "Dependencies",
  dependenciesDescription: "Track upstream work without pulling planning controls back into this page.",
  noDependencies: "No dependencies linked yet.",
  latestRunTitle: "Latest Run",
  status: "Status",
  started: "Started",
  sync: "Sync",
  noRunStarted: "No run started yet.",
  pendingScheduleProposalsTitle: "Pending Schedule Proposals",
  noPendingScheduleProposals: "No pending schedule proposals.",
  via: "via",
  recentApprovalsTitle: "Recent Approvals",
  noRecentApprovals: "No recent approvals.",
  recentArtifactsTitle: "Recent Artifacts",
  noArtifacts: "No artifacts yet.",
};

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function formatJson(value: unknown) {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

export function TaskPage({ data, copy: copyProp }: TaskPageProps) {
  const runtimeConfigJson = formatJson(data.task.runtimeConfig);
  const copy = { ...DEFAULT_COPY, ...copyProp };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <SurfaceCard className="space-y-6" padding="lg">
          <SurfaceCardHeader className="space-y-5 border-b border-border/60 pb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {copy.eyebrow}
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-balance">{data.task.title}</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  {data.task.description ?? copy.fallbackDescription}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <LocalizedLink href="/schedule" className={buttonVariants({ variant: "default" })}>
                  {copy.backToSchedule}
                </LocalizedLink>
                <LocalizedLink
                  href={`/workspaces/${data.task.workspaceId}/work/${data.task.id}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  {copy.openWorkbench}
                </LocalizedLink>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Status</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge tone="info">{data.task.status}</StatusBadge>
                  <StatusBadge tone={priorityTone(data.task.priority)}>{data.task.priority}</StatusBadge>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Schedule</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge tone={scheduleTone(data.task.scheduleStatus)}>{data.task.scheduleStatus}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{data.task.scheduleSource ?? "Manual planning"}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Execution readiness</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge tone={data.task.isRunnable ? "success" : "warning"}>{data.task.runnabilitySummary}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {data.task.isRunnable ? "Ready for AI-assisted execution" : "Needs more setup before execution"}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Due</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{formatDate(data.task.dueAt)}</p>
                <p className="mt-2 text-sm text-muted-foreground">{copy.dueBadgePrefix} date for this task</p>
              </div>
            </div>
          </SurfaceCardHeader>

          <SurfaceCard variant="inset" className="space-y-3">
            <SurfaceCardHeader>
              <SurfaceCardTitle>{copy.primarySurfacesTitle}</SurfaceCardTitle>
              <SurfaceCardDescription>{copy.primarySurfacesDescription}</SurfaceCardDescription>
            </SurfaceCardHeader>

            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <LocalizedLink href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {copy.editPlanning}
              </LocalizedLink>
              <LocalizedLink
                href={`/workspaces/${data.task.workspaceId}/work/${data.task.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {copy.continueExecution}
              </LocalizedLink>
            </div>
          </SurfaceCard>

          <div className="grid gap-4 md:grid-cols-2">
            <SurfaceCard variant="inset" className="space-y-3">
              <SurfaceCardHeader>
                <SurfaceCardTitle>{copy.runtimeConfigurationTitle}</SurfaceCardTitle>
                <SurfaceCardDescription>{copy.runtimeConfigurationDescription}</SurfaceCardDescription>
              </SurfaceCardHeader>

              <dl className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.model}</dt>
                  <dd className="text-right text-foreground">{data.task.runtimeModel ?? copy.needsModel}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.runnability}</dt>
                  <dd className="text-right text-foreground">{data.task.runnabilitySummary}</dd>
                </div>
              </dl>

              <div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.prompt}</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {data.task.prompt ?? copy.noPrompt}
                </p>
              </div>

              <div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.runtimeParams}</p>
                {runtimeConfigJson ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-foreground">{runtimeConfigJson}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">{copy.noRuntimeParams}</p>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard variant="inset" className="space-y-3">
              <SurfaceCardHeader>
                <SurfaceCardTitle>{copy.planningContextTitle}</SurfaceCardTitle>
                <SurfaceCardDescription>{copy.planningContextDescription}</SurfaceCardDescription>
              </SurfaceCardHeader>

              <dl className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.due}</dt>
                  <dd>{formatDate(data.task.dueAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.start}</dt>
                  <dd>{formatDate(data.task.scheduledStartAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.end}</dt>
                  <dd>{formatDate(data.task.scheduledEndAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.scheduleStatus}</dt>
                  <dd>{data.task.scheduleStatus}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>{copy.scheduleSource}</dt>
                  <dd>{data.task.scheduleSource ?? "-"}</dd>
                </div>
              </dl>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                {data.task.blockReason?.actionRequired ?? copy.noBlockingAction}
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard variant="inset" className="space-y-3">
            <SurfaceCardHeader>
              <SurfaceCardTitle>{copy.dependenciesTitle}</SurfaceCardTitle>
              <SurfaceCardDescription>{copy.dependenciesDescription}</SurfaceCardDescription>
            </SurfaceCardHeader>
            <div className="space-y-3 text-sm text-muted-foreground">
              {data.task.dependencies.length === 0 ? (
                <p>{copy.noDependencies}</p>
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
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <TaskAiSidebar
          task={{
            id: data.task.id,
            workspaceId: data.task.workspaceId,
            title: data.task.title,
            description: data.task.description,
            priority: data.task.priority,
            status: data.task.status,
            dueAt: data.task.dueAt,
            scheduledStartAt: data.task.scheduledStartAt,
            scheduledEndAt: data.task.scheduledEndAt,
            scheduleStatus: data.task.scheduleStatus,
            scheduleSource: data.task.scheduleSource,
            isRunnable: data.task.isRunnable,
            runnabilitySummary: data.task.runnabilitySummary,
            runnabilityState: data.task.runnabilityState,
            ownerType: data.task.ownerType,
            savedAiPlan: data.task.savedAiPlan ?? null,
          }}
        />

        <SurfaceCard>
          <SurfaceCardTitle>{copy.latestRunTitle}</SurfaceCardTitle>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            {data.latestRunSummary ? (
              <>
                <p>{copy.status}: {data.latestRunSummary.status}</p>
                <p>{copy.started}: {formatDate(data.latestRunSummary.startedAt)}</p>
                <p>{copy.sync}: {data.latestRunSummary.syncStatus}</p>
              </>
            ) : (
              <p>{copy.noRunStarted}</p>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>{copy.pendingScheduleProposalsTitle}</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.scheduleProposals.length === 0 ? (
              <p>{copy.noPendingScheduleProposals}</p>
            ) : (
              data.scheduleProposals.map((proposal) => (
                <SurfaceCard key={proposal.id} as="div" variant="inset" padding="sm" className="rounded-2xl">
                  <p className="font-medium text-foreground">{proposal.summary}</p>
                  <p>
                    {proposal.source} {copy.via} {proposal.proposedBy}
                  </p>
                  <p>{copy.status}: {proposal.status}</p>
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardTitle>{copy.recentApprovalsTitle}</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.approvals.length === 0 ? (
              <p>{copy.noRecentApprovals}</p>
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
          <SurfaceCardTitle>{copy.recentArtifactsTitle}</SurfaceCardTitle>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {data.artifacts.length === 0 ? (
              <p>{copy.noArtifacts}</p>
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
      </aside>
    </div>
  );
}
