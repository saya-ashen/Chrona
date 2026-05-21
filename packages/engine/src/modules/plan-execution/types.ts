import type { GraphExecutionEvent } from "@chrona/graph-runtime";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import type {
  EffectivePlanGraph,
  ExecutionActionInput,
  NodeActionForm,
  NodeResult,
} from "@chrona/contracts/ai";

export type OrchestratorTrigger = "manual" | "scheduler" | "system" | "auto";

export type PlanExecutionRuntimeEvent = {
  nodeId: string;
  nodeTitle: string;
  runtimeName: string;
  event: ProviderRunEvent;
};

export type PlanExecutionObserver = {
  onGraphEvent?: (event: GraphExecutionEvent) => Promise<void> | void;
  onRuntimeEvent?: (event: PlanExecutionRuntimeEvent) => Promise<void> | void;
  onStateChange?: (effectivePlan: EffectivePlanGraph) => Promise<void> | void;
};

export type EngineRuntimeContext = {
  taskId: string;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
};

export type SyncPlanRunRuntimeResultInput = {
  taskId: string;
  runtimeRunRef: string;
  status: "Completed" | "Failed" | "Cancelled";
  summary?: string | null;
  error?: string | null;
  output?: unknown;
};

export type AdvanceRuntimeCommand =
  | { type: "start" }
  | {
      type: "resume_with_input";
      nodeId: string;
      value: string;
      fields: Record<string, string>;
      replaceStatus?: NonNullable<NodeResult["status"]>;
    }
  | { type: "resume_after_unblock"; nodeId?: string }
  | {
      type: "complete_manual_node";
      nodeId?: string;
      summary?: string;
      output?: unknown;
      selectedBranch?: NodeResult["selectedBranch"];
      terminalKind?: "task" | "condition" | "checkpoint" | "wait";
      branchRef?: string;
      decision?: "approved" | "rejected" | "needs_input" | "completed";
      feedback?: string;
      prompt?: string;
      continueExecution?: boolean;
    }
  | { type: "block_current_node"; nodeId?: string; reason: string; actionForm?: NodeActionForm }
  | { type: "fail_current_node"; nodeId?: string; error: string }
  | {
      type: "resume_with_approval";
      nodeId: string;
      approved: boolean;
      feedback?: string;
    }
  | { type: "retry_node"; nodeId: string; reason?: string; userInput?: string }
  | { type: "cancel_session"; reason?: string };

export type ExecutionActionWithContinuation =
  | Exclude<ExecutionActionInput, { action: "complete_manual_node" }>
  | (Extract<ExecutionActionInput, { action: "complete_manual_node" }> & {
      continueExecution?: boolean;
    });
