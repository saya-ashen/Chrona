import type { PlanBlueprint } from "../ai-plan-blueprint";
import type { ExecutionActionType } from "./commands";
import type { EffectivePlanGraph } from "./_leaf";
import type { PlanExecutionResult, TaskPlanReadModel } from "./execution-state";
import type {
  GeneratePlanStatusPhase,
  GeneratePlanErrorCode,
} from "./_leaf";

export type {
  GeneratePlanStatusPhase,
  GeneratePlanErrorCode,
} from "./_leaf";

export type ProviderApprovalChoice = "approve_once" | "approve_session" | "approve_always" | "deny";

export type ProviderApprovalReadModel = {
  id?: string;
  provider: string;
  runId: string;
  nativeRunId?: string;
  sessionId?: string;
  kind: string;
  providerKind?: string;
  title: string;
  summary: string;
  description?: string;
  riskLevel: "low" | "medium" | "high" | "critical" | "unknown";
  subject?: {
    type: "command" | "tool" | "url" | "file" | "provider_raw";
    label: string;
    preview?: string;
    language?: string;
  };
  choices: ProviderApprovalChoice[];
  defaultChoice?: ProviderApprovalChoice;
  recommendedChoice?: ProviderApprovalChoice;
  scopePolicy?: {
    supportsOnce: boolean;
    supportsSession: boolean;
    supportsAlways: boolean;
    supportsResolveAll: boolean;
  };
  raw?: unknown;
};

export type PlanExecutionRuntimeDisplayEvent =
  | {
      type: "assistant_text_delta";
      text: string;
    }
  | {
      type: "reasoning_delta";
      text: string;
    }
  | {
      type: "tool_started";
      toolName: string;
      label: string;
      preview?: unknown;
      input?: unknown;
    }
  | {
      type: "tool_completed";
      toolName?: string;
      label: string;
      durationMs?: number;
      error?: { message: string; code?: string };
    }
  | {
      type: "approval_required";
      approval: ProviderApprovalReadModel;
    }
  | {
      type: "run_status";
      status: "started" | "completed" | "failed" | "cancelled";
      message?: string;
    }
  | {
      type: "raw_event";
      rawEventType?: string;
    };

export type PlanExecutionSSEEvent =
  | {
      type: "status";
      action: ExecutionActionType;
      message: string;
    }
  | {
      type: "graph_event";
      event: string;
      nodeId?: string;
      nodeTitle?: string;
      status?: string;
      message?: string;
    }
  | {
      type: "state";
      effectivePlan: EffectivePlanGraph;
    }
  | {
      type: "runtime_event";
      action: ExecutionActionType;
      nodeId?: string;
      nodeTitle?: string;
      runtimeName: string;
      provider: string;
      runId?: string;
      nativeRunId?: string;
      sequence?: number;
      timestamp?: string;
      rawEventType?: string;
      event: PlanExecutionRuntimeDisplayEvent;
    }
  | {
      type: "result";
      result: PlanExecutionResult;
    }
  | {
      type: "error";
      code: "INTERNAL_ERROR";
      message: string;
    }
  | {
      type: "done";
    };

export interface GeneratePlanStatusEvent {
  type: "status";
  phase: GeneratePlanStatusPhase;
  message: string;
}

export interface GeneratePlanPartialEvent {
  type: "partial";
  text: string;
}

export interface GeneratePlanToolCallEvent {
  type: "tool_call";
  tool: "chrona_plan_generate";
  input: PlanBlueprint;
}

export interface GeneratePlanResultEvent {
  type: "result";
  result: TaskPlanReadModel;
  taskSessionKey?: string;
}

export interface GeneratePlanCancelledEvent {
  type: "cancelled";
}

export interface GeneratePlanErrorEvent {
  type: "error";
  code: GeneratePlanErrorCode;
  message: string;
  rawText?: string;
  diagnostics?: Record<string, unknown>;
}

export interface GeneratePlanDoneEvent {
  type: "done";
}

export type GeneratePlanSSEEvent =
  | GeneratePlanStatusEvent
  | GeneratePlanPartialEvent
  | GeneratePlanToolCallEvent
  | GeneratePlanResultEvent
  | GeneratePlanCancelledEvent
  | GeneratePlanErrorEvent
  | GeneratePlanDoneEvent;
