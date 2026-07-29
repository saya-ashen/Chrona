import { db } from "@/lib/db";
import type { ExecutionCommandEnvelope, ExecutionTrigger, PlanExecutionResult } from "@chrona/contracts/ai";
import { createEmptyPlanOutput, createPlanGraphFromCompiledPlan, savePlanRunGuarded } from "../persistence/plan-run-store";
import { createPlanRunFromCompiledPlan } from "../persistence/plan-runtime-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { cancelActiveRunsForTask } from "../persistence/task-execution-store";
import { activateWorkBlock } from "../persistence/work-block-store";
import { setExecutionSessionState } from "../persistence/execution-session-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import type { PreparedCommandExecution } from "./execute-command-setup";

export async function initializeExecutionCommand(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  trigger: ExecutionTrigger;
  prepared: PreparedCommandExecution;
}): Promise<PlanExecutionResult | null> {
  const { taskId, command, trigger, prepared } = input;
  const { runtime, session, mainSession } = prepared;
  if (command.type === "start" || command.type === "restart_from_beginning") {
    await activateWorkBlock(taskId, session.workBlockId);
    await appendMainSessionEvent({
      taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      workBlockId: session.workBlockId,
      eventType: "execution_started",
      payload: {
        trigger,
        prompt: command.prompt,
        executionEpoch: runtime.persisted.executionEpoch + (command.type === "restart_from_beginning" ? 1 : 0),
      },
    });
  }
  if (command.type !== "restart_from_beginning") return null;

  await cancelActiveRunsForTask(taskId, "Plan restarted from beginning");
  const resetGraph = createPlanGraphFromCompiledPlan({
    taskId,
    compiledPlan: runtime.compiledPlan,
    now: new Date().toISOString(),
  });
  const committed = await savePlanRunGuarded({
    workspaceId: runtime.workspaceId,
    taskId,
    planId: runtime.planId,
    expectedEpoch: runtime.persisted.executionEpoch,
    run: createPlanRunFromCompiledPlan(runtime.compiledPlan),
    compiledPlan: runtime.compiledPlan,
    graph: resetGraph,
    attempts: [],
    results: [],
    executionContextSnapshots: [],
    planOutput: createEmptyPlanOutput(),
  });
  if (!committed.committed) {
    return getCurrentExecution({ taskId, workBlockId: session.workBlockId });
  }
  await db.taskPlanProviderRun.updateMany({
    where: { taskId, planId: runtime.planId, status: { in: ["running", "waiting_for_approval"] } },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  runtime.persisted = {
    ...runtime.persisted,
    planRun: committed.planRun,
    graph: resetGraph,
    attempts: [],
    results: [],
    executionContextSnapshots: [],
    planOutput: createEmptyPlanOutput(),
    executionEpoch: runtime.persisted.executionEpoch + 1,
  };
  await setExecutionSessionState({
    sessionId: session.id,
    status: "Active",
    currentNodeId: null,
    currentNodeAttemptId: null,
    pauseReason: null,
    completedNodeIds: [],
  });
  return null;
}
