/* eslint-disable max-lines-per-function -- Restart construction preserves immutable attempt identity in one auditable transformation. */
import type { ExecutionCommandEnvelope, ExecutionTrigger, PlanExecutionResult } from "@chrona/contracts/ai";
import { createEmptyPlanOutput, createPlanGraphFromCompiledPlan, savePlanRunGuarded } from "../persistence/plan-run-store";
import { createPlanRunFromCompiledPlan } from "../persistence/plan-runtime-store";
import { abandonActiveExecutionSessions, ensureExecutionSession } from "../persistence/execution-session-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { ACTIVE_RUN_STATUSES } from "../persistence/task-execution-store";
import { activateWorkBlock } from "../persistence/work-block-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import type { PreparedCommandExecution } from "./execute-command-setup";
import { withPlanExecutionDurability } from "../persistence/scheduler-durability";

export async function initializeExecutionCommand(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  trigger: ExecutionTrigger;
  prepared: PreparedCommandExecution;
}): Promise<PlanExecutionResult | null> {
  const { taskId, command, trigger, prepared } = input;
  const { runtime, session, mainSession } = prepared;
  if (command.type === "start") {
    await withPlanExecutionDurability((tx) => appendMainSessionEvent({
      taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      workBlockId: session.workBlockId,
      eventType: "execution_started",
      payload: { trigger, prompt: command.prompt, executionEpoch: runtime.persisted.executionEpoch },
    }, tx));
    return null;
  }
  if (command.type !== "restart_from_beginning") return null;
  if (runtime.persisted.executionEpoch > prepared.commandReceipt.claimedEpoch) return null;

  const resetGraph = createPlanGraphFromCompiledPlan({
    taskId,
    compiledPlan: runtime.compiledPlan,
    now: new Date().toISOString(),
  });
  const committed = await withPlanExecutionDurability(async (tx) => {
    const saved = await savePlanRunGuarded({
      workspaceId: runtime.workspaceId,
      taskId,
      planId: runtime.planId,
      workBlockId: session.workBlockId,
      expectedEpoch: runtime.persisted.executionEpoch,
      run: createPlanRunFromCompiledPlan(runtime.compiledPlan),
      compiledPlan: runtime.compiledPlan,
      graph: resetGraph,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
      planOutput: createEmptyPlanOutput(),
    }, tx);
    if (!saved.committed) return { saved, replacementSession: null };

    const activeRuns = await tx.run.findMany({
      where: {
        taskId,
        taskSessionId: mainSession.id,
        workBlockId: session.workBlockId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
        occurrenceId: session.occurrenceId ?? null,
      },
      select: { id: true },
    });
    const activeRunIds = activeRuns.map((run) => run.id);
    if (activeRunIds.length > 0) {
      const now = new Date();
      await tx.run.updateMany({
        where: { id: { in: activeRunIds }, status: { in: [...ACTIVE_RUN_STATUSES] } },
        data: {
          status: "Cancelled",
          endedAt: now,
          errorSummary: "Plan restarted from beginning",
          retryable: false,
          resumeSupported: false,
          pendingInputPrompt: null,
          lastSyncedAt: now,
          syncStatus: "healthy",
          mappingPartial: false,
        },
      });
      await tx.runToken.updateMany({
        where: { runId: { in: activeRunIds }, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    const restartCommittedAt = new Date();
    await tx.taskPlanNodeAttempt.updateMany({
      where: { planRunId: runtime.persisted.id, status: "running" },
      data: { status: "cancelled", finishedAt: restartCommittedAt },
    });
    await tx.taskPlanProviderApproval.updateMany({
      where: {
        taskId,
        workBlockId: session.workBlockId,
        planRunId: runtime.persisted.id,
        status: "pending",
      },
      data: {
        status: "superseded",
        resolvedAt: restartCommittedAt,
        resolvedBy: "system",
        resolutionRaw: { resolution_source: "plan_restart" },
      },
    });
    await tx.taskPlanProviderRun.updateMany({
      where: {
        taskId,
        planId: runtime.planId,
        planRunId: runtime.persisted.id,
        status: { in: ["running", "waiting_for_approval"] },
      },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await abandonActiveExecutionSessions({
      taskId,
      workBlockId: session.workBlockId,
      reason: "Plan restarted from beginning",
    }, tx);
    const replacementSession = await ensureExecutionSession({
      workspaceId: runtime.workspaceId,
      taskId,
      planId: runtime.planId,
      trigger,
      workBlockId: session.workBlockId,
    }, tx);
    await activateWorkBlock(taskId, session.workBlockId, tx);
    await appendMainSessionEvent({
      taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      workBlockId: session.workBlockId,
      eventType: "execution_started",
      payload: { trigger, prompt: command.prompt, executionEpoch: runtime.persisted.executionEpoch + 1 },
    }, tx);
    return { saved, replacementSession };
  });
  if (!committed.saved.committed) {
    return getCurrentExecution({ taskId, workBlockId: session.workBlockId });
  }
  if (!committed.replacementSession) throw new Error("Restart session replacement was not committed");
  prepared.session = committed.replacementSession;
  runtime.persisted = {
    ...runtime.persisted,
    planRun: committed.saved.planRun,
    graph: resetGraph,
    attempts: [],
    results: [],
    executionContextSnapshots: [],
    planOutput: createEmptyPlanOutput(),
    executionEpoch: runtime.persisted.executionEpoch + 1,
  };
  return null;
}
