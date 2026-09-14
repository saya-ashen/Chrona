/* eslint-disable complexity -- Exhaustive domain-action routing keeps scope guards adjacent to dispatch. */
import { db } from "@/lib/db";
import { executionActionBodySchema, type ManagementAction } from "@chrona/contracts/api";
import type { ManagementIdentity } from "./clients";
import type { ManagementDeps } from "./types";
import { ManagementError } from "./errors";
import { assertRevision, record, requireScopes, scopedTask } from "./reads";
import { resolveExecutionScope } from "../plan-execution/persistence/execution-scope";

export function actionScopes(input: ManagementAction): string[] {
  switch (input.action.type) {
    case "generate_plan": case "stop_plan_generation": case "accept_plan": case "patch_plan": return ["plans:write"];
    case "execution": case "checkpoint": case "provider_approval": case "retry_result": return ["executions:control"];
    case "follow_up": return ["executions:control", ...(input.action.intent === "create_task" ? ["tasks:write"] : [])];
    case "accept_result": case "complete": return ["results:accept"];
    case "schedule_proposal": return ["schedule:write"];
    case "reopen": case "manual_complete": case "manual_reopen": return ["tasks:write"];
  }
}
export function isManagementControlAction(input: ManagementAction) {
  return input.action.type === "stop_plan_generation" || (input.action.type === "execution" && ["pause_session", "cancel_session"].includes(String(input.action.input.action)));
}
export function actionIsAsync(input: ManagementAction) {
  return ["generate_plan", "stop_plan_generation", "execution", "checkpoint", "provider_approval", "follow_up", "retry_result"].includes(input.action.type);
}
export async function validateManagementAction(client: ManagementIdentity, input: ManagementAction) {
  requireScopes(client, actionScopes(input));
  await scopedTask(client, input.taskId, input.workBlockId);
  const scope = await resolveExecutionScope(input.taskId, { workBlockId: input.workBlockId });
  const action = input.action;
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId }, select: { taskExecutionMode: true, configRevision: true } });
  if (task.taskExecutionMode === "manual" && !["manual_complete", "manual_reopen", "schedule_proposal"].includes(action.type)) {
    throw new ManagementError("VALIDATION_ERROR", "Manual tasks cannot use AI planning or execution actions");
  }
  if ((action.type === "manual_complete" || action.type === "manual_reopen") && task.taskExecutionMode !== "manual") {
    throw new ManagementError("VALIDATION_ERROR", "Manual lifecycle actions require a manual task");
  }
  if (action.type === "manual_complete" || action.type === "manual_reopen") {
    assertRevision(task, action.expectedRevision);
  }
  if (action.type === "execution" || action.type === "checkpoint" || action.type === "retry_result") {
    const current = await db.taskPlanRun.findFirst({ where: { taskId: input.taskId, workBlockId: scope.workBlockId, ...(scope.planId ? { planId: scope.planId } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
    if ((current?.executionScopeId ?? null) !== action.expectedExecutionScope) throw new ManagementError("REVISION_CONFLICT", "Execution scope changed; read the task before acting");
    if (action.type === "execution") {
      for (const key of ["providerRunId", "runtimeRunRef", "expectedAttemptId", "sessionId"]) {
        if (record(action.input)[key] !== undefined) throw new ManagementError("VALIDATION_ERROR", `${key} is execution-owned context`);
      }
      if (action.input.workBlockId !== undefined && action.input.workBlockId !== scope.workBlockId) throw new ManagementError("VALIDATION_ERROR", "Specify the selected work block on the outer action");
      executionActionBodySchema.parse({ ...action.input, idempotencyKey: input.requestId });
    }
  }
  if (action.type === "patch_plan") {
    for (const node of [...(action.patch.nodes ?? []), ...(action.patch.nodePatches ?? [])]) {
      const linkedTaskId = node.linkedTaskId;
      if (linkedTaskId !== undefined && linkedTaskId !== null) {
        if (typeof linkedTaskId !== "string" || linkedTaskId.length > 128) throw new ManagementError("VALIDATION_ERROR", "Invalid linked task reference");
        await scopedTask(client, linkedTaskId);
      }
    }
  }
  if (action.type === "follow_up" && !await db.event.findFirst({ where: { taskId: input.taskId, runId: action.runId, eventType: "task.result_accepted" } })) throw new ManagementError("NOT_FOUND", "Accepted result not found");
  if (action.type === "accept_plan" && !await db.taskPlan.findFirst({ where: { taskId: input.taskId, planId: action.planId, workBlockId: scope.workBlockId } })) throw new ManagementError("NOT_FOUND", "Plan not found in the selected scope");
  if ((action.type === "accept_result" || action.type === "complete") && !await db.run.findFirst({ where: { id: action.runId, taskId: input.taskId, workBlockId: scope.workBlockId } })) throw new ManagementError("NOT_FOUND", "Run not found in the selected scope");
  if (action.type === "schedule_proposal" && !await db.scheduleProposal.findFirst({ where: { id: action.proposalId, taskId: input.taskId, workspaceId: client.workspaceId } })) throw new ManagementError("NOT_FOUND", "Schedule proposal not found");
  if (action.type === "provider_approval" && !await db.taskPlanProviderApproval.findFirst({ where: { id: action.approvalId, taskId: input.taskId, planRun: { executionScopeId: action.input.executionScope, workBlockId: scope.workBlockId } } })) throw new ManagementError("NOT_FOUND", "Approval not found in the selected scope");
  return scope;
}
export async function runManagementAction(client: ManagementIdentity, input: ManagementAction, deps: ManagementDeps, key: string) {
  const scope = await validateManagementAction(client, input);
  const base = { taskId: input.taskId, workBlockId: scope.workBlockId };
  const action = input.action;
  switch (action.type) {
    case "stop_plan_generation": return deps.plan.stopGeneration(base);
    case "accept_plan": return deps.plan.accept({ ...base, workspaceId: client.workspaceId, planId: action.planId, expectedHeadStateVersion: action.expectedHeadStateVersion, idempotencyKey: key });
    case "patch_plan": return deps.plan.patch({ ...action.patch, ...base, idempotencyKey: key });
    case "follow_up": return deps.result.continueFromResult({ taskId: input.taskId, expectedAcceptedRunId: action.runId, requestId: key, intent: action.intent, instruction: action.instruction, sessionStrategy: action.sessionStrategy });
    case "retry_result": return deps.result.retryFinalization(base);
    case "accept_result": return deps.result.accept({ taskId: input.taskId, expectedRunId: action.runId });
    case "complete": return deps.lifecycle.complete({ taskId: input.taskId, expectedRunId: action.runId });
    case "reopen": return deps.lifecycle.reopen({ taskId: input.taskId });
    case "manual_complete": return deps.tasks.completeManual({ taskId: input.taskId, workspaceId: client.workspaceId, expectedRevision: action.expectedRevision, requestId: key });
    case "manual_reopen": return deps.tasks.reopenManual({ taskId: input.taskId, workspaceId: client.workspaceId, expectedRevision: action.expectedRevision, requestId: key });
    case "schedule_proposal": return deps.schedule.decideProposal({ proposalId: action.proposalId, decision: action.decision, resolutionNote: action.note });
    case "execution": {
      const session = await db.executionSession.findFirst({ where: { taskId: input.taskId, workBlockId: scope.workBlockId, status: { in: ["Active", "Paused"] } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
      const parsed = executionActionBodySchema.parse({ ...action.input, idempotencyKey: key });
      // Public schema validates generated:// and AF refs; their template-literal
      // types are narrower than Zod's inferred strings (same boundary as HTTP).
      const executionAction = { ...parsed, workBlockId: scope.workBlockId ?? undefined } as Parameters<ManagementDeps["execution"]["dispatch"]>[0]["action"];
      return deps.execution.dispatch({ taskId: input.taskId, action: executionAction, commandContext: { sessionId: session?.id, actor: { type: "agent", actorId: client.id }, origin: { channel: "mcp_tool", requestId: key } } });
    }
    case "checkpoint": return deps.execution.submitCheckpointAction({ taskId: input.taskId, action: { ...action.input, checkpointId: action.checkpointId, workBlockId: scope.workBlockId, idempotencyKey: key } });
    case "provider_approval": {
      const planRun = await db.taskPlanRun.findUniqueOrThrow({ where: { executionScopeId: action.input.executionScope } });
      const result = await deps.execution.resolveProviderApproval({ ...base, approvalId: action.approvalId, planRunId: planRun.id, choice: action.input.choice, resolveAll: action.input.resolveAll, note: action.input.note, idempotencyKey: key });
      return { status: result.status, resolved: result.resolved };
    }
    case "generate_plan": throw new ManagementError("INTERNAL_ERROR", "Plan generation is handled by the durable worker");
  }
}
