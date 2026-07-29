import { db } from "@/lib/db";
import { RunStatus } from "@/generated/prisma/client";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  PlanExecutionResult,
  WaitKind,
} from "@chrona/contracts/ai";
import { executionStatusFromEffectiveGraph } from "../execution-state-machine";
import { ensurePlanMainSession } from "../persistence/plan-state-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { currentNodeFromEffective } from "../projection/execution-graph-selectors";
import { buildExecutionResponse } from "../projection/execution-response";

const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
] as const;


export function hasExecutionEvidence(effective: EffectivePlanGraph) {
  return effective.completedNodeIds.length > 0
    || effective.failedNodeIds.length > 0
    || effective.blockedNodeIds.length > 0
    || effective.runningNodeIds.length > 0
    || effective.nodes.some((node) => node.status === "waiting_for_user" || node.status === "waiting_for_approval");
}

export function currentExecutionStatusFromEffectiveGraph(input: {
  effective: EffectivePlanGraph;
  hasActiveExecutionSession: boolean;
  activeRunStatus?: RunStatus;
  taskStatus?: string;
  pauseReason?: WaitKind | null;
}) {
  if (input.taskStatus === "Cancelled") return "cancelled";
  if (
    input.taskStatus === "WaitingForInput" ||
    input.activeRunStatus === RunStatus.WaitingForInput ||
    input.pauseReason === "user_input"
  ) return "waiting_for_user";
  if (
    input.taskStatus === "WaitingForApproval" ||
    input.activeRunStatus === RunStatus.WaitingForApproval ||
    input.pauseReason === "approval" ||
    input.pauseReason === "review" ||
    input.pauseReason === "replan_required"
  ) return "waiting_for_approval";
  if (hasExecutionEvidence(input.effective)) {
    return executionStatusFromEffectiveGraph(input.effective);
  }
  if (input.activeRunStatus === RunStatus.Pending || input.activeRunStatus === RunStatus.Running) return "running";
  if (input.hasActiveExecutionSession) return executionStatusFromEffectiveGraph(input.effective);
  if (input.activeRunStatus !== undefined) return executionStatusFromEffectiveGraph(input.effective);
  return "started";
}
export async function getCurrentExecution(input: { taskId: string; workBlockId?: string | null }): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId, input.workBlockId ?? null);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const executionSession = await db.executionSession.findFirst({
    where: {
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      planId: runtime.planId,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const latestRunPointer = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { latestRunId: true, status: true },
  });
  const activeRun = latestRunPointer.latestRunId
    ? await db.run.findFirst({
        where: {
          id: latestRunPointer.latestRunId,
          taskId: input.taskId,
          workBlockId: input.workBlockId ?? null,
          status: { in: [...ACTIVE_RUN_STATUSES] },
        },
      })
    : null;
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });
  const effective = resolveEffectivePlanGraph({
    graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  }) as unknown as EffectivePlanGraph;
  const hasActiveExecutionSession = Boolean(executionSession);
  const status = currentExecutionStatusFromEffectiveGraph({
    effective,
    hasActiveExecutionSession,
    activeRunStatus: activeRun?.status,
    taskStatus: latestRunPointer.status,
    pauseReason: executionSession?.pauseReason as WaitKind | null | undefined,
  });
  const currentNodeId = currentNodeFromEffective(effective)?.id
    ?? (!hasActiveExecutionSession && status === "started" ? effective.readyNodeIds[0] : null)
    ?? executionSession?.currentNodeId
    ?? null;

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: runtime.planId,
    mainSessionId: mainSession.id,
    executionSessionId: executionSession?.id,
    planRunId: executionSession || activeRun ? runtime.persisted.id : undefined,
    status,
    effective,
    currentNodeId,
    executedNodeIds: effective.completedNodeIds,
    message: executionSession ? "Current execution state." : "No active execution session.",
    waitKind: executionSession?.pauseReason as WaitKind | undefined,
    planOutput: {
      manifest: runtime.persisted.planOutput.manifest,
      finalizedResult: runtime.persisted.planOutput.finalizedResult,
      finalization: runtime.persisted.planOutput.finalization,
      revision: runtime.persisted.planOutput.revision,
      updatedAt: runtime.persisted.planOutput.updatedAt,
      updatedByNodeId: runtime.persisted.planOutput.updatedByNodeId,
    },
  });
}
