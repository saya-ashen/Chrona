import type { GraphMutationOperation } from "./graph";
import type { NodeActionForm } from "./node";
import type { NodeResultOutput } from "./node-result";

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
export type SubmittedNodeResult =
  | {
      kind: "done";
      summary?: string;
      outputs?: NodeResultOutput[];
      output?: unknown;
      mode?: "append" | "replace";
      selectedBranch?: {
        ref?: string;
        key?: string;
        label: string;
        nextNodeId: string;
        source: "user" | "ai" | "system" | "default";
      };
    }
  | { kind: "failed"; error: string }
  | { kind: "blocked"; reason: string; actionForm?: NodeActionForm }
  | { kind: "cancelled"; reason?: string };

export type ExecutionCommand =
  | { type: "start"; trigger: ExecutionTrigger; prompt?: string }
  | { type: "resume_with_input"; nodeId?: string; inputFields: Record<string, string> }
  | { type: "resume_with_approval"; nodeId?: string; approved: boolean; feedback?: string }
  | { type: "resume_after_unblock"; nodeId?: string; note?: string }
  | {
      type: "submit_node_result";
      nodeId?: string;
      result: SubmittedNodeResult;
      /** Set when the result arrives out-of-band from a provider run. */
      runtimeRunRef?: string;
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
