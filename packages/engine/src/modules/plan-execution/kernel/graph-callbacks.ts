import type { GraphExecutionCallbacks, GraphExecutionState } from "@chrona/graph-runtime";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { EngineRuntimeContext, PlanExecutionObserver, KernelCallbacksInput } from "./kernel-types";
import type {
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import { planExecutionNodeExecutors } from "../runtime/node-executor-registry";
import { markExecutionNodeActive } from "../persistence/task-execution-store";
import { persistRuntimeState } from "../persistence/plan-runtime-store";
import { getPlanRun } from "../persistence/plan-run-store";
import { committedStateIfRunningNodeAdvanced, committedStateForSubmittedNode } from "../runtime/committed-state";

/**
 * Kernel graph callbacks. Unlike the lightweight version these:
 * 1. Persist intermediate graph state in onStateChange so nested
 *    (re-entrant) commands see the running attempt in the DB.
 * 2. Provide resolveSubmittedNodeState so the graph can adopt
 *    a node result already committed by a nested command.
 */
export function createKernelGraphCallbacks(
  input: KernelCallbacksInput & PlanExecutionObserver,
): Partial<GraphExecutionCallbacks<EngineRuntimeContext>> {
  const { taskId, sessionId, runtimeName, mainSession, workspaceId, workBlockId, planId, compiledPlan, persisted } = input;

  return {
    onEvent: async (event) => {
      if (event.type === "node_started" && input.updateSessionProjection !== false) {
        await markExecutionNodeActive({
          taskId,
          sessionId,
          currentNodeId: event.node.id,
        });
      }
      if (input.updateSessionProjection !== false) {
        await input.onGraphEvent?.(event);
      }
    },
    onStateChange: async (state: GraphExecutionState) => {
      // Check if a nested command already advanced the running node's state
      // in the DB. If so, surface the committed state to the observer.
      const committed = await committedStateIfRunningNodeAdvanced({
        taskId,
        planId,
        state,
        workBlockId,
      });
      if (committed?.graph) {
        await input.onStateChange?.(resolveEffectivePlanGraph({
          graph: committed.graph,
          attempts: committed.attempts,
          results: committed.results,
        }));
        return;
      }

      // Persist intermediate graph state so that re-entrant (nested)
      // executeCommand calls see the latest running attempt in the DB.
      await persistRuntimeState({
        workspaceId,
        taskId,
        workBlockId,
        planId,
        compiledPlan,
        graph: state.graph as unknown as PlanGraph,
        attempts: state.attempts as unknown as NodeAttempt[],
        results: state.results as unknown as NodeResult[],
        executionContextSnapshots: state.executionContextSnapshots as unknown as ExecutionContextSnapshot[],
        existingRun: persisted.planRun,
      });

      await input.onStateChange?.(resolveEffectivePlanGraph(state));
    },
    executeNode: async (executorInput) => {
      const executor = planExecutionNodeExecutors.find((candidate) =>
        candidate.canExecute(executorInput.node),
      );
      if (!executor) return null;
      const latest = await getPlanRun(taskId, planId, workBlockId);
      return executor.execute({
        taskId,
        workBlockId,
        mainSession,
        node: executorInput.node,
        plan: executorInput.plan,
        attempt: executorInput.attempt,
        planOutput: latest?.planOutput ?? persisted.planOutput,
        trigger: executorInput.trigger,
        runtimeName,
        userInput: executorInput.userInput,
        inputFields: executorInput.inputFields,
        signal: executorInput.signal,
        onRuntimeEvent: input.onRuntimeEvent
          ? (event) =>
              input.onRuntimeEvent?.({
                nodeId: executorInput.node.id,
                nodeTitle: executorInput.node.title,
                runtimeName,
                event,
              })
          : undefined,
      });
    },
    resolveSubmittedNodeState: async (executorInput) => {
      const committed = await committedStateForSubmittedNode({
        taskId,
        planId,
        nodeId: executorInput.node.id,
        attemptId: executorInput.attempt.id,
        workBlockId: input.workBlockId,
      });
      if (!committed?.graph) return null;
      return {
        graph: structuredClone(committed.graph),
        attempts: structuredClone(committed.attempts),
        results: structuredClone(committed.results),
        executionContextSnapshots: structuredClone(committed.executionContextSnapshots),
      };
    },
  };
}
