// Execution-side event types. Leaf dispatch types (state, callbacks,
// outcomes, ...) live in `../types/dispatch` so command shapes can use
// them without forming a cycle with this file.

import type { GraphRuntimeCommand } from "../commands/types";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  GraphExecutionState,
  GraphSubmittedNodeResult,
} from "../types";

// Re-export leaf dispatch types for backward compatibility with the
// many call sites that import them from `../execution/types`.
export type {
  GraphExecutionTrigger,
  GraphNodeExecutionResult,
  GraphSubmittedNodeResult,
  GraphExecutionState,
  GraphNodeExecutorInput,
  GraphExecutionCallbacks,
  GraphExecutionControl,
  GraphNodeExecutor,
  GraphExecutorRegistry,
  GraphExecutionOutcome,
  RunGraphExecutionInput,
} from "../types/dispatch";

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
  | { type: "node_started"; node: EffectivePlanNode; attempt: GraphExecutionState["attempts"][number] }
  | {
      type: "node_completed";
      node: EffectivePlanNode;
      result: import("../types/dispatch").GraphNodeExecutionResult;
    }
  | {
      type: "node_waiting_for_user";
      node: EffectivePlanNode;
      result: import("../types/dispatch").GraphNodeExecutionResult;
    }
  | {
      type: "node_waiting_for_approval";
      node: EffectivePlanNode;
      result: import("../types/dispatch").GraphNodeExecutionResult;
    }
  | {
      type: "node_blocked";
      node: EffectivePlanNode;
      result: import("../types/dispatch").GraphNodeExecutionResult;
    }
  | {
      type: "replan_proposed";
      node: EffectivePlanNode;
      result: import("../types/dispatch").GraphNodeExecutionResult;
    };
