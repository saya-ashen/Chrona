import { db } from "@/lib/db";
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
}) {
  return input.hasActiveExecutionSession || hasExecutionEvidence(input.effective)
    ? executionStatusFromEffectiveGraph(input.effective)
    : "started";
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
      planOutput: { spec: null, revision: 0, updatedAt: null, updatedByNodeId: null },
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
    planRunId: executionSession ? runtime.planId : undefined,
    status,
    effective,
    currentNodeId,
    executedNodeIds: effective.completedNodeIds,
    message: executionSession ? "Current execution state." : "No active execution session.",
    waitKind: executionSession?.pauseReason as WaitKind | undefined,
    planOutput: {
      spec: runtime.persisted.planOutput.spec,
      revision: runtime.persisted.planOutput.revision,
      updatedAt: runtime.persisted.planOutput.updatedAt,
      updatedByNodeId: runtime.persisted.planOutput.updatedByNodeId,
    },
  });
}
