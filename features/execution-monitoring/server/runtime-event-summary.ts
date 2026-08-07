import type { CheckpointActionKind, ExecutionActionType, PlanExecutionSSEEvent } from "@chrona/contracts";
import { publicProviderDescriptor, publicRuntimeDescriptor, publicToolDescriptor } from "@chrona/contracts";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine";


const SENSITIVE_PROVIDER_KEY = /api[-_]?key|token|secret|password|authorization|credential/i;

function exposeProviderPayload(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_PROVIDER_KEY.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => exposeProviderPayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, exposeProviderPayload(entryValue, entryKey)]));
  }
  return value;
}

function sanitizeProviderDisplayEvent(event: Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> ["event"]) {
  return exposeProviderPayload(event) as Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> ["event"];
}

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
    event: sanitizeProviderDisplayEvent(displayEvent),
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
      return {
        type: "tool_started",
        tool: publicToolDescriptor(providerEvent.tool),
        label: publicToolDescriptor(providerEvent.tool).label,
        input: providerEvent.input,
        ...(providerEvent.preview !== undefined ? { raw: providerEvent.preview } : {}),
      };
    case "tool_started":
      return {
        type: "tool_started",
        tool: publicToolDescriptor(providerEvent.toolName),
        label: publicToolDescriptor(providerEvent.toolName).label,
        ...(providerEvent.input !== undefined ? { input: providerEvent.input } : {}),
        ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}),
      };
    case "tool_progress":
      return {
        type: "tool_progress",
        tool: publicToolDescriptor(providerEvent.toolName),
        label: publicToolDescriptor(providerEvent.toolName).label,
        ...(providerEvent.preview !== undefined ? { output: providerEvent.preview } : {}),
        ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}),
      };
    case "tool_result":
      return {
        type: "tool_completed",
        tool: providerEvent.tool ? publicToolDescriptor(providerEvent.tool) : undefined,
        label: providerEvent.tool ? publicToolDescriptor(providerEvent.tool).label : "Tool result",
        output: providerEvent.result,
      };
    case "tool_completed":
      return {
        type: "tool_completed",
        tool: publicToolDescriptor(providerEvent.toolName),
        label: publicToolDescriptor(providerEvent.toolName).label,
        durationMs: providerEvent.durationMs,
        ...(providerEvent.error ? {
          error: {
            code: providerEvent.error.code,
            message: providerEvent.error.message,
            raw: providerEvent.error.raw,
          },
        } : {}),
        ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}),
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
        ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}),
      };
    }
    case "run_started": return { type: "run_status", status: "started", raw: providerEvent.run };
    case "run_completed":
      return {
        type: "run_status",
        status: "completed",
        output: {
          ...(providerEvent.outputText !== undefined ? { text: providerEvent.outputText } : {}),
          ...(providerEvent.output !== undefined ? { output: providerEvent.output } : {}),
          ...(providerEvent.structuredPayload !== undefined ? { structuredPayload: providerEvent.structuredPayload } : {}),
        },
        ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}),
      };
    case "run_failed": return { type: "run_status", status: "failed", error: providerEvent.error, ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}) };
    case "run_cancelled": return { type: "run_status", status: "cancelled", ...(providerEvent.raw !== undefined ? { raw: providerEvent.raw } : {}) };
    case "raw_event": {
      const raw = providerEvent.raw;
      if (!raw || typeof raw !== "object") return null;
      const kind = (raw as { kind?: unknown }).kind;
      if (kind === "provider_request") {
        return { type: "run_status", status: "started", input: (raw as { input?: unknown }).input, raw };
      }
      if (kind !== "provider_response") return null;
      const output = (raw as { output?: { status?: unknown } }).output;
      const status = output?.status === "failed" ? "failed" : output?.status === "cancelled" ? "cancelled" : output?.status === "completed" ? "completed" : "started";
      return { type: "run_status", status, output, raw };
    }
    default: return null;
  }
}
