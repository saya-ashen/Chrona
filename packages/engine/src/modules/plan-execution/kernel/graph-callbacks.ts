import type { GraphExecutionCallbacks } from "@chrona/graph-runtime";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { EngineRuntimeContext, PlanExecutionObserver } from "./kernel-types";
import { planExecutionNodeExecutors } from "../runtime/node-executor-registry";
import { markExecutionNodeActive } from "../persistence/task-execution-store";

/**
 * Kernel graph callbacks. Unlike the legacy callbacks these neither persist
 * runtime state nor reconcile against a separately-committed DB copy — the
 * single writer in executeCommand owns the one DB write per command. Here we
 * only surface progress: mark the active node and stream observer events.
 */
export function createKernelGraphCallbacks(
  input: {
    taskId: string;
    sessionId: string;
    runtimeName: string;
    mainSession: EngineRuntimeContext["mainSession"];
  } & PlanExecutionObserver,
): Partial<GraphExecutionCallbacks<EngineRuntimeContext>> {
  return {
    onEvent: async (event) => {
      if (event.type === "node_started") {
        await markExecutionNodeActive({
          taskId: input.taskId,
          sessionId: input.sessionId,
          currentNodeId: event.node.id,
        });
      }
      await input.onGraphEvent?.(event);
    },
    onStateChange: async (state) => {
      await input.onStateChange?.(resolveEffectivePlanGraph(state));
    },
    executeNode: async (executorInput) => {
      const executor = planExecutionNodeExecutors.find((candidate) =>
        candidate.canExecute(executorInput.node),
      );
      if (!executor) return null;
      return executor.execute({
        taskId: input.taskId,
        mainSession: input.mainSession,
        node: executorInput.node,
        plan: executorInput.plan,
        attempt: executorInput.attempt,
        trigger: executorInput.trigger,
        runtimeName: input.runtimeName,
        userInput: executorInput.userInput,
        inputFields: executorInput.inputFields,
        signal: executorInput.signal,
        onRuntimeEvent: input.onRuntimeEvent
          ? (event) =>
              input.onRuntimeEvent?.({
                nodeId: executorInput.node.id,
                nodeTitle: executorInput.node.title,
                runtimeName: input.runtimeName,
                event,
              })
          : undefined,
      });
    },
  };
}
