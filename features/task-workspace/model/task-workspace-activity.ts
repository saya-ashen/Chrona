import type { TaskWorkspaceSseEvent, WorkspaceRuntimeEvent } from "./workspace-events";
import type { WorkspaceActivityItem } from "./task-workspace-types";

const DEFAULT_LIMIT = 300;
const PREVIEW_LIMIT = 240;
const AGENT_LIFECYCLE_EVENT_TYPES: Record<string, true> = {
  auto_compaction_start: true,
  auto_compaction_end: true,
  auto_retry_start: true,
  auto_retry_end: true,
  retry_fallback_applied: true,
  retry_fallback_succeeded: true,
  notice: true,
  todo_reminder: true,
  todo_auto_clear: true,
  thinking_level_changed: true,
};

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


function eventKindValue(event: TaskWorkspaceSseEvent) {
  return typeof event.eventKind === "string" ? event.eventKind : undefined;
}

function eventMessageValue(event: TaskWorkspaceSseEvent) {
  return typeof event.message === "string" ? event.message : undefined;
}

function eventStringValue(event: TaskWorkspaceSseEvent, key: string) {
  const value = event[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function workspaceEventTimestamp(event: TaskWorkspaceSseEvent) {
  return eventStringValue(event, "occurredAt") ?? eventStringValue(event, "timestamp") ?? undefined;
}

function workspaceEventTimestampWithFallback(event: TaskWorkspaceSseEvent, fallbackTimestamp?: string) {
  return workspaceEventTimestamp(event) ?? fallbackTimestamp;
}

function isPlanGenerationProjectionUpdate(event: TaskWorkspaceSseEvent) {
  if (event.type !== "task_projection_updated" && event.type !== "task_workspace_updated") return false;
  return eventStringValue(event, "reason")?.startsWith("plan_generation.") ?? false;
}

function workspaceEventId(event: TaskWorkspaceSseEvent, suffix: string) {
  return `workspace-${event.sequence ?? event.commandId ?? suffix}-${event.type}`;
}

function workspaceEventActivityGroup(event: TaskWorkspaceSseEvent) {
  if (event.type !== "plan.generation.event") return undefined;
  const id = eventStringValue(event, "generationId") ?? eventStringValue(event, "generation_id") ?? event.commandId;
  return id ? { kind: "plan_generation" as const, id } : undefined;
}

function planGenerationTitle(kind: string | undefined) {
  if (kind === "status") return "Plan generation update";
  if (kind === "tool_call") return "Plan tool called";
  if (kind === "partial") return "Plan generation update";
  if (kind === "result" || kind === "draft" || kind === "accepted") return "Plan generated";
  if (kind === "error") return "Plan generation failed";
  if (kind === "cancelled") return "Plan generation cancelled";
  if (kind === "done") return "Plan generation done";
  return "Plan generation event";
}

function planGenerationTone(kind: string | undefined) {
  if (kind === "error") return "danger" as const;
  if (kind === "cancelled") return "warning" as const;
  if (kind === "result" || kind === "draft" || kind === "accepted" || kind === "done") return "success" as const;
  return "info" as const;
}

export function workspaceEventToWorkspaceActivity(event: TaskWorkspaceSseEvent, index = 0, fallbackTimestamp?: string): WorkspaceActivityItem | null {
  if (event.type === "execution.runtime_event") return null;

  if (event.type === "command.accepted" || event.type === "command.failed") {
    const commandType = typeof event.commandType === "string" ? event.commandType : "command";
    const failed = event.type === "command.failed";
    const description = eventMessageValue(event) ?? (failed ? `${commandType} failed.` : `${commandType} accepted.`);
    return {
      id: workspaceEventId(event, String(index)),
      kind: "task",
      title: failed ? "Command failed" : "Command accepted",
      summary: description,
      description,
      tone: failed ? "danger" : "info",
      timestamp: workspaceEventTimestampWithFallback(event, fallbackTimestamp),
      sequence: event.sequence,
      rawEventType: event.type,
      raw: event,
    };
  }

  if (event.type === "plan.generation.event") {
    const kind = eventKindValue(event);
    const description = eventMessageValue(event)
      ?? eventStringValue(event, "phase")
      ?? eventStringValue(event, "planTitle")
      ?? eventStringValue(event, "plan_title")
      ?? planGenerationTitle(kind);
    return {
      id: workspaceEventId(event, String(index)),
      kind: "task",
      title: planGenerationTitle(kind),
      summary: description,
      description,
      tone: planGenerationTone(kind),
      timestamp: workspaceEventTimestamp(event),
      sequence: event.sequence,
      rawEventType: `plan_generation.${kind ?? "event"}`,
      activityGroup: workspaceEventActivityGroup(event),
      raw: event,
    };
  }

  if (event.type === "execution.state.updated" || event.type === "execution.result" || event.type === "checkpoint.result") {
    const kind = eventKindValue(event);
    const description = eventMessageValue(event) ?? kind ?? event.type;
    return {
      id: workspaceEventId(event, String(index)),
      kind: event.type === "checkpoint.result" ? "task" : "node",
      title: humanizeWorkspaceEventType(event.type),
      summary: description,
      description,
      tone: kind === "failed" ? "danger" : kind === "completed" ? "success" : "info",
      timestamp: workspaceEventTimestamp(event),
      sequence: event.sequence,
      rawEventType: event.type,
      raw: event,
    };
  }

  if (isPlanGenerationProjectionUpdate(event)) return null;

  if (event.type === "task_projection_updated" || event.type === "task_workspace_updated") {
    const description = eventStringValue(event, "reason") ?? eventMessageValue(event) ?? event.type;
    return {
      id: workspaceEventId(event, String(index)),
      kind: "task",
      title: humanizeWorkspaceEventType(event.type),
      summary: description,
      description,
      tone: "info",
      timestamp: workspaceEventTimestamp(event),
      sequence: event.sequence,
      rawEventType: event.type,
      raw: event,
    };
  }

  return {
    id: workspaceEventId(event, String(index)),
    kind: "raw",
    title: "Workspace event",
    summary: humanizeWorkspaceEventType(event.type),
    description: eventMessageValue(event) ?? humanizeWorkspaceEventType(event.type),
    tone: "neutral",
    timestamp: workspaceEventTimestamp(event),
    sequence: event.sequence,
    rawEventType: event.type,
    raw: event,
  };
}

function humanizeWorkspaceEventType(eventType: string) {
  return eventType.replace(/[._-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
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
    const identity = getWorkspaceActivityIdentity(item);
    if (seen.has(identity)) continue;

    const previous = merged.at(-1);
    if (previous && canMergeAssistantActivity(previous, item)) {
      merged[merged.length - 1] = mergeAssistantActivity(previous, item);
      seen.add(identity);
      continue;
    }

    seen.add(identity);
    merged.push(item);
  }

  return orderWorkspaceActivity(merged).slice(0, limit);
}

export function compactWorkspaceActivityText(value: string | undefined, limit = PREVIEW_LIMIT) {
  return truncateText(value, limit) ?? "";
}

export function runtimeEventToWorkspaceActivity(event: WorkspaceRuntimeEvent, index = 0): WorkspaceActivityItem | null {
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
    const inputSummary = value.inputSummary;
    const summary = preview ?? value.label;
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
        callId: value.callId,
        preview: truncateText(preview),
        inputSummary: truncateText(inputSummary),
        state: "started",
      },
    };
  }

  if (value.type === "tool_progress") {
    const preview = truncateText(value.preview, 2_000);
    return {
      ...base,
      kind: "tool_progress",
      title: value.label,
      summary: preview ?? value.label,
      description: preview ?? value.label,
      tone: "info",
      tool: {
        name: value.toolName,
        label: value.label,
        callId: value.callId,
        preview,
        state: "progress",
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
        callId: value.callId,
        resultPreview: truncateText(value.preview, 4_000),
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

  if (value.type === "raw_event" && (value.rawEventType === "turn_start" || value.rawEventType === "turn_end")) {
    return null;
  }
  if (value.type === "raw_event" && value.message) {
    return {
      ...base,
      kind: "provider_run",
      title: AGENT_LIFECYCLE_EVENT_TYPES[value.rawEventType ?? ""] ? "Agent lifecycle" : "Task progress",
      summary: value.message,
      description: value.message,
      tone: "info",
    };
  }

  if (value.type === "raw_event" && (event.provider || event.runtimeName || event.nodeTitle)) {
    return null;
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
  return mergeWorkspaceActivity(events.map((event, index) => runtimeEventToWorkspaceActivity(event, index)).filter((item): item is WorkspaceActivityItem => item !== null), limit);
}
