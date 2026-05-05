import { aiDispatchTask } from "@/modules/ai/ai-service";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { db } from "@/lib/db";
import { getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getLayers } from "@/modules/plan-execution/plan-run-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
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

  const accepted = await getAcceptedCompiledPlan(input.taskId);
  if (!accepted) {
    throw new Error(`No accepted plan found for task ${input.taskId}`);
  }

  const layers = await getLayers(input.taskId, accepted.planId);
  const effective = resolveEffectivePlanGraph(accepted.compiledPlan, layers);

  const linkedTasks = effective.nodes
    .filter((n) => n.linkedTaskId)
    .map((n) => ({
      taskId: n.linkedTaskId!,
      nodeId: n.localId ?? n.id,
      status: n.status,
      title: n.title,
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

  const blockers = effective.nodes
    .filter((n) => n.status === "blocked" || n.status === "waiting_for_user")
    .map((n) => ({
      id: n.localId ?? n.id,
      type: n.status,
      reason: n.blockedReason ?? "unknown",
    }));

  // Build a summary of the plan for AI dispatch
  const planSummary = {
    planId: accepted.planId,
    nodes: effective.nodes.map((n) => ({
      id: n.localId ?? n.id,
      title: n.title,
      type: n.type,
      status: n.status,
    })),
    readyNodeIds: effective.readyNodeIds,
  };

  const result = await aiDispatchTask({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    acceptedPlan: planSummary as unknown as import("@chrona/contracts/ai").TaskPlanGraph,
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
