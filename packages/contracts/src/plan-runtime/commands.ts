import type { PlanPatch } from "../ai-plan-blueprint";
import type { CheckpointInputFields } from "./checkpoints";
import type { GraphMutationOperation } from "./graph";
import type { NodeActionForm } from "./node";
import type {
  AiArtifactRef,
  NodeDeliverableDeclaration,
  NodeResult,
  ResultContribution,
} from "./node-result";

export type RuntimeCommand =
  | { type: "start_plan" }
  | { type: "pause_plan" }
  | { type: "resume_plan" }
  | { type: "cancel_plan" }
  | { type: "mark_user_task_completed"; nodeId: string }
  | { type: "approve_checkpoint"; nodeId: string; response?: unknown }
  | { type: "reject_checkpoint"; nodeId: string; reason?: string }
  | { type: "retry_node"; nodeId: string };

export type ExecutionActionType =
  | "start_manual"
  | "start_scheduled"
  | "restart_from_beginning"
  | "resume_with_input"
  | "resume_with_approval"
  | "resume_after_unblock"
  | "complete_manual_node"
  | "block_current_node"
  | "fail_current_node"
  | "retry_node"
  | "pause_session"
  | "cancel_session";

export type ExecutionActionInput =
  | {
      action: "start_manual";
      prompt?: string;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "restart_from_beginning";
      prompt?: string;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "start_scheduled";
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_with_input";
      sessionId?: string;
      nodeId?: string;
      inputFields: CheckpointInputFields;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_with_approval";
      sessionId?: string;
      nodeId?: string;
      decision: "approve" | "reject" | "request_changes";
      feedback?: string;
      editedContent?: string;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_after_unblock";
      sessionId?: string;
      nodeId?: string;
      note?: string;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "complete_manual_node";
      sessionId?: string;
      nodeId?: string;
      summary?: string;
      output?: unknown;
      deliverables?: NodeDeliverableDeclaration[];
      findings?: ResultContribution[];
      decisions?: ResultContribution[];
      caveats?: ResultContribution[];
      nextActions?: ResultContribution[];
      evidenceItems?: Array<{
        key: string;
        summary: string;
        artifactRef?: AiArtifactRef;
      }>;
      selectedBranch?: NodeResult["selectedBranch"];
      terminalKind?: "task" | "condition" | "checkpoint" | "wait";
      branchRef?: string;
      decision?: "approved" | "rejected" | "needs_input" | "completed";
      feedback?: string;
      prompt?: string;
      idempotencyKey?: string;
    }
  | {
      action: "block_current_node";
      sessionId?: string;
      nodeId?: string;
      reason: string;
      actionForm?: NodeActionForm;
      idempotencyKey?: string;
    }
  | {
      action: "fail_current_node";
      sessionId?: string;
      nodeId?: string;
      error: string;
      idempotencyKey?: string;
    }
  | {
      action: "retry_node";
      sessionId?: string;
      nodeId: string;
      prompt?: string;
      idempotencyKey?: string;
    }
  | {
      action: "pause_session";
      sessionId?: string;
      reason?: string;
      idempotencyKey?: string;
    }
  | {
      action: "cancel_session";
      sessionId?: string;
      reason?: string;
      idempotencyKey?: string;
    };

export type GraphMutationRequest = {
  expectedGraphId?: string;
  expectedRevision?: number;
  reason: string;
  operations: GraphMutationOperation[];
  scope?: "future_only" | "from_node" | "entire_graph";
};

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduleStatus?: string | null;
  executionRuntime?: string | null;
  executionConfig?: Record<string, unknown> | null;
};

export type TaskWorkspaceUpdateProposal = {
  summary: string;
  confidence: "low" | "medium" | "high";
  taskPatch?: TaskUpdatePatch;
  planPatch?: PlanPatch;
  warnings?: string[];
  requiresConfirmation: boolean;
};
