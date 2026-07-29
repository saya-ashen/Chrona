import { db } from "@/lib/db";
import type {
  ExecutionCommandContext,
  ExecutionCommandEnvelope,
  ExecutionTrigger,
  PlanExecutionResult,
} from "@chrona/contracts/ai";
import { abandonActiveExecutionSessions, ensureExecutionSession, getActiveExecutionWorkBlockId } from "../persistence/execution-session-store";
import { ensurePlanMainSession } from "../persistence/plan-state-store";
import { claimPlanRunCommand } from "../persistence/plan-run-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { getRuntimeName } from "../persistence/task-runtime-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { frozenGoalContext } from "./execute-command-goal-context";

type Command = ExecutionCommandEnvelope["command"];
type Runtime = NonNullable<Awaited<ReturnType<typeof ensureNativePlanRun>>>;

export type PreparedCommandExecution = {
  trigger: ExecutionTrigger;
  runtime: Runtime;
  goalContext: ReturnType<typeof frozenGoalContext>;
  workBlockId: string | null;
  session: Awaited<ReturnType<typeof ensureExecutionSession>>;
  mainSession: Awaited<ReturnType<typeof ensurePlanMainSession>>;
  runtimeName: Awaited<ReturnType<typeof getRuntimeName>>;
  existingContextSession: { id: string } | null;
  contextSessionId: string | undefined;
};

export type CommandSetupResult =
  | { kind: "result"; result: PlanExecutionResult }
  | { kind: "ready"; prepared: PreparedCommandExecution };

function noPlanResponse(taskId: string, sessionId?: string | null): PlanExecutionResult {
  return {
    taskId,
    planId: null,
    mainSessionId: sessionId ?? null,
    status: "no_plan",
    currentNodeId: null,
    executedNodeIds: [],
    waitingNodeIds: [],
    blockedNodeIds: [],
    checkpoint: null,
    message: "No accepted plan. Create or accept a plan before execution.",
  };
}

function isInitialCommand(command: Command) {
  return command.type === "start" || command.type === "restart_from_beginning";
}

async function requestedWorkBlockId(taskId: string, command: Command, context: ExecutionCommandContext) {
  if (isInitialCommand(command)) return context.workBlockId ?? null;
  return context.workBlockId ?? await getActiveExecutionWorkBlockId(taskId);
}

async function claimRuntimeCommand(input: {
  taskId: string;
  runtime: Runtime;
  workBlockId: string | null;
  context: ExecutionCommandContext;
}) {
  const claimed = await claimPlanRunCommand({
    taskId: input.taskId,
    planId: input.runtime.planId,
    workBlockId: input.workBlockId,
    expectedEpoch: input.runtime.persisted.executionEpoch,
    commandKey: input.context.idempotencyKey ?? crypto.randomUUID(),
  });
  if (claimed) input.runtime.persisted.executionEpoch += 1;
  return claimed;
}

async function activeInitialExecution(input: {
  taskId: string;
  planId: string;
  workBlockId: string | null;
  command: Command;
}) {
  if (input.command.type !== "start") return false;
  const session = await db.executionSession.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId,
      status: { in: ["Active", "Paused"] },
    },
    select: { currentNodeId: true },
  });
  if (!session?.currentNodeId) return false;
  const activeAttempt = await db.taskPlanNodeAttempt.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.planId,
      nodeId: session.currentNodeId,
      status: "running",
      planRun: { workBlockId: input.workBlockId },
    },
    select: { id: true },
  });
  return activeAttempt !== null;
}

async function commandAlreadyHandled(input: {
  taskId: string;
  command: Command;
  runtime: Runtime;
  workBlockId: string | null;
}): Promise<PlanExecutionResult | null> {
  const { taskId, command, runtime, workBlockId } = input;
  if (command.type === "retry_node") {
    const active = await db.taskPlanProviderRun.findFirst({
      where: {
        taskId,
        planId: runtime.planId,
        status: { in: ["running", "waiting_for_approval"] },
        nodeAttempt: { nodeId: command.nodeId },
      },
      select: { id: true },
    });
    if (active) return getCurrentExecution({ taskId, workBlockId });
  }
  if (command.type !== "submit_node_result") return null;
  const current = await getCurrentExecution({ taskId, workBlockId });
  if (current.status !== "completed" && current.status !== "cancelled") return null;
  return { ...current, message: "Execution already completed; node result ignored." };
}

async function establishCommandSession(input: {
  taskId: string;
  command: Command;
  context: ExecutionCommandContext;
  runtime: Runtime;
  trigger: ExecutionTrigger;
  workBlockId: string | null;
}) {
  const contextSessionId = input.context.sessionId ?? undefined;
  const existingContextSession = contextSessionId
    ? await db.executionSession.findUnique({ where: { id: contextSessionId }, select: { id: true } })
    : null;
  if (input.command.type === "restart_from_beginning") {
    await abandonActiveExecutionSessions({ taskId: input.taskId, reason: "Plan restarted from beginning" });
  }
  const session = await ensureExecutionSession({
    workspaceId: input.runtime.workspaceId,
    taskId: input.taskId,
    planId: input.runtime.planId,
    trigger: input.trigger,
    workBlockId: input.workBlockId,
    sessionId: input.command.type === "restart_from_beginning" ? undefined : existingContextSession?.id,
  });
  return { contextSessionId, existingContextSession, session };
}

export async function setupExecutionCommand(input: {
  taskId: string;
  command: Command;
  context: ExecutionCommandContext;
}): Promise<CommandSetupResult> {
  const { taskId, command, context } = input;
  const trigger: ExecutionTrigger = context.trigger ?? (isInitialCommand(command) ? command.trigger : "manual");
  const workBlockId = await requestedWorkBlockId(taskId, command, context);
  const runtime = await ensureNativePlanRun(taskId, workBlockId);
  if (!runtime) return { kind: "result", result: noPlanResponse(taskId, context.sessionId) };
  const executionWorkBlockId = runtime.workBlockId;
  if (await activeInitialExecution({ taskId, planId: runtime.planId, workBlockId: executionWorkBlockId, command })) {
    return { kind: "result", result: await getCurrentExecution({ taskId, workBlockId: executionWorkBlockId }) };
  }
  if (!await claimRuntimeCommand({ taskId, runtime, workBlockId: executionWorkBlockId, context })) {
    return { kind: "result", result: await getCurrentExecution({ taskId, workBlockId: executionWorkBlockId }) };
  }
  const handled = await commandAlreadyHandled({ taskId, command, runtime, workBlockId: executionWorkBlockId });
  if (handled) return { kind: "result", result: handled };

  const { contextSessionId, existingContextSession, session } = await establishCommandSession({
    taskId,
    command,
    context,
    runtime,
    trigger,
    workBlockId: executionWorkBlockId,
  });
  const [mainSession, runtimeName, task] = await Promise.all([
    ensurePlanMainSession({ taskId, planId: runtime.planId }),
    getRuntimeName(taskId),
    db.task.findUniqueOrThrow({ where: { id: taskId }, select: { goalContext: true } }),
  ]);
  return {
    kind: "ready",
    prepared: {
      trigger,
      runtime,
      goalContext: frozenGoalContext(task.goalContext),
      workBlockId: executionWorkBlockId,
      session,
      mainSession,
      runtimeName,
      existingContextSession,
      contextSessionId,
    },
  };
}
