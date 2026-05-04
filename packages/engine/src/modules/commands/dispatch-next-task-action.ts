import { aiDispatchTask } from "@/modules/ai/ai-service";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { db } from "@/lib/db";
import { getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { DispatchTaskOutput, TaskDispatchPolicy } from "@chrona/contracts";

const DEFAULT_DISPATCH_POLICY = {
  minConfidenceForAutoExecute: 0.9,
  allowedAutoActions: ["materialize_node"],
  requireHumanApprovalByDefault: true,
} satisfies TaskDispatchPolicy;

export async function dispatchNextTaskAction(input: {
  taskId: string;
  workspaceId: string;
  mode: "preview";
}): Promise<DispatchTaskOutput> {
  const task = await db.task.findFirst({
    where: { id: input.taskId, workspaceId: input.workspaceId },
  });
  if (!task) {
    throw new Error(`Task ${input.taskId} not found in workspace ${input.workspaceId}`);
  }

  const acceptedPlan = await getAcceptedTaskPlanGraph(input.taskId);
  if (!acceptedPlan) {
    throw new Error(`No accepted plan graph found for task ${input.taskId}`);
  }

  const linkedTasks = acceptedPlan.plan.nodes
    .filter((node) => node.linkedTaskId)
    .map((node) => ({
      taskId: node.linkedTaskId as string,
      nodeId: node.id,
      status: node.status,
      title: node.title,
    }));

  const latestRuns = (
    await db.run.findMany({
      where: { taskId: input.taskId },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
  ).map((run) => ({
    runId: run.id,
    taskId: run.taskId,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    endedAt: run.endedAt?.toISOString() ?? null,
    errorSummary: run.errorSummary ?? null,
  }));

  const recentEvents = (
    await db.event.findMany({
      where: { taskId: input.taskId },
      orderBy: { ingestSequence: "desc" },
      take: 25,
    })
  ).map((event) => ({
    eventType: event.eventType,
    createdAt: event.createdAt.toISOString(),
    runId: event.runId,
    payload:
      event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : undefined,
  }));

  const approvals = (
    await db.approval.findMany({
      where: { taskId: input.taskId, status: "Pending" },
      orderBy: { requestedAt: "desc" },
      take: 10,
    })
  ).map((approval) => ({
    id: approval.id,
    status: approval.status,
    riskLevel: approval.riskLevel,
    runId: approval.runId,
    title: approval.title,
  }));

  const blockers = acceptedPlan.plan.nodes
    .filter((node) => node.status === "blocked" || node.status === "waiting_for_user")
    .map((node) => ({
      id: node.id,
      type: node.status,
      reason: node.blockingReason ?? "unknown",
    }));

  const result = await aiDispatchTask({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    acceptedPlan: acceptedPlan.plan,
    linkedTasks,
    latestRuns,
    recentEvents,
    approvals,
    blockers,
    policy: DEFAULT_DISPATCH_POLICY,
  });

  if (!result) {
    throw new Error("No AI client configured for dispatch_task");
  }

  await appendCanonicalEvent({
    eventType: "task.dispatch_previewed",
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    actorType: "agent",
    actorId: "dispatcher",
    source: "chrona.dispatch.preview",
    payload: {
      action: result.decision.action,
      confidence: result.decision.confidence,
      riskLevel: result.decision.safety.riskLevel,
      reason: result.decision.reason,
      reliability: result.reliability,
      mode: input.mode,
    },
    dedupeKey: `task.dispatch_previewed:${input.taskId}:${Date.now()}`,
  });

  return result;
}
