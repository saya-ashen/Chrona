import type { PlanExecutionSSEEvent } from "@chrona/contracts";
import type { ExecutionActionType } from "@chrona/contracts/ai";
import type { CheckpointActionKind } from "@chrona/contracts/ai";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine";

type RuntimeSummaryBase = Omit<Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>, "event">;

function toolLabel(toolName?: string): string {
  switch (toolName) {
    case "chrona_execution_dispatch":
      return "Updating execution state";
    case "chrona_plan_read":
      return "Reading plan";
    case "chrona_plan_mutate":
      return "Updating plan";
    case "chrona_task_read":
      return "Reading task";
    default:
      return toolName ?? "Running tool";
  }
}

export function summarizeRuntimeEvent(
  action: ExecutionActionType,
  event: PlanExecutionRuntimeEvent,
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> {
  const providerEvent = event.event;
  const provider = providerEvent.provider ?? "provider";
  const base: RuntimeSummaryBase = {
    type: "runtime_event" as const,
    action,
    nodeId: event.nodeId,
    nodeTitle: event.nodeTitle,
    runtimeName: event.runtimeName,
    provider,
    runId: providerEvent.runId,
    nativeRunId: providerEvent.nativeRunId,
    sequence: providerEvent.sequence,
    timestamp: providerEvent.timestamp ?? new Date().toISOString(),
    rawEventType: providerEvent.rawEventType,
  };

  return { ...base, event: summarizeProviderRuntimePayload(providerEvent) };
}

export function checkpointActionToExecutionAction(action: CheckpointActionKind): ExecutionActionType {
  switch (action) {
    case "submit_input":
      return "resume_with_input";
    case "approve_result":
    case "reject_result":
    case "request_changes":
    case "accept_replan":
    case "reject_replan":
    case "request_replan":
      return "resume_with_approval";
    case "retry_node":
      return "retry_node";
    case "resume_after_unblock":
      return "resume_after_unblock";
    case "mark_node_completed":
    case "mark_node_skipped":
      return "complete_manual_node";
    case "fail_task":
      return "fail_current_node";
    case "cancel_session":
      return "cancel_session";
  }
}

function summarizeProviderRuntimePayload(
  providerEvent: PlanExecutionRuntimeEvent["event"],
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>["event"] {
  switch (providerEvent.type) {
    case "text_delta":
      return { type: "assistant_text_delta", text: providerEvent.text };
    case "reasoning_delta":
      return { type: "reasoning_delta", text: providerEvent.text };
    case "tool_call":
      return {
        type: "tool_started",
        toolName: providerEvent.tool,
        label: toolLabel(providerEvent.tool),
        input: providerEvent.input,
      };
    case "tool_started":
      return {
        type: "tool_started",
        toolName: providerEvent.toolName,
        label: toolLabel(providerEvent.toolName),
        preview: providerEvent.preview,
        input: providerEvent.input,
      };
    case "tool_result":
      return {
        type: "tool_completed",
        toolName: providerEvent.tool,
        label: toolLabel(providerEvent.tool),
      };
    case "tool_completed":
      return {
        type: "tool_completed",
        toolName: providerEvent.toolName,
        label: toolLabel(providerEvent.toolName),
        durationMs: providerEvent.durationMs,
        error: providerEvent.error
          ? {
              message: providerEvent.error.message,
              code: providerEvent.error.code,
            }
          : undefined,
      };
    case "approval_required":
      return { type: "approval_required", approval: providerEvent.approval };
    case "run_started":
      return { type: "run_status", status: "started", message: "Provider run started." };
    case "run_completed":
      return { type: "run_status", status: "completed", message: "Provider run finished. Chrona state sync is authoritative." };
    case "run_failed":
      return { type: "run_status", status: "failed", message: providerEvent.error };
    case "run_cancelled":
      return { type: "run_status", status: "cancelled", message: "Provider run cancelled." };
    case "raw_event":
      return { type: "raw_event", rawEventType: providerEvent.rawEventType };
  }
}
