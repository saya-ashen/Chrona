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

export type PlanGraphCommandActor =
  | { type: "user"; userId?: string | null; workspaceId?: string | null }
  | {
      type: "agent";
      actorId?: string | null;
      providerRunId?: string | null;
      runtimeRunId?: string | null;
      toolInvocationId?: string | null;
      model?: string | null;
    }
  | { type: "system"; service: string; reason?: string | null }
  | { type: "integration"; integration: string; externalRef?: string | null };

export type PlanGraphCommandOrigin = {
  channel: "web" | "api" | "mcp_tool" | "provider_stream" | "scheduler" | "internal";
  requestId?: string | null;
  rawEventId?: string | null;
  eventId?: string | null;
};

export type PlanGraphCommandContext = {
  actor?: PlanGraphCommandActor;
  origin?: PlanGraphCommandOrigin;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  toolInvocationId?: string | null;
  causationEventId?: string | null;
  causationRawEventId?: string | null;
};

export type PlanExecutionControl = {
  signal?: AbortSignal;
  shouldPause?: () => boolean;
};

export type EngineRuntimeContext = {
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
  control?: PlanExecutionControl;
};

export type PlanGraphCommandCorrelation = {
  taskId: string;
  planId: string;
  mainSessionId?: string | null;
  executionSessionId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  toolInvocationId?: string | null;
  causationEventId?: string | null;
  causationRawEventId?: string | null;
};

export type PlanGraphCommandEnvelope<TCommand = AdvanceRuntimeCommand> = {
  command: TCommand;
  actor: PlanGraphCommandActor;
  origin: PlanGraphCommandOrigin;
  correlation: PlanGraphCommandCorrelation;
  policy?: { requireActiveSession?: boolean };
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
      type: "submit_node_output";
      nodeId?: string;
      outputs: unknown;
      mode?: "append" | "replace";
      summary?: string;
    }
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
  | { type: "pause_session"; reason?: string }
  | { type: "cancel_session"; reason?: string };

export type ExecutionActionWithContinuation =
  | Exclude<ExecutionActionInput, { action: "complete_manual_node" }>
  | (Extract<ExecutionActionInput, { action: "complete_manual_node" }> & {
      continueExecution?: boolean;
    });

export type ExecutionDispatchContext = PlanGraphCommandContext;
