import { runGraphExecution } from "../execution/run-graph-execution";
import { createRegistryExecutor } from "../registry/executor-registry";
import type { GraphExecutionCallbacks } from "../types/callbacks";
import type { GraphExecutionEvent } from "../types/events";
import { approveCurrentNodeCommand } from "../commands/approve-current-node";
import { applyMutationCommand } from "../commands/apply-mutation";
import { cancelSessionCommand } from "../commands/cancel-session";
import { pauseSessionCommand } from "../commands/pause-session";
import { retryNodeCommand } from "../commands/retry-node";
import { submitNodeResultCommand } from "../commands/submit-node-result";
import { validateCommandGraphState } from "../commands/validate-command";
import type { GraphRuntime, GraphRuntimeOptions } from "../commands/types";

export function createGraphRuntime<TContext = unknown>(
  options: GraphRuntimeOptions<TContext>,
): GraphRuntime<TContext> {
  return {
    async dispatch(command) {
      const events: GraphExecutionEvent[] = [
        { type: "command_received", command },
      ];
      if (options.policies?.validateGraph !== false) {
        const validationFailure = validateCommandGraphState({
          command,
          state: command.state,
          events,
        });
        if (validationFailure) {
          return validationFailure;
        }
      }
      const callbacks: GraphExecutionCallbacks<TContext> = {
        executeNode: createRegistryExecutor(options),
        resolveSubmittedNodeState: options.callbacks?.resolveSubmittedNodeState,
        onStateChange: options.callbacks?.onStateChange,
        onEvent: async (event) => {
          events.push(event);
          await options.callbacks?.onEvent?.(event);
        },
      };

      switch (command.type) {
        case "start": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger,
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            control: options.control,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_with_input": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.input.nodeId,
            userInput: command.input.value,
            inputFields: command.input.fields,
            forcedReplaceStatus: command.input.replaceStatus,
            control: options.control,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_after_unblock": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.nodeId,
            control: options.control,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_with_approval":
          return approveCurrentNodeCommand({ command, options, callbacks, events });
        case "retry_node":
          return retryNodeCommand({ command, options, callbacks, events });
        case "cancel_session":
          return cancelSessionCommand({ command, options, events });
        case "pause_session":
          return pauseSessionCommand({ command, options, events });
        case "apply_mutation":
          return applyMutationCommand({ command, options, events });
        case "submit_node_result":
          return submitNodeResultCommand({ command, options, callbacks, events });
      }
    },
  };
}
