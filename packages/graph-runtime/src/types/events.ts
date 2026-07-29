import type {
  EffectivePlanGraph,
  EffectivePlanNode,
} from "@chrona/contracts/ai";
import type { GraphRuntimeCommand } from "../commands/command-core";
import type { GraphNodeExecutionResult, GraphSubmittedNodeResult, GraphExecutionState } from "./dispatch-primitives";

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
