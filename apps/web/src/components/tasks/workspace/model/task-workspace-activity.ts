import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { ExecutionOverviewTone, WorkspaceActivityItem, WorkspaceActivityTone } from "./task-workspace-types";

const DEFAULT_LIMIT = 30;
const PREVIEW_LIMIT = 240;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string | undefined, limit = PREVIEW_LIMIT) {
  if (!value) return undefined;
  const compact = normalizeText(value);
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function activityToneFromOverviewTone(tone: ExecutionOverviewTone): WorkspaceActivityTone {
  return tone === "critical" ? "danger" : tone;
}

export function getWorkspaceActivityIdentity(item: WorkspaceActivityItem) {
  return [
    item.kind,
    item.provider ?? "provider",
    item.runtimeName ?? "runtime",
    item.runId ?? "run",
    item.nativeRunId ?? "native",
    item.sourceNodeId ?? "task",
    item.rawEventType ?? "event",
    item.sequence ?? item.id,
  ].join(":");
}

function timestampMs(item: WorkspaceActivityItem) {
  if (!item.timestamp) return 0;
  const parsed = Date.parse(item.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function orderWorkspaceActivity(items: WorkspaceActivityItem[]) {
  return [...items].sort((left, right) => {
    const timeOrder = timestampMs(right) - timestampMs(left);
    if (timeOrder !== 0) return timeOrder;
    return (right.sequence ?? 0) - (left.sequence ?? 0);
  });
}

function canMergeAssistantActivity(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  return left.kind === right.kind
    && (left.kind === "assistant_message" || left.kind === "reasoning")
    && left.provider === right.provider
    && left.runtimeName === right.runtimeName
    && left.runId === right.runId
    && left.nativeRunId === right.nativeRunId
    && left.sourceNodeId === right.sourceNodeId;
}

function mergeAssistantActivity(left: WorkspaceActivityItem, right: WorkspaceActivityItem): WorkspaceActivityItem {
  const text = `${left.assistant?.text ?? left.summary}${right.assistant?.text ?? right.summary}`;
  return {
    ...left,
    id: left.id,
    timestamp: right.timestamp ?? left.timestamp,
    sequence: right.sequence ?? left.sequence,
    summary: text,
    description: text,
    assistant: {
      text,
      isReasoning: left.kind === "reasoning",
      isPartial: right.assistant?.isPartial ?? left.assistant?.isPartial,
    },
  };
}

export function mergeWorkspaceActivity(items: WorkspaceActivityItem[], limit = DEFAULT_LIMIT) {
  const ordered = orderWorkspaceActivity(items).reverse();
  const merged: WorkspaceActivityItem[] = [];
  const seen = new Set<string>();

  for (const item of ordered) {
    const previous = merged.at(-1);
    if (previous && canMergeAssistantActivity(previous, item)) {
      merged[merged.length - 1] = mergeAssistantActivity(previous, item);
      continue;
    }

    const identity = getWorkspaceActivityIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(item);
  }

  return orderWorkspaceActivity(merged).slice(0, limit);
}

export function compactWorkspaceActivityText(value: string | undefined, limit = PREVIEW_LIMIT) {
  return truncateText(value, limit) ?? "";
}

export function runtimeEventToWorkspaceActivity(event: WorkspaceRuntimeEvent, index = 0): WorkspaceActivityItem {
  const value = event.event;
  const base = {
    id: `runtime-${event.sequence ?? index}-${value.type}`,
    timestamp: event.timestamp,
    sourceNodeId: event.nodeId,
    sourceNodeTitle: event.nodeTitle,
    provider: event.provider,
    runtimeName: event.runtimeName,
    runId: event.runId,
    sequence: event.sequence,
    rawEventType: event.rawEventType ?? value.type,
    raw: value,
  } satisfies Partial<WorkspaceActivityItem>;

  if (value.type === "assistant_text_delta" || value.type === "reasoning_delta") {
    const text = value.text;
    const isReasoning = value.type === "reasoning_delta";
    return {
      ...base,
      kind: isReasoning ? "reasoning" : "assistant_message",
      title: isReasoning ? "Reasoning" : "Assistant response",
      summary: text,
      description: text,
      tone: isReasoning ? "neutral" : "info",
      assistant: { text, isReasoning, isPartial: true },
    };
  }

  if (value.type === "tool_started") {
    const preview = stringValue(value.preview);
    const inputSummary = stringValue(value.input);
    const summary = preview ? `${value.label}: ${preview}` : value.label;
    return {
      ...base,
      kind: "tool_started",
      title: "Tool started",
      summary,
      description: summary,
      tone: "info",
      tool: {
        name: value.toolName,
        label: value.label,
        preview: truncateText(preview),
        inputSummary: truncateText(inputSummary),
        state: "started",
      },
    };
  }

  if (value.type === "tool_completed") {
    const error = typeof value.error?.message === "string" ? value.error.message : undefined;
    const preview = "preview" in value ? stringValue(value.preview) : undefined;
    const summary = error ? `${value.label} failed: ${error}` : `${value.label} completed`;
    return {
      ...base,
      kind: "tool_completed",
      title: error ? "Tool failed" : "Tool completed",
      summary,
      description: summary,
      tone: error ? "danger" : "success",
      tool: {
        name: value.toolName,
        label: value.label,
        preview: truncateText(preview),
        durationMs: value.durationMs,
        error: truncateText(error),
        state: error ? "failed" : "completed",
      },
    };
  }

  if (value.type === "approval_required") {
    return {
      ...base,
      kind: "approval",
      title: "Approval required",
      summary: "Execution is waiting for approval.",
      description: "Execution is waiting for approval.",
      tone: "warning",
    };
  }

  if (value.type === "run_status") {
    const summary = value.message ?? value.status;
    return {
      ...base,
      kind: "provider_run",
      title: "Run status",
      summary,
      description: summary,
      tone: value.status === "failed" ? "danger" : value.status === "completed" ? "success" : "info",
    };
  }

  const summary = value.rawEventType ?? "Runtime event";
  return {
    ...base,
    kind: "raw",
    title: "Provider event",
    summary,
    description: summary,
    tone: "neutral",
  };
}

export function runtimeEventsToWorkspaceActivity(events: WorkspaceRuntimeEvent[], limit = DEFAULT_LIMIT) {
  return mergeWorkspaceActivity(events.map(runtimeEventToWorkspaceActivity), limit);
}
