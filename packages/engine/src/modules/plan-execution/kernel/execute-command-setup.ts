import { db } from "@/lib/db";
import type {
  ExecutionCommandContext,
  ExecutionCommandEnvelope,
  ExecutionTrigger,
  PlanExecutionResult,
} from "@chrona/contracts/ai";
import { ensureExecutionSession } from "../persistence/execution-session-store";
import { ensurePlanMainSession } from "../persistence/plan-state-store";
import { claimPlanRunCommand, type ClaimedPlanRunCommand } from "../persistence/plan-run-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { getRuntimeName } from "../persistence/task-runtime-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { frozenGoalContext } from "./execute-command-goal-context";
import { withSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";
import { withPlanExecutionDurability } from "../persistence/scheduler-durability";
import { executionCommandDigest, markAuthoritativeExecutionResult } from "./command-receipts";

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
  commandReceipt: ClaimedPlanRunCommand;
};

export type CommandSetupResult =
  | { kind: "result"; result: PlanExecutionResult; commandReceipt?: ClaimedPlanRunCommand }
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

async function requestedWorkBlockScope(
  taskId: string,
  command: Command,
  context: ExecutionCommandContext,
): Promise<{ workBlockId?: string | null; resolveScope: boolean } | null> {
  if (Object.hasOwn(context, "workBlockId")) {
    return { workBlockId: context.workBlockId ?? null, resolveScope: false };
  }
  if (context.sessionId) {
    const session = await db.executionSession.findFirst({
      where: { id: context.sessionId, taskId },
      select: { workBlockId: true },
    });
    if (session) return { workBlockId: session.workBlockId, resolveScope: false };
  }
  if (isInitialCommand(command)) return { resolveScope: true };
  return null;
}

async function claimRuntimeCommand(input: {
  taskId: string;
  runtime: Runtime;
  workBlockId: string | null;
  command: Command;
  context: ExecutionCommandContext;
  workContext?: SchedulerWorkContext;
}): Promise<"already_active" | "lost" | { status: "claimed"; receipt: ClaimedPlanRunCommand } | { status: "replayed"; result: PlanExecutionResult } | { status: "in_flight" }> {
  const expectedEpoch = input.runtime.persisted.executionEpoch;
  const commandKey = input.context.idempotencyKey ?? crypto.randomUUID();
  const commandDigest = executionCommandDigest({ command: input.command, context: input.context });
  const claim = async (tx: NonNullable<Parameters<typeof claimPlanRunCommand>[1]>) => {
    if (input.command.type === "start") {
      const activeExecution = await activeInitialExecution({
        taskId: input.taskId,
        planId: input.runtime.planId,
        workBlockId: input.workBlockId,
        command: input.command,
      }, tx);
      if (activeExecution) return "already_active" as const;
      const inFlightCurrentEpoch = await tx.taskPlanCommandReceipt.findFirst({
        where: {
          planRunId: input.runtime.persisted.id,
          executionEpoch: expectedEpoch,
          status: "claimed",
          leaseExpiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (inFlightCurrentEpoch) return "already_active" as const;
    }
    if (input.command.type === "retry_node") {
      const locked = await tx.taskPlanRun.updateMany({
        where: {
          taskId: input.taskId,
          planId: input.runtime.planId,
          workBlockScopeKey: input.workBlockId ?? "",
          executionEpoch: expectedEpoch,
        },
        data: { executionEpoch: expectedEpoch },
      });
      if (locked.count !== 1) return "lost" as const;
      const active = await tx.taskPlanProviderRun.findFirst({
        where: {
          taskId: input.taskId,
          planId: input.runtime.planId,
          status: { in: ["running", "waiting_for_approval"] },
          nodeAttempt: {
            nodeId: input.command.nodeId,
            planRun: { workBlockId: input.workBlockId },
          },
        },
        select: { id: true, status: true },
      });
      if (active) {
        const activeClaim = await tx.taskPlanProviderRun.updateMany({
          where: { id: active.id, status: active.status },
          data: { status: active.status },
        });
        if (activeClaim.count === 1) return "already_active" as const;
      }
    }
    const claimed = await claimPlanRunCommand({
      taskId: input.taskId,
      planId: input.runtime.planId,
      workBlockId: input.workBlockId,
      expectedEpoch,
      commandKey,
      commandDigest,
    }, tx);
    if (!claimed) return "lost" as const;
    if (claimed.status === "replayed") return { status: "replayed" as const, result: claimed.result };
    if (claimed.status === "in_flight") return { status: "in_flight" as const };
    return { status: "claimed" as const, receipt: claimed };
  };
  const outcome = input.workContext
    ? await withSchedulerWorkOwnership(input.workContext, claim)
    : await withPlanExecutionDurability(claim);
  if (typeof outcome === "object" && outcome.status === "claimed") input.runtime.persisted.executionEpoch = Math.max(input.runtime.persisted.executionEpoch, outcome.receipt.claimedEpoch);
  return outcome;
}

async function activeInitialExecution(input: {
  taskId: string;
  planId: string;
  workBlockId: string | null;
  command: Command;
}, tx: NonNullable<Parameters<typeof claimPlanRunCommand>[1]>) {
  if (input.command.type !== "start") return false;
  const session = await tx.executionSession.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.planId,
      workBlockId: input.workBlockId,
      status: { in: ["Active", "Paused"] },
    },
    select: { currentNodeId: true },
  });
  if (!session?.currentNodeId) return false;
  const activeAttempt = await tx.taskPlanNodeAttempt.findFirst({
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
  workBlockId: string | null;
}): Promise<PlanExecutionResult | null> {
  const { taskId, command, workBlockId } = input;
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
  workContext?: SchedulerWorkContext;
}): Promise<CommandSetupResult> {
  const { taskId, command, context } = input;
  const trigger: ExecutionTrigger = context.trigger ?? (isInitialCommand(command) ? command.trigger : "manual");
  const workBlockScope = await requestedWorkBlockScope(taskId, command, context);
  if (!workBlockScope) return { kind: "result", result: noPlanResponse(taskId, context.sessionId) };
  const runtime = await ensureNativePlanRun(taskId, workBlockScope.workBlockId, { resolveScope: workBlockScope.resolveScope });
  if (!runtime) return { kind: "result", result: noPlanResponse(taskId, context.sessionId) };
  const executionWorkBlockId = runtime.workBlockId;
  const claimOutcome = await claimRuntimeCommand({ taskId, runtime, workBlockId: executionWorkBlockId, command, context, workContext: input.workContext });
  if (claimOutcome === "already_active" || claimOutcome === "lost" || (typeof claimOutcome === "object" && claimOutcome.status === "in_flight")) {
    return { kind: "result", result: await getCurrentExecution({ taskId, workBlockId: executionWorkBlockId }) };
  }
  if (claimOutcome.status === "replayed") return { kind: "result", result: claimOutcome.result };
  const handled = await commandAlreadyHandled({ taskId, command, workBlockId: executionWorkBlockId });
  if (handled) return { kind: "result", result: markAuthoritativeExecutionResult(handled), commandReceipt: claimOutcome.receipt };

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
      commandReceipt: claimOutcome.receipt,
    },
  };
}
