import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ExecutionCommandContext,
  ExecutionCommandEnvelope,
  PlanExecutionResult,
} from "@chrona/contracts/ai";
import { registerSubmitNodeResultDeliverables } from "./execute-command-deliverables";
import { dispatchExecutionCommand } from "./execute-command-dispatch";
import { initializeExecutionCommand } from "./execute-command-restart";
import { setupExecutionCommand } from "./execute-command-setup";
import type { PlanExecutionObserver } from "./kernel-types";





const taskCommandTails = new Map<string, Promise<void>>();
const activeTaskCommands = new AsyncLocalStorage<ReadonlySet<string>>();

export async function executeCommand(
  input: ExecutionCommandEnvelope & PlanExecutionObserver,
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
  input: ExecutionCommandEnvelope & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const { taskId, command } = input;
  const context: ExecutionCommandContext = input.context ?? {};
  const setup = await setupExecutionCommand({ taskId, command, context });
  if (setup.kind === "result") return setup.result;
  if (command.type === "submit_node_result") {
    await registerSubmitNodeResultDeliverables({
      runtime: setup.prepared.runtime,
      session: setup.prepared.session,
      command,
    });
  }
  const initializationResult = await initializeExecutionCommand({
    taskId,
    command,
    trigger: setup.prepared.trigger,
    prepared: setup.prepared,
  });
  return initializationResult ?? dispatchExecutionCommand({
    taskId,
    command,
    context,
    observer: input,
    prepared: setup.prepared,
  });
}
