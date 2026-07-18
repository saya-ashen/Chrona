// Graph-runtime command shapes. Pulls leaf dispatch types from
// `../types/dispatch` (re-exported via `../types`) to avoid a cycle
// with `../execution/types`, which depends on this file's
// `GraphRuntimeCommand` symbol.

import type {
  GraphExecutionCallbacks,
  GraphExecutionState,
  GraphExecutionTrigger,
  GraphExecutorRegistry,
  GraphSubmittedNodeResult,
} from "../types";
import type { GraphMutationOperation, NodeResult } from "../types";
import type { GraphExecutionControl } from "../types/dispatch";
import type { GraphExecutionEvent, GraphExecutionOutcome } from "../execution/types";
import type { CheckpointInputFields } from "@chrona/contracts/ai";

export type GraphRuntimeCommand =
  | {
      type: "start";
      state: GraphExecutionState;
      trigger: GraphExecutionTrigger;
      context: unknown;
    }
  | {
      type: "resume_with_input";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      input: {
        nodeId: string;
        value: string;
        fields: CheckpointInputFields;
        replaceStatus?: NonNullable<NodeResult["status"]>;
      };
    }
  | {
      type: "resume_after_unblock";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      nodeId?: string;
    }
  | {
      type: "resume_with_approval";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      input: {
        nodeId: string;
        approved: boolean;
        feedback?: string;
        userInput?: string;
      };
    }
  | {
      type: "retry_node";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      nodeId: string;
      reason?: string;
      userInput?: string;
    }
  | {
      type: "cancel_session";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      reason?: string;
    }
  | {
      type: "pause_session";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      reason?: string;
    }
  | {
      type: "apply_mutation";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      mutation: {
        operations: GraphMutationOperation[];
        reason: string;
        invalidateDownstream?: boolean;
      };
    }
  | {
      type: "submit_node_result";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      nodeResult: GraphSubmittedNodeResult;
      continueExecution?: boolean;
    };

export type GraphRuntimePolicies = {
  maxSteps?: number;
  maxConcurrency?: number;
  retry?: { maxAttempts?: number };
  validateGraph?: boolean;
};

export type GraphRuntimeOptions<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  callbacks?: Partial<GraphExecutionCallbacks<TContext>>;
  executors?: GraphExecutorRegistry<TContext>;
  control?: GraphExecutionControl;
  policies?: GraphRuntimePolicies;
  now?: () => number;
};

export type GraphDispatchOutcome = GraphExecutionOutcome & {
  events: GraphExecutionEvent[];
};

export type GraphRuntime<_TContext = unknown> = {
  dispatch(command: GraphRuntimeCommand): Promise<GraphDispatchOutcome>;
};
