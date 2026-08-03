import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ExecutionCommandContext,
  ExecutionCommandEnvelope,
  PlanExecutionResult,
} from "@chrona/contracts/ai";
import { dispatchExecutionCommand } from "./execute-command-dispatch";
import { initializeExecutionCommand } from "./execute-command-restart";
import { setupExecutionCommand } from "./execute-command-setup";
import type { PlanExecutionObserver } from "./kernel-types";
import { completePlanRunCommandReceipt, renewPlanRunCommandReceipt, type ClaimedPlanRunCommand } from "../persistence/plan-run-store";
import { isAuthoritativeExecutionResult } from "./command-receipts";
import type { SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";
import { getCurrentExecution } from "../use-cases/get-current-execution";







const taskCommandTails = new Map<string, Promise<void>>();
const activeTaskCommands = new AsyncLocalStorage<ReadonlySet<string>>();

const COMMAND_RECEIPT_RENEW_INTERVAL_MS = 10_000;

function maintainCommandReceiptLease(receipt: ClaimedPlanRunCommand) {
  let stopped = false;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending
      .then(async () => {
        if (!stopped) await renewPlanRunCommandReceipt(receipt);
      })
      .catch(() => undefined);
  }, COMMAND_RECEIPT_RENEW_INTERVAL_MS);
  timer.unref?.();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}

async function completeCommandReceipt(receipt: ClaimedPlanRunCommand, result: PlanExecutionResult): Promise<PlanExecutionResult> {
  if (!isAuthoritativeExecutionResult(result)) return result;
  const completed = await completePlanRunCommandReceipt({
    planRunId: receipt.planRunId,
    commandKey: receipt.commandKey,
    commandDigest: receipt.commandDigest,
    canonicalizer: receipt.canonicalizer,
    canonicalizerVersion: receipt.canonicalizerVersion,
    claimedEpoch: receipt.claimedEpoch,
    leaseOwnerId: receipt.leaseOwnerId,
    claimVersion: receipt.claimVersion,
    result,
  });
  if (!completed) return getCurrentExecution({ taskId: result.taskId, workBlockId: receipt.workBlockId });
  return result;
}

export async function executeCommand(
  input: ExecutionCommandEnvelope & PlanExecutionObserver & { workContext?: SchedulerWorkContext },
): Promise<PlanExecutionResult> {
  const activeTaskIds = activeTaskCommands.getStore();
  if (activeTaskIds?.has(input.taskId)) {
    return executeCommandUnlocked(input);
  }

  const previous = taskCommandTails.get(input.taskId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  taskCommandTails.set(input.taskId, tail);
  await previous;
  try {
    const nextActiveTaskIds = new Set(activeTaskIds);
    nextActiveTaskIds.add(input.taskId);
    return await activeTaskCommands.run(nextActiveTaskIds, () => executeCommandUnlocked(input));
  } finally {
    release();
    if (taskCommandTails.get(input.taskId) === tail) {
      taskCommandTails.delete(input.taskId);
    }
  }
}

async function executeCommandUnlocked(
  input: ExecutionCommandEnvelope & PlanExecutionObserver & { workContext?: SchedulerWorkContext },
): Promise<PlanExecutionResult> {
  const { taskId, command } = input;
  const context: ExecutionCommandContext = input.context ?? {};
  const setup = await setupExecutionCommand({ taskId, command, context, workContext: input.workContext });
  if (setup.kind === "result") {
    return setup.commandReceipt ? completeCommandReceipt(setup.commandReceipt, setup.result) : setup.result;
  }
  const stopMaintainingReceipt = maintainCommandReceiptLease(setup.prepared.commandReceipt);
  try {
    const initializationResult = await initializeExecutionCommand({
      taskId,
      command,
      trigger: setup.prepared.trigger,
      prepared: setup.prepared,
    });
    return initializationResult ?? await dispatchExecutionCommand({
      taskId,
      command,
      context,
      observer: input,
      prepared: setup.prepared,
    });
  } finally {
    await stopMaintainingReceipt();
  }
}
