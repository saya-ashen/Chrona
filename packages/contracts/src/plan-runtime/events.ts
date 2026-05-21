import type { PlanBlueprint } from "../ai-plan-blueprint";
import type { ExecutionActionType } from "./commands";
import type { EffectivePlanGraph } from "./graph";
import type { PlanExecutionResult, TaskPlanReadModel } from "./execution-state";

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
      approval: Record<string, unknown>;
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

export type GeneratePlanStatusPhase =
  | "starting"
  | "loading_task"
  | "requesting_provider"
  | "streaming"
  | "extracting_tool_payload"
  | "compiling"
  | "saving"
  | "completed";

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


export type GeneratePlanErrorCode =
  | "TASK_NOT_FOUND"
  | "PLAN_GENERATION_IN_FLIGHT"
  | "NO_AI_CLIENT"
  | "INVALID_TOOL_PAYLOAD"
  | "EMPTY_PLAN"
  | "PROVIDER_ERROR"
  | "ABORTED"
  | "INTERNAL_ERROR";

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
