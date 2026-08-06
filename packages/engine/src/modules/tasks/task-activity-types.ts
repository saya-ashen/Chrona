export type WorkspaceActivityGroup = {
  kind: "plan_generation" | "execution_node" | "provider_run";
  id: string;
};

export type WorkspaceActivityTimelineItem = {
  id: string;
  kind:
    | "tool_started"
    | "tool_progress"
    | "tool_completed"
    | "provider_run"
    | "approval"
    | "node"
    | "task"
    | "artifact"
    | "schedule";
  title: string;
  summary: string;
  description: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  timestamp?: string | null;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  executionScope?: string;
  sequence?: number;
  executionTrigger?: "initial" | "restart";
  activityGroup?: WorkspaceActivityGroup;
  providerInput?: unknown;
  providerOutput?: unknown;
  providerRaw?: unknown;
  tool?: {
    name?: string;
    durationMs?: number;
    state: "started" | "progress" | "completed" | "failed";
  };
};

export type TaskActivityEvent = {
  id: string;
  eventType: string;
  source: string;
  nodeId: string | null;
  nodeTitle: string | null;
  payload: unknown;
  occurredAt: Date | null;
  createdAt: Date;
  ingestSequence?: number | bigint | null;
};

export type TaskTimelineActivityItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  severity: string | null;
  status: string | null;
  nodeId: string | null;
  eventId?: string | null;
  sortTime: Date;
  metadata: unknown;
};

export type ActivityCursor = {
  source: "timeline" | "event";
  timestamp: Date;
};

export type TaskActivityPageInput = {
  taskId: string;
  scope?: "task" | "node";
  nodeId?: string;
  cursor?: string;
  limit?: number;
};

export function stringPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>)[key] === "string"
    ? (payload as Record<string, string>)[key]
    : null;
}

export function payloadRecord(payload: unknown) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function runtimePayloadEvent(payload: unknown) {
  const record = payloadRecord(payload);
  const event = record?.event;
  return event && typeof event === "object" && !Array.isArray(event)
    ? (event as Record<string, unknown>)
    : null;
}

export function arrayPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray((payload as Record<string, unknown>)[key])
    ? (payload as Record<string, unknown[]>)[key]
    : null;
}

export function numberPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>)[key] === "number"
    ? (payload as Record<string, number>)[key]
    : null;
}

export function planGenerationActivityGroup(payload: unknown) {
  const id = stringPayloadValue(payload, "generation_id");
  return id ? { kind: "plan_generation" as const, id } : undefined;
}

export function executionActivityMetadata(payload: unknown) {
  const record = payloadRecord(payload);
  const correlation = payloadRecord(record?.correlation);
  const executionSessionId = typeof correlation?.executionSessionId === "string"
    ? correlation.executionSessionId
    : undefined;
  const executionTrigger = record?.command === "restart_from_beginning"
    ? "restart" as const
    : executionSessionId
      ? "initial" as const
      : undefined;
  return { executionTrigger };
}

export function compactParts(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
}

export function humanizeEventType(eventType: string) {
  return eventType
    .replace(/^[^.]+\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function taskActivityItem(
  input: Omit<WorkspaceActivityTimelineItem, "summary"> & { summary?: string },
) {
  return {
    ...input,
    summary: input.summary ?? input.description,
  } satisfies WorkspaceActivityTimelineItem;
}
