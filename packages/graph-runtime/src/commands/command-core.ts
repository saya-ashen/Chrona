import type {
  GraphExecutionState,
  GraphExecutionTrigger,
  GraphSubmittedNodeResult,
} from "../types/dispatch-primitives";
import type { GraphMutationOperation, NodeResult } from "@chrona/contracts/ai";
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
