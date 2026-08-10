import type {
  CheckpointInputFields,
  EffectivePlanNode,
  NodeAttempt,
  NodeResult,
} from "@chrona/contracts/ai";
import type {
  GraphExecutionControl,
  GraphExecutionOutcome,
  GraphExecutionState,
  GraphExecutionTrigger,
  GraphNodeExecutionResult,
  GraphNodeExecutorInput,
} from "./dispatch-primitives";
import type { GraphExecutionEvent } from "./events";

export type GraphExecutionCallbacks<TContext = unknown> = {
  executeNode(input: GraphNodeExecutorInput<TContext>): Promise<GraphNodeExecutionResult | null>;
  resolveSubmittedNodeState?(input: {
    node: EffectivePlanNode;
    attempt: NodeAttempt;
    state: GraphExecutionState;
  }): Promise<GraphExecutionState | null> | GraphExecutionState | null;
  onEvent?(event: GraphExecutionEvent): Promise<void> | void;
  onStateChange?(state: GraphExecutionState): Promise<void> | void;
};

export type GraphNodeExecutor<TContext = unknown> = (
  input: GraphNodeExecutorInput<TContext>,
) => Promise<GraphNodeExecutionResult | null>;

export type GraphExecutorRegistry<TContext = unknown> = Record<
  string,
  GraphNodeExecutor<TContext>
>;

export type RunGraphExecutionInput<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  trigger: GraphExecutionTrigger;
  state: GraphExecutionState;
  context: TContext;
  maxSteps?: number;
  forcedNodeId?: string;
  userInput?: string;
  inputFields?: CheckpointInputFields;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
  maxConcurrency?: number;
  control?: GraphExecutionControl;
  now?: () => number;
  callbacks: GraphExecutionCallbacks<TContext>;
};

export type GraphDispatchOutcome = GraphExecutionOutcome & {
  events: GraphExecutionEvent[];
};
