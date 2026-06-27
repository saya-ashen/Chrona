import { db } from "@/lib/db";

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

const ATTENTION_STATUSES = new Set(["Blocked", "Failed", "WaitingForApproval", "WaitingForInput"]);
const SCHEDULE_RISK_STATUSES = new Set(["AtRisk", "Overdue", "Interrupted"]);
const TERMINAL_STATUSES = new Set(["Completed", "Done", "Cancelled"]);

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

function attentionKind(item: ProjectionWithTask): DashboardAttentionKind | null {
  if (item.persistedStatus === "Failed") return "failed";
  if (item.persistedStatus === "WaitingForApproval" || item.approvalPendingCount > 0) return "approval";
  if (item.persistedStatus === "WaitingForInput") return "input";
  if (item.persistedStatus === "Blocked" || item.displayState === "Attention Needed") return "blocked";
  if (SCHEDULE_RISK_STATUSES.has(item.scheduleStatus ?? "")) return "schedule_risk";
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
  return (
    ATTENTION_STATUSES.has(item.persistedStatus) ||
    item.displayState === "Attention Needed" ||
    item.approvalPendingCount > 0 ||
    SCHEDULE_RISK_STATUSES.has(item.scheduleStatus ?? "")
  );
}

function isInProgress(item: ProjectionWithTask): boolean {
  return (
    !isAttention(item) &&
    (item.persistedStatus === "Running" || item.latestRunStatus === "Running")
  );
}

function focusScore(item: ProjectionWithTask, now: number): number {
  if (TERMINAL_STATUSES.has(item.task.status)) return -1;
  let score = PRIORITY_WEIGHT[item.task.priority] ?? 0;
  const kind = attentionKind(item);
  if (kind === "failed" || kind === "blocked" || kind === "approval") score += 100;
  else if (kind === "input") score += 90;
  if (item.scheduleStatus === "Overdue") score += 60;
  else if (item.scheduleStatus === "AtRisk") score += 40;
  if (item.dueAt && item.dueAt.getTime() - now < 24 * 60 * 60 * 1000) score += 30;
  if (item.persistedStatus === "Running") score += 20;
  return score;
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

  const kind = attentionKind(best);
  const step = kind ?? (best.persistedStatus === "Running" ? "running" : "ready");
  return {
    taskId: best.taskId,
    title: best.task.title,
    status: best.persistedStatus,
    priority: best.task.priority,
    scheduleStatus: best.scheduleStatus,
    reason: reasonFor(best),
    stage: best.currentNodeTitle,
    nextStep: nextStepFor(step),
    latestOutput: outputs.get(best.taskId) ?? null,
    dueAt: toIso(best.dueAt),
    updatedAt: toIso(best.lastActivityAt),
  };
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
      const kind = attentionKind(item) ?? "blocked";
      return {
        taskId: item.taskId,
        title: item.task.title,
        status: item.persistedStatus,
        priority: item.task.priority,
        kind,
        reason: reasonFor(item),
        nextStep: nextStepFor(kind),
        latestOutput: outputs.get(item.taskId) ?? null,
        updatedAt: toIso(item.lastActivityAt),
      };
    });

  const inProgress = projections
    .filter(isInProgress)
    .slice(0, 8)
    .map((item) => ({
      taskId: item.taskId,
      title: item.task.title,
      status: item.persistedStatus,
      latestRunStatus: item.latestRunStatus,
      stage: item.currentNodeTitle,
      nextStep: nextStepFor("running"),
      latestOutput: outputs.get(item.taskId) ?? null,
      updatedAt: toIso(item.lastActivityAt),
    }));

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

  return {
    generatedAt: new Date(now).toISOString(),
    focusTask: buildFocusTask(projections, outputs, now),
    needsAttention,
    inProgress,
    autoCompleted,
    totalAutoCompleted: completedTotalGroups.reduce((sum, group) => sum + group._count._all, 0),
    recentEvents,
  };
}
