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
import { registerNodeDeliverables } from "../use-cases/register-generated-plan-output-artifacts";
import { buildSemanticRefHistory } from "../runtime/node-runtime-refs";

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

  const planContext = {
    title: compiledPlan.title,
    goal: compiledPlan.goal,
    assumptions: compiledPlan.assumptions,
    ...(input.planSummary ? { summary: input.planSummary } : {}),
    ...(input.goalContext ? { goalContext: input.goalContext } : {}),
  };
  let initialRunContext = input.initialRunContext;
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

      // Persist the new running attempt before invoking the provider. Plan Output
      // calls arrive over HTTP while this dispatch is still awaiting the provider,
      // so they must be able to resolve this same active attempt immediately.
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
      });

      await input.onStateChange?.(resolveEffectivePlanGraph(state));
    },
    executeNode: async (executorInput) => {
      const executor = planExecutionNodeExecutors.find((candidate) =>
        candidate.canExecute(executorInput.node),
      );
      if (!executor) return null;
      const latest = await getPlanRun(taskId, planId, workBlockId);
      const runContext = initialRunContext && Object.keys(initialRunContext).length > 0
        ? initialRunContext
        : undefined;
      initialRunContext = undefined;
      const result = await executor.execute({
        taskId,
        workBlockId,
        mainSession,
        node: executorInput.node,
        plan: executorInput.plan,
        attempt: executorInput.attempt,
        planContext,
        ...(runContext ? { runContext } : {}),
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
      if (result.status !== "done") return result;
      if (!result.deliverables?.length) {
        const { deliverables: _deliverables, ...completed } = result;
        return completed;
      }
      const deliverables = await registerNodeDeliverables({
        workspaceId,
        taskId,
        runId: result.evidence.runId,
        sourceNodeId: executorInput.node.id,
        sourceNodeRef: buildSemanticRefHistory(executorInput.plan).nodeRefs.find((binding) =>
          binding.nodeId === executorInput.node.id || binding.backendId === executorInput.node.id
        )?.ref,
        declarations: result.deliverables,
      });
      return { ...result, deliverables };
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
