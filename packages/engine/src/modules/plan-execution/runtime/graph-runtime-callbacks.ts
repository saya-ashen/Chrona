import type { GraphExecutionCallbacks } from "@chrona/graph-runtime";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import type {
  EngineRuntimeContext,
  OrchestratorTrigger,
  PlanExecutionObserver,
} from "../types";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import type { PersistedPlanRun } from "../persistence/plan-runtime-store";
import { persistRuntimeState } from "../persistence/plan-runtime-store";
import { markExecutionNodeActive } from "../persistence/task-execution-store";
import { toEffectivePlanGraph } from "../projection/execution-graph-selectors";
import { planExecutionNodeExecutors } from "./node-executor-registry";

type GraphRuntimeState = Parameters<
  NonNullable<GraphExecutionCallbacks<EngineRuntimeContext>["onStateChange"]>
>[0];

type CommittedStateLookup = (input: {
  taskId: string;
  planId: string;
  state: GraphRuntimeState;
}) => Promise<PersistedPlanRun | null>;

export function createExecutionGraphCallbacks(input: {
  taskId: string;
  planId: string;
  workspaceId: string;
  compiledPlan: unknown;
  persisted: PersistedPlanRun;
  runtimeName: string;
  trigger: OrchestratorTrigger;
  mainSession: EngineRuntimeContext["mainSession"];
  executionSession: ExecutionSessionRow;
  committedStateIfRunningNodeAdvanced: CommittedStateLookup;
} & PlanExecutionObserver): Partial<GraphExecutionCallbacks<EngineRuntimeContext>> {
  return {
    onEvent: async (event) => {
      if (event.type === "node_started") {
        await markExecutionNodeActive({
          taskId: input.taskId,
          sessionId: input.executionSession.id,
          currentNodeId: event.node.id,
        });
      }
      await input.onGraphEvent?.(event);
    },
    onStateChange: async (state) => {
      const committed = await input.committedStateIfRunningNodeAdvanced({
        taskId: input.taskId,
        planId: input.planId,
        state,
      });
      if (committed?.graph) {
        await input.onStateChange?.(toEffectivePlanGraph({
          graph: committed.graph,
          attempts: committed.attempts,
          results: committed.results,
        }));
        return;
      }
      await persistRuntimeState({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        planId: input.planId,
        compiledPlan: input.compiledPlan as never,
        graph: state.graph as unknown as PlanGraph,
        attempts: state.attempts as unknown as NodeAttempt[],
        results: state.results as unknown as NodeResult[],
        executionContextSnapshots: state.executionContextSnapshots as unknown as ExecutionContextSnapshot[],
        existingRun: input.persisted.planRun,
      });
      await input.onStateChange?.(resolveEffectivePlanGraph(state));
    },
    executeNode: async (executorInput) => {
      const engineNode = executorInput.node as unknown as EffectivePlanNode;
      const enginePlan = executorInput.plan as unknown as EffectivePlanGraph;
      const executor = planExecutionNodeExecutors.find((candidate) =>
        candidate.canExecute(engineNode),
      );
      if (!executor) return null;
      return executor.execute({
        taskId: input.taskId,
        mainSession: input.mainSession,
        node: engineNode,
        plan: enginePlan,
        trigger: executorInput.trigger,
        runtimeName: input.runtimeName,
        userInput: executorInput.userInput,
        inputFields: executorInput.inputFields,
        signal: executorInput.signal,
        onRuntimeEvent: input.onRuntimeEvent
          ? (event) => input.onRuntimeEvent?.({
              nodeId: engineNode.id,
              nodeTitle: engineNode.title,
              runtimeName: input.runtimeName,
              event,
            })
          : undefined,
      }) as ReturnType<typeof executor.execute>;
    },
  };
}
