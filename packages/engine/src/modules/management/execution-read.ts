import { db } from "@/lib/db";
import type { EffectivePlanGraph, WaitKind } from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { getPlanRun } from "../plan-execution/persistence/plan-run-store";
import { currentExecutionStatusFromEffectiveGraph } from "../plan-execution/use-cases/get-current-execution";
import { currentNodeFromEffective } from "../plan-execution/projection/execution-graph-selectors";
import { buildExecutionResponse } from "../plan-execution/projection/execution-response";

/** Read-only projection of an existing run; unlike execution.current this never
 * creates a run/session, repairs persistence, or invokes a provider. */
export async function readExistingExecution(input: { taskId: string; planId: string; workBlockId: string | null; taskStatus: string }) {
  const persisted = await getPlanRun(input.taskId, input.planId, input.workBlockId);
  if (!persisted?.graph) return null;
  const [session, activeRun] = await Promise.all([
    db.executionSession.findFirst({ where: { taskId: input.taskId, planId: input.planId, workBlockId: input.workBlockId, status: { in: ["Active", "Paused"] } }, orderBy: { updatedAt: "desc" } }),
    db.run.findFirst({ where: { taskId: input.taskId, id: `plan_execution_${persisted.id}`, status: { in: ["Pending", "Running", "WaitingForApproval", "WaitingForInput"] } }, select: { status: true } }),
  ]);
  const effective = resolveEffectivePlanGraph({ graph: persisted.graph, attempts: persisted.attempts, results: persisted.results }) as unknown as EffectivePlanGraph;
  const status = currentExecutionStatusFromEffectiveGraph({ effective, hasActiveExecutionSession: Boolean(session), activeRunStatus: activeRun?.status, taskStatus: input.taskStatus, pauseReason: session?.pauseReason as WaitKind | null });
  return buildExecutionResponse({ taskId: input.taskId, planId: input.planId, mainSessionId: "", executionSessionId: session?.id, planRunId: persisted.id, status, effective, currentNodeId: currentNodeFromEffective(effective)?.id ?? session?.currentNodeId ?? null, executedNodeIds: effective.completedNodeIds, message: "Current execution state.", waitKind: session?.pauseReason as WaitKind | undefined });
}
