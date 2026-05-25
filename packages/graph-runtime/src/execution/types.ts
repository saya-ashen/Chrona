import type { GraphRuntimeCommand } from "../commands/types";
import type { GraphNodeExecutionEvidence } from "../evidence";
import type { GraphExecutionStatus } from "../status";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionContextSnapshot,
  NodeActionForm,
  NodeAttempt,
  NodeResult,
  PlanGraph,
  WaitKind,
} from "../types";

export type GraphExecutionTrigger = "manual" | "scheduler" | "system" | "auto";

export type GraphNodeExecutionResult =
  | {
      status: "started";
      summary: string;
      evidence: GraphNodeExecutionEvidence;
      output?: unknown;
    }
  | {
      status: "done";
      summary: string;
      evidence: GraphNodeExecutionEvidence;
      output?: unknown;
      inputFields?: Record<string, string>;
      selectedBranch?: NodeResult["selectedBranch"];
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
      actionForm?: NodeActionForm;
    }
  | {
      status: "waiting_for_approval";
      prompt: string;
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      status: "blocked";
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
      actionForm?: NodeResult["actionForm"];
    }
  | {
      status: "replan_required";
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
      proposedPatch?: unknown;
    }
  | {
      status: "failed";
      error: string;
      evidence?: GraphNodeExecutionEvidence;
      details?: unknown;
    };

export type GraphSubmittedNodeResult =
  | {
      nodeId: string;
      status: "done";
      summary: string;
      evidence?: GraphNodeExecutionEvidence;
      output?: unknown;
      selectedBranch?: NodeResult["selectedBranch"];
    }
  | {
      nodeId: string;
      status: "failed";
      error: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      nodeId: string;
      status: "blocked";
      reason: string;
      actionForm?: NodeResult["actionForm"];
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      nodeId: string;
      status: "cancelled";
      reason?: string;
      evidence?: GraphNodeExecutionEvidence;
    };

export type GraphExecutionState = {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
};

export type GraphExecutionEvent =
  | { type: "command_received"; command: GraphRuntimeCommand }
  | {
      type: "command_unsupported";
      command: GraphRuntimeCommand;
      reason: string;
    }
  | {
      type: "command_validation_failed";
      command: GraphRuntimeCommand;
      issues: string[];
    }
  | {
      type: "graph_mutation_applied";
      mutationId: string;
      affectedNodeIds: string[];
    }
  | {
      type: "node_result_submitted";
      nodeId: string;
      status: GraphSubmittedNodeResult["status"];
    }
  | { type: "executable_path_computed"; effective: EffectivePlanGraph }
  | { type: "node_started"; node: EffectivePlanNode; attempt: NodeAttempt }
  | {
      type: "node_completed";
      node: EffectivePlanNode;
      result: GraphNodeExecutionResult;
    }
  | {
      type: "node_waiting_for_user";
      node: EffectivePlanNode;
      result: GraphNodeExecutionResult;
    }
  | {
      type: "node_waiting_for_approval";
      node: EffectivePlanNode;
      result: GraphNodeExecutionResult;
    }
  | {
      type: "node_blocked";
      node: EffectivePlanNode;
      result: GraphNodeExecutionResult;
    }
  | {
      type: "replan_proposed";
      node: EffectivePlanNode;
      result: GraphNodeExecutionResult;
    };

export type GraphNodeExecutorInput<TContext = unknown> = {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  attempt: NodeAttempt;
  trigger: GraphExecutionTrigger;
  runtimeName: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  context: TContext;
  signal?: AbortSignal;
};

export type GraphExecutionCallbacks<TContext = unknown> = {
  executeNode(
    input: GraphNodeExecutorInput<TContext>,
  ): Promise<GraphNodeExecutionResult | null>;
  resolveSubmittedNodeState?(input: {
    node: EffectivePlanNode;
    attempt: NodeAttempt;
    state: GraphExecutionState;
  }): Promise<GraphExecutionState | null> | GraphExecutionState | null;
  onEvent?(event: GraphExecutionEvent): Promise<void> | void;
  onStateChange?(state: GraphExecutionState): Promise<void> | void;
};

export type GraphExecutionControl = {
  signal?: AbortSignal;
  shouldPause?: () => boolean;
};

export type GraphNodeExecutor<TContext = unknown> = (
  input: GraphNodeExecutorInput<TContext>,
) => Promise<GraphNodeExecutionResult | null>;

export type GraphExecutorRegistry<TContext = unknown> = Record<
  string,
  GraphNodeExecutor<TContext>
>;

export type GraphExecutionOutcome = {
  status: GraphExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  effective: EffectivePlanGraph;
  state: GraphExecutionState;
  waitKind?: WaitKind;
  message: string;
};

export type RunGraphExecutionInput<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  trigger: GraphExecutionTrigger;
  state: GraphExecutionState;
  context: TContext;
  maxSteps?: number;
  forcedNodeId?: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
  maxConcurrency?: number;
  control?: GraphExecutionControl;
  now?: () => number;
  callbacks: GraphExecutionCallbacks<TContext>;
};
