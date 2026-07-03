import { db } from "@/lib/db";
import { deriveWorkItemStateView, type WorkItemStateView } from "@chrona/domain";
import { getDashboardAiBriefState } from "./dashboard-ai-surface";

/**
 * Dashboard "task news homepage" projection.
 *
 * Instead of raw KPIs, this composes the workspace into editorial sections the
 * landing page can render directly:
 *   - `focusTask`     the single most important task right now (headline)
 *   - `needsAttention` tasks waiting on the operator, each with a reason + action
 *   - `autoCompleted` recently finished tasks with their outputs (the "value" feed)
 *   - `inProgress`    tasks Chrona is actively advancing
 *   - `recentEvents`  a readable activity stream (not a log dump)
 *
 * Counts/ranges are NOT computed here: every item carries its own ISO timestamp
 * so the client can derive the today/week/all summary and filter the task stream
 * in the operator's local timezone without a refetch. `totalAutoCompleted` is the
 * one all-time figure the client cannot derive from a capped list.
 */

const ATTENTION_STATES: ReadonlySet<WorkItemStateView["state"]> = new Set(["blocked", "failed", "waiting_for_approval", "waiting_for_input"]);
const RUNNING_STATES: ReadonlySet<WorkItemStateView["state"]> = new Set(["running"]);
const TERMINAL_STATES: ReadonlySet<WorkItemStateView["state"]> = new Set(["completed", "cancelled"]);

const PRIORITY_WEIGHT: Record<string, number> = { Urgent: 3, High: 2, Medium: 1, Low: 0 };

export type DashboardNextStep =
  | "approve_or_edit"
  | "resolve_block"
  | "provide_input"
  | "await_completion"
  | "start_execution"
  | "reschedule"
  | "review_result";

export type DashboardAttentionKind =
  | "approval"
  | "input"
  | "blocked"
  | "failed"
  | "schedule_risk";

/**
 * Editorial buckets for the "auto-completed" digest. Derived from the task's
 * latest artifact type so the homepage can summarise *what kind* of value
 * Chrona produced (reports, research, code, plan/automation) without the client
 * needing to know the persistence-level `ArtifactType` enum.
 */
export type DashboardCompletionCategory = "report" | "research" | "code" | "automation";

function completionCategory(output: OutputRef): DashboardCompletionCategory {
  switch (output?.type) {
    case "report":
    case "file":
      return "report";
    case "summary":
    case "url":
      return "research";
    case "patch":
    case "terminal_output":
      return "code";
    default:
      return "automation";
  }
}

type ProjectionWithTask = Awaited<ReturnType<typeof loadProjections>>[number];

function loadProjections(workspaceId: string) {
  return db.taskProjection.findMany({
    where: { workspaceId },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
    include: {
      task: {
        select: {
          title: true,
          priority: true,
          status: true,
          completedAt: true,
          createdAt: true,
          blockReason: true,
        },
      },
    },
  });
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function reasonFor(item: ProjectionWithTask): string | null {
  const blockReason = item.task.blockReason as { detail?: unknown; actionRequired?: unknown } | null;
  return (
    item.blockDetail ??
    readString(blockReason?.detail) ??
    item.actionRequired ??
    readString(blockReason?.actionRequired)
  );
}

function stateViewFor(item: ProjectionWithTask): WorkItemStateView {
  return deriveWorkItemStateView({
    taskStatus: item.persistedStatus,
    scheduleStatus: item.scheduleStatus,
    executionStatus: item.displayState,
    providerStatus: item.latestRunStatus,
    isScheduled: Boolean(item.scheduledStartAt || item.scheduledEndAt),
    isRunnable: item.actionRequired ? false : undefined,
  });
}

function attentionKind(stateView: WorkItemStateView): DashboardAttentionKind | null {
  if (stateView.state === "failed") return "failed";
  if (stateView.state === "waiting_for_approval") return "approval";
  if (stateView.state === "waiting_for_input") return "input";
  if (stateView.state === "blocked") return "blocked";
  return null;
}

function nextStepFor(kind: DashboardAttentionKind | "running" | "ready"): DashboardNextStep {
  switch (kind) {
    case "approval":
      return "approve_or_edit";
    case "input":
      return "provide_input";
    case "failed":
    case "blocked":
      return "resolve_block";
    case "schedule_risk":
      return "reschedule";
    case "running":
      return "await_completion";
    default:
      return "start_execution";
  }
}

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function isAttention(item: ProjectionWithTask): boolean {
  return ATTENTION_STATES.has(stateViewFor(item).state);
}

function isInProgress(item: ProjectionWithTask): boolean {
  return !isAttention(item) && RUNNING_STATES.has(stateViewFor(item).state);
}

function focusScore(item: ProjectionWithTask, now: number): number {
  const stateView = stateViewFor(item);
  if (TERMINAL_STATES.has(stateView.state)) return -1;
  let score = PRIORITY_WEIGHT[item.task.priority] ?? 0;
  const kind = attentionKind(stateView);
  if (kind === "failed" || kind === "blocked" || kind === "approval") score += 100;
  else if (kind === "input") score += 90;
  if (stateView.state === "failed") score += 60;
  else if (stateView.state === "blocked") score += 40;
  if (item.dueAt && item.dueAt.getTime() - now < 24 * 60 * 60 * 1000) score += 30;
  if (stateView.state === "running") score += 20;
  return score;
}

function isUpcomingToday(item: ProjectionWithTask, now: number): boolean {
  if (isAttention(item) || isInProgress(item) || TERMINAL_STATES.has(stateViewFor(item).state)) return false;
  const start = item.scheduledStartAt ?? item.dueAt;
  if (!start) return false;
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  return start.getTime() >= now && start.getTime() <= todayEnd.getTime();
}

function mapDashboardTask(item: ProjectionWithTask, outputs: Map<string, OutputRef>) {
  const stateView = stateViewFor(item);
  const kind = attentionKind(stateView);
  const step = kind ?? (stateView.state === "running" ? "running" : "ready");
  return {
    taskId: item.taskId,
    title: item.task.title,
    status: item.persistedStatus,
    stateView,
    priority: item.task.priority,
    scheduleStatus: item.scheduleStatus,
    scheduledStartAt: toIso(item.scheduledStartAt),
    scheduledEndAt: toIso(item.scheduledEndAt),
    dueAt: toIso(item.dueAt),
    reason: reasonFor(item) ?? stateView.disabledReason ?? stateView.description,
    stage: item.currentNodeTitle,
    nextStep: nextStepFor(step),
    latestOutput: outputs.get(item.taskId) ?? null,
    updatedAt: toIso(item.lastActivityAt),
  };
}

type OutputRef = { id: string; title: string; type: string; taskId: string } | null;

function planOutputTitle(planRun: unknown): string | null {
  const record = planRun as { mutableGraph?: { planOutput?: { history?: Array<{ summary?: unknown }> } } } | null;
  const history = record?.mutableGraph?.planOutput?.history;
  if (!Array.isArray(history) || history.length === 0) return null;
  return readString(history.at(-1)?.summary) ?? "Plan output";
}

async function loadLatestOutputs(workspaceId: string): Promise<Map<string, OutputRef>> {
  const recent = await db.taskPlanRun.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { id: true, taskId: true, planRun: true },
  });
  const byTask = new Map<string, OutputRef>();
  for (const run of recent) {
    if (byTask.has(run.taskId)) continue;
    const title = planOutputTitle(run.planRun);
    if (!title) continue;
    byTask.set(run.taskId, { id: run.id, title, type: "plan_output", taskId: run.taskId });
  }
  return byTask;
}

const FEED_CATEGORY: Record<string, string> = {
  "task.created": "created",
  "plan_generation.started": "plan",
  "plan_generation.completed": "plan",
  "plan_generation.failed": "failed",
  replan_proposed: "plan",
  execution_started: "started",
  external_run_started: "started",
  "provider.run_started": "started",
  execution_completed: "completed",
  "run.completed": "completed",
  "task.done": "completed",
  "task.result_accepted": "completed",
  node_blocked: "blocked",
  "plan_execution.node_blocked": "blocked",
  "approval.requested": "approval",
  approval_required: "approval",
  node_waiting_for_approval: "approval",
  node_waiting_for_user: "input",
  user_input_received: "input",
  "task.schedule_proposed": "schedule",
  "task.schedule_changed": "schedule",
};

async function loadRecentEvents(workspaceId: string) {
  const events = await db.event.findMany({
    where: { workspaceId, eventType: { in: Object.keys(FEED_CATEGORY) }, taskId: { not: null } },
    orderBy: { ingestSequence: "desc" },
    take: 40,
    select: {
      id: true,
      eventType: true,
      summary: true,
      taskId: true,
      occurredAt: true,
      ingestedAt: true,
      task: { select: { title: true } },
    },
  });

  return events
    .map((event) => ({
      id: event.id,
      category: FEED_CATEGORY[event.eventType] ?? "started",
      at: (event.occurredAt ?? event.ingestedAt).toISOString(),
      taskId: event.taskId as string,
      taskTitle: event.task?.title ?? "",
      summary: readString(event.summary),
    }))
    .filter((event) => event.taskTitle.length > 0)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 12);
}

function buildFocusTask(
  projections: ProjectionWithTask[],
  outputs: Map<string, OutputRef>,
  now: number,
) {
  let best: ProjectionWithTask | null = null;
  let bestScore = 0;
  for (const item of projections) {
    const score = focusScore(item, now);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best) return null;

  return mapDashboardTask(best, outputs);
}

export async function getDashboard(workspaceId: string) {
  const now = Date.now();
  const [projections, outputs, recentEvents, completedTotalGroups] = await Promise.all([
    loadProjections(workspaceId),
    loadLatestOutputs(workspaceId),
    loadRecentEvents(workspaceId),
    db.task.groupBy({
      by: ["status"],
      where: { workspaceId, status: { in: ["Completed", "Done"] } },
      _count: { _all: true },
    }),
  ]);

  const needsAttention = projections
    .filter(isAttention)
    .slice(0, 12)
    .map((item) => {
      const stateView = stateViewFor(item);
      const kind = attentionKind(stateView) ?? "blocked";
      return {
        taskId: item.taskId,
        title: item.task.title,
        status: item.persistedStatus,
        stateView,
        priority: item.task.priority,
        kind,
        reason: reasonFor(item) ?? stateView.disabledReason ?? stateView.description,
        nextStep: nextStepFor(kind),
        latestOutput: outputs.get(item.taskId) ?? null,
        updatedAt: toIso(item.lastActivityAt),
      };
    });

  const inProgress = projections
    .filter(isInProgress)
    .slice(0, 8)
    .map((item) => {
      const stateView = stateViewFor(item);
      return {
        taskId: item.taskId,
        title: item.task.title,
        status: item.persistedStatus,
        stateView,
        latestRunStatus: item.latestRunStatus,
        stage: item.currentNodeTitle,
        nextStep: nextStepFor("running"),
        latestOutput: outputs.get(item.taskId) ?? null,
        updatedAt: toIso(item.lastActivityAt),
      };
    });

  const upcomingToday = projections
    .filter((item) => isUpcomingToday(item, now))
    .sort((left, right) =>
      (left.scheduledStartAt ?? left.dueAt ?? left.updatedAt).getTime() -
      (right.scheduledStartAt ?? right.dueAt ?? right.updatedAt).getTime(),
    )
    .slice(0, 8)
    .map((item) => mapDashboardTask(item, outputs));

  const autoCompleted = projections
    .filter((item) => item.task.status === "Completed" || item.task.status === "Done")
    .sort(
      (left, right) =>
        (right.task.completedAt ?? right.lastActivityAt ?? right.updatedAt).getTime() -
        (left.task.completedAt ?? left.lastActivityAt ?? left.updatedAt).getTime(),
    )
    .slice(0, 50)
    .map((item) => {
      const output = outputs.get(item.taskId) ?? null;
      return {
        taskId: item.taskId,
        title: item.task.title,
        completedAt: toIso(item.task.completedAt ?? item.lastActivityAt ?? item.updatedAt),
        summary: output?.title ?? item.latestArtifactTitle ?? null,
        category: completionCategory(output),
        output,
      };
    });

  const totalAutoCompleted = completedTotalGroups.reduce((sum, group) => sum + group._count._all, 0);
  const aiBrief = await getDashboardAiBriefState({
    workspaceId,
    fingerprintInput: {
      needsAttention,
      inProgress,
      upcomingToday,
      autoCompleted,
      recentEvents,
      totalAutoCompleted,
    },
  });

  return {
    generatedAt: new Date(now).toISOString(),
    workspaceId,
    focusTask: buildFocusTask(projections, outputs, now),
    needsAttention,
    inProgress,
    upcomingToday,
    autoCompleted,
    totalAutoCompleted,
    recentEvents,
    aiBrief,
  };
}
