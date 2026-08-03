import type { CheckpointActionKind, ExecutionActionType, PlanExecutionSSEEvent } from "@chrona/contracts";
import { publicProviderDescriptor, publicRuntimeDescriptor, publicToolDescriptor } from "@chrona/contracts";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine";


export function summarizeRuntimeEvent(
  action: ExecutionActionType,
  event: PlanExecutionRuntimeEvent,
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> | null {
  const providerEvent = event.event;
  const provider = publicProviderDescriptor(providerEvent.provider);
  const displayEvent = summarizeProviderRuntimePayload(providerEvent);
  if (!displayEvent) return null;
  return {
    type: "runtime_event",
    action,
    executionScope: event.executionScope,
    nodeId: event.nodeId,
    nodeTitle: event.nodeTitle,
    runtime: publicRuntimeDescriptor(event.runtimeName),
    provider,
    sequence: providerEvent.sequence,
    timestamp: providerEvent.timestamp ?? new Date().toISOString(),
    event: displayEvent,
  };
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
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> ["event"] | null {
  switch (providerEvent.type) {
    case "tool_call":
      return { type: "tool_started", tool: publicToolDescriptor(providerEvent.tool), label: publicToolDescriptor(providerEvent.tool).label };
    case "tool_started":
      return { type: "tool_started", tool: publicToolDescriptor(providerEvent.toolName), label: publicToolDescriptor(providerEvent.toolName).label };
    case "tool_progress":
      return { type: "tool_progress", tool: publicToolDescriptor(providerEvent.toolName), label: publicToolDescriptor(providerEvent.toolName).label };
    case "tool_result":
      return { type: "tool_completed", tool: publicToolDescriptor(providerEvent.tool), label: publicToolDescriptor(providerEvent.tool).label };
    case "tool_completed":
      return {
        type: "tool_completed",
        tool: publicToolDescriptor(providerEvent.toolName),
        label: publicToolDescriptor(providerEvent.toolName).label,
        durationMs: providerEvent.durationMs,
        ...(providerEvent.error ? { error: { code: providerEvent.error.code } } : {}),
      };
    case "approval_required": {
      const { id, riskLevel, choices, defaultChoice, recommendedChoice } = providerEvent.approval;
      return {
        type: "approval_required",
        approval: {
          id,
          provider: publicProviderDescriptor(providerEvent.approval.provider),
          kind: "execution_approval",
          title: "Approval required",
          summary: "Execution is waiting for confirmation.",
          riskLevel,
          choices,
          defaultChoice,
          recommendedChoice,
        },
      };
    }
    case "run_started": return { type: "run_status", status: "started" };
    case "run_completed": return { type: "run_status", status: "completed" };
    case "run_failed": return { type: "run_status", status: "failed" };
    case "run_cancelled": return { type: "run_status", status: "cancelled" };
    default: return null;
  }
}
