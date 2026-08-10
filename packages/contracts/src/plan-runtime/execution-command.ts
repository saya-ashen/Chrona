import type { CheckpointInputFields } from "./checkpoints";
import type { GraphMutationOperation } from "./graph";
import type { NodeActionForm } from "./node";
import type {
  NodeDeliverable,
  NodeDeliverableDeclaration,
  ResultContribution,
  ResultEvidence,
} from "./node-result";

type SubmittedNodeEvidence = {
  sessionId?: string;
  runId?: string;
  runtimeRunRef?: string;
  [key: string]: unknown;
};

/**
 * Single execution command vocabulary shared by API, engine kernel, and graph
 * runtime. Replaces the former triple of ExecutionActionInput (API),
 * AdvanceRuntimeCommand (engine), and the hand-translated graph command.
 */
export type ExecutionTrigger = "manual" | "scheduler" | "system" | "auto";

export type ExecutionActor =
  | { type: "user"; userId?: string | null; workspaceId?: string | null }
  | {
      type: "agent";
      actorId?: string | null;
      runtimeRunRef?: string | null;
      model?: string | null;
    }
  | { type: "system"; service: string; reason?: string | null }
  | { type: "integration"; integration: string; externalRef?: string | null };

export type ExecutionCommandOrigin = {
  channel:
    | "web"
    | "api"
    | "mcp_tool"
    | "provider_stream"
    | "scheduler"
    | "internal";
  requestId?: string | null;
};

/**
 * The terminal result a node produces. Submitted in-process by an executor or
 * out-of-band by a provider run — both flow through the same command.
 */
export type SubmittedNodeDeliverable = NodeDeliverableDeclaration | NodeDeliverable;

export type SubmittedNodeResult =
  | {
      kind: "done";
      summary?: string;
      output?: unknown;
      evidence?: SubmittedNodeEvidence;
      deliverables?: SubmittedNodeDeliverable[];
      findings?: ResultContribution[];
      decisions?: ResultContribution[];
      caveats?: ResultContribution[];
      nextActions?: ResultContribution[];
      resultEvidence?: ResultEvidence[];
      selectedBranch?: {
        ref?: string;
        key?: string;
        label: string;
        nextNodeId: string;
        source: "user" | "ai" | "system" | "default";
      };
      /** Raw branch ref string (e.g. "B20260604-01-A") for condition nodes.
       * Resolved to selectedBranch in the kernel. */
      branchRef?: string;
    }
  | { kind: "failed"; error: string; evidence?: SubmittedNodeEvidence }
  | { kind: "blocked"; reason: string; actionForm?: NodeActionForm; evidence?: SubmittedNodeEvidence }
  | { kind: "cancelled"; reason?: string; evidence?: SubmittedNodeEvidence };

export type ExecutionCommand =
  | { type: "start"; trigger: ExecutionTrigger; prompt?: string }
  | { type: "restart_from_beginning"; trigger: ExecutionTrigger; prompt?: string }
  | { type: "resume_with_input"; nodeId?: string; inputFields: CheckpointInputFields }
  | { type: "resume_with_approval"; nodeId?: string; approved: boolean; feedback?: string }
  | { type: "resume_after_unblock"; nodeId?: string; note?: string }
  | {
      type: "submit_node_result";
      nodeId?: string;
      result: SubmittedNodeResult;
      /** Set when the result arrives out-of-band from a provider run. */
      runtimeRunRef?: string;
      /** Durable node attempt this terminal result is allowed to complete. */
      expectedAttemptId?: string;
      /** Optional durable provider-run row identity for provider callbacks. */
      providerRunId?: string;
      /** Whether to continue execution after applying this result.
       * Defaults to false — callers opt into automatic continuation. */
      continueExecution?: boolean;
    }
  | { type: "block_node"; nodeId?: string; reason: string; actionForm?: NodeActionForm }
  | { type: "fail_node"; nodeId?: string; error: string }
  | { type: "retry_node"; nodeId: string; reason?: string; userInput?: string }
  | {
      type: "apply_mutation";
      operations: GraphMutationOperation[];
      reason: string;
      invalidateDownstream?: boolean;
    }
  | { type: "pause"; reason?: string }
  | { type: "cancel"; reason?: string };

export type ExecutionCommandContext = {
  runId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  trigger?: ExecutionTrigger;
  sessionId?: string | null;
  workBlockId?: string | null;
  actor?: ExecutionActor;
  origin?: ExecutionCommandOrigin;
  idempotencyKey?: string;
};

export type ExecutionCommandEnvelope = {
  taskId: string;
  command: ExecutionCommand;
  context?: ExecutionCommandContext;
};
