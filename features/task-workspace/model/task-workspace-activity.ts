import type { TaskWorkspaceSseEvent, WorkspaceRuntimeEvent } from "./workspace-events";
import type { WorkspaceActivityItem } from "./task-workspace-types";

const DEFAULT_LIMIT = 300;


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
    };
  }

  return null;
}

function humanizeWorkspaceEventType(eventType: string) {
  return eventType.replace(/[._-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getWorkspaceActivityIdentity(item: WorkspaceActivityItem) {
  return [
    item.kind,
    item.provider?.label ?? "provider",
    item.runtime?.label ?? "runtime",
    item.executionScope ?? "execution",
    item.sourceNodeId ?? "task",
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

function canReplaceToolProgress(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  return left.kind === "tool_progress"
    && right.kind === "tool_progress"
    && left.provider?.label === right.provider?.label
    && left.runtime?.label === right.runtime?.label
    && left.sourceNodeId === right.sourceNodeId
    && left.tool?.name === right.tool?.name;
}

export function mergeWorkspaceActivity(items: WorkspaceActivityItem[], limit = DEFAULT_LIMIT) {
  const ordered = orderWorkspaceActivity(items).reverse();
  const merged: WorkspaceActivityItem[] = [];
  const seen = new Set<string>();

  for (const item of ordered) {
    const identity = getWorkspaceActivityIdentity(item);
    if (seen.has(identity)) continue;

    const previous = merged.at(-1);
    if (previous && canReplaceToolProgress(previous, item)) {
      merged[merged.length - 1] = item;
      seen.add(identity);
      continue;
    }

    seen.add(identity);
    merged.push(item);
  }

  return orderWorkspaceActivity(merged).slice(0, limit);
}


export function runtimeEventToWorkspaceActivity(event: WorkspaceRuntimeEvent, index = 0): WorkspaceActivityItem | null {
  const value = event.event;
  const base = {
    id: `runtime-${event.executionScope}-${event.sequence ?? index}-${value.type}`,
    timestamp: event.timestamp,
    sourceNodeId: event.nodeId,
    executionScope: event.executionScope,
    sourceNodeTitle: event.nodeTitle,
    provider: event.provider,
    runtime: event.runtime,
    sequence: event.sequence,
  } satisfies Partial<WorkspaceActivityItem>;

  if (value.type === "tool_started") {
    return {
      ...base,
      kind: "tool_started",
      title: "Tool started",
      summary: "Provider tool started.",
      description: "Provider tool started.",
      tone: "info",
      tool: { name: value.tool.label, label: value.label, state: "started" },
    };
  }

  if (value.type === "tool_progress") {
    return {
      ...base,
      kind: "tool_progress",
      title: "Tool in progress",
      summary: "Provider tool is running.",
      description: "Provider tool is running.",
      tone: "info",
      tool: { name: value.tool.label, label: value.label, state: "progress" },
    };
  }

  if (value.type === "tool_completed") {
    const failed = value.error !== undefined;
    return {
      ...base,
      kind: "tool_completed",
      title: failed ? "Tool failed" : "Tool completed",
      summary: failed ? "Provider tool failed." : "Provider tool completed.",
      description: failed ? "Provider tool failed." : "Provider tool completed.",
      tone: failed ? "danger" : "success",
      tool: {
        name: value.tool?.label,
        label: value.label,
        durationMs: value.durationMs,
        state: failed ? "failed" : "completed",
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
    return {
      ...base,
      kind: "provider_run",
      title: "Run status",
      summary: value.status,
      description: value.status,
      tone: value.status === "failed" ? "danger" : value.status === "completed" ? "success" : "info",
    };
  }

  return null;
}

export function runtimeEventsToWorkspaceActivity(events: WorkspaceRuntimeEvent[], limit = DEFAULT_LIMIT) {
  return mergeWorkspaceActivity(events.map((event, index) => runtimeEventToWorkspaceActivity(event, index)).filter((item): item is WorkspaceActivityItem => item !== null), limit);
}
