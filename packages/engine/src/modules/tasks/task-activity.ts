import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export type WorkspaceActivityGroup = {
  kind: "plan_generation" | "execution_node" | "provider_run";
  id: string;
};

export type WorkspaceActivityTimelineItem = {
  id: string;
  kind:
    | "assistant_message"
    | "reasoning"
    | "tool_started"
    | "tool_progress"
    | "tool_completed"
    | "provider_run"
    | "approval"
    | "node"
    | "task"
    | "artifact"
    | "schedule"
    | "raw";
  title: string;
  summary: string;
  description: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  timestamp?: string | null;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  runId?: string;
  nativeRunId?: string;
  sequence?: number;
  rawEventType?: string;
  activityGroup?: WorkspaceActivityGroup;
  tool?: {
    name?: string;
    label?: string;
    callId?: string;
    resultPreview?: string;
    preview?: string;
    inputSummary?: string;
    durationMs?: number;
    error?: string;
    state: "started" | "progress" | "completed" | "failed";
  };
  assistant?: {
    text: string;
    isReasoning: boolean;
    isPartial?: boolean;
  };
  raw?: unknown;
};

function activityEventId(item: WorkspaceActivityTimelineItem) {
  if (!item.raw || typeof item.raw !== "object" || Array.isArray(item.raw))
    return undefined;
  const eventId = (item.raw as { eventId?: unknown }).eventId;
  return typeof eventId === "string" ? eventId : undefined;
}

export function deduplicateProjectedActivity(
  items: WorkspaceActivityTimelineItem[],
) {
  const canonicalEventIds = new Set(items.map((item) => item.id));
  return items.filter((item) => {
    const eventId = activityEventId(item);
    return !eventId || item.id === eventId || !canonicalEventIds.has(eventId);
  });
}

type TaskActivityEvent = {
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

type TaskTimelineActivityItem = {
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

type ActivityCursor = {
  source: "timeline" | "event";
  timestamp: Date;
};

type TaskActivityPageInput = {
  taskId: string;
  scope?: "task" | "node";
  nodeId?: string;
  cursor?: string;
  limit?: number;
};
function stringPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>)[key] === "string"
    ? (payload as Record<string, string>)[key]
    : null;
}

function payloadRecord(payload: unknown) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function runtimePayloadEvent(payload: unknown) {
  const record = payloadRecord(payload);
  const event = record?.event;
  return event && typeof event === "object" && !Array.isArray(event)
    ? (event as Record<string, unknown>)
    : null;
}

function arrayPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray((payload as Record<string, unknown>)[key])
    ? (payload as Record<string, unknown[]>)[key]
    : null;
}

function numberPayloadValue(payload: unknown, key: string) {
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>)[key] === "number"
    ? (payload as Record<string, number>)[key]
    : null;
}

function planGenerationActivityGroup(payload: unknown) {
  const id = stringPayloadValue(payload, "generation_id");
  return id ? { kind: "plan_generation" as const, id } : undefined;
}

function compactParts(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
}

function humanizeEventType(eventType: string) {
  return eventType
    .replace(/^[^.]+\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function providerActivityDescription(
  event: Record<string, unknown>,
  fallback: string,
) {
  if (typeof event.preview === "string" && event.preview.trim())
    return event.preview.trim();
  if (typeof event.text === "string" && event.text.trim())
    return event.text.trim();
  if (typeof event.toolName === "string" && event.toolName.trim())
    return event.toolName.trim();
  if (typeof event.tool === "string" && event.tool.trim())
    return event.tool.trim();
  if (typeof event.error === "string" && event.error.trim())
    return event.error.trim();
  const error = event.error;
  if (
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (typeof event.rawEventType === "string" && event.rawEventType.trim())
    return event.rawEventType.trim();
  return fallback;
}

function providerActivityToolLabel(
  event: Record<string, unknown>,
  fallback: string,
) {
  if (typeof event.label === "string" && event.label.trim())
    return event.label.trim();
  if (typeof event.toolName === "string" && event.toolName.trim())
    return event.toolName.trim();
  if (typeof event.tool === "string" && event.tool.trim())
    return event.tool.trim();
  return fallback;
}

function providerActivityError(event: Record<string, unknown>) {
  if (typeof event.error === "string" && event.error.trim())
    return event.error.trim();
  const error = event.error;
  if (
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return undefined;
}

function optionalStringEventValue(event: Record<string, unknown>, key: string) {
  return typeof event[key] === "string" && event[key].trim()
    ? (event[key] as string)
    : undefined;
}

function optionalNumberEventValue(event: Record<string, unknown>, key: string) {
  return typeof event[key] === "number" ? (event[key] as number) : undefined;
}
function compactJsonValue(value: unknown, maxLength = 4_000) {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(
    value,
    (key, nested) =>
      /token|secret|credential|password|api.?key|authorization|cookie/i.test(
        key,
      )
        ? "[redacted]"
        : nested,
    2,
  );
  if (!serialized) return undefined;
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength - 3)}...`
    : serialized;
}

function providerToolInputSummary(event: Record<string, unknown>) {
  return (
    optionalStringEventValue(event, "inputSummary") ??
    compactJsonValue(event.input)
  );
}

function providerToolResultPreview(event: Record<string, unknown>) {
  return (
    optionalStringEventValue(event, "preview") ??
    compactJsonValue(event.result) ??
    compactJsonValue(event.raw)
  );
}

function latestWorkflowProgress(raw: Record<string, unknown>) {
  const progress = arrayPayloadValue(raw, "workflow_progress") ?? [];
  for (const item of [...progress].reverse()) {
    const record = payloadRecord(item);
    if (record) return record;
  }
  return null;
}

function providerTaskProgressSummary(event: Record<string, unknown>) {
  const raw = payloadRecord(event.raw);
  if (!raw || raw.type !== "system" || raw.subtype !== "task_progress")
    return null;

  const progress = latestWorkflowProgress(raw);
  const usage = payloadRecord(raw.usage);
  const toolName =
    optionalStringEventValue(progress ?? {}, "lastToolName") ??
    optionalStringEventValue(raw, "last_tool_name");
  const toolSummary = optionalStringEventValue(
    progress ?? {},
    "lastToolSummary",
  );
  const toolUses = usage
    ? optionalNumberEventValue(usage, "tool_uses")
    : undefined;

  return (
    compactParts([
      optionalStringEventValue(raw, "description"),
      toolSummary ? `${toolName ?? "Tool"}: ${toolSummary}` : undefined,
      toolUses !== undefined ? `${toolUses} tool uses` : undefined,
    ]) ||
    optionalStringEventValue(raw, "summary") ||
    "Provider task progress."
  );
}

function providerRawMessage(event: Record<string, unknown>) {
  const raw = payloadRecord(event.raw);
  return raw ? optionalStringEventValue(raw, "message") : undefined;
}

function providerActivityText(event: Record<string, unknown>) {
  return typeof event.text === "string" ? event.text : null;
}

function providerActivityEventType(
  event: TaskActivityEvent,
  payloadEvent: Record<string, unknown> | null,
) {
  return payloadEvent && typeof payloadEvent.type === "string"
    ? payloadEvent.type
    : event.eventType.replace(/^provider\./, "");
}

function providerActivityMergeKey(event: TaskActivityEvent, eventType: string) {
  return [
    eventType,
    stringPayloadValue(event.payload, "runtimeName") ?? "runtime",
    stringPayloadValue(event.payload, "provider") ?? "provider",
    stringPayloadValue(event.payload, "runId") ?? "run",
    stringPayloadValue(event.payload, "nativeRunId") ?? "native",
    event.nodeId ?? "task",
  ].join(":");
}

function canonicalProviderLabel(
  event: TaskActivityEvent,
  payloadEvent: Record<string, unknown> | null,
) {
  const provider = stringPayloadValue(event.payload, "provider") ?? undefined;
  if (provider) return provider;
  if (
    payloadEvent &&
    typeof payloadEvent.provider === "string" &&
    payloadEvent.provider.trim()
  ) {
    return payloadEvent.provider.trim();
  }
  return "provider";
}

function isMergeableProviderTextEvent(eventType: string) {
  return eventType === "text_delta" || eventType === "reasoning_delta";
}

function isDisplayableProviderEvent(
  eventType: string,
  payloadEvent?: Record<string, unknown> | null,
) {
  return (
    eventType === "run_started" ||
    eventType === "text_delta" ||
    eventType === "reasoning_delta" ||
    eventType === "tool_call" ||
    eventType === "tool_progress" ||
    eventType === "tool_started" ||
    eventType === "tool_completed" ||
    eventType === "approval_required" ||
    eventType === "run_completed" ||
    eventType === "run_failed" ||
    eventType === "run_cancelled" ||
    (eventType === "raw_event" &&
      Boolean(
        payloadEvent &&
        (providerTaskProgressSummary(payloadEvent) ||
          providerRawMessage(payloadEvent)),
      ))
  );
}

function mapProviderEventToActivity(
  event: TaskActivityEvent,
): WorkspaceActivityTimelineItem {
  const payloadEvent = runtimePayloadEvent(event.payload);
  const provider = canonicalProviderLabel(event, payloadEvent);
  const runtimeName =
    stringPayloadValue(event.payload, "runtimeName") ?? undefined;
  const runId = stringPayloadValue(event.payload, "runId") ?? undefined;
  const nativeRunId =
    stringPayloadValue(event.payload, "nativeRunId") ?? undefined;
  const sequence = numberPayloadValue(event.payload, "sequence") ?? undefined;
  const eventType = providerActivityEventType(event, payloadEvent);
  const timestamp = (event.occurredAt ?? event.createdAt).toISOString();
  const payloadRecordValue = payloadEvent ?? payloadRecord(event.payload) ?? {};
  const progressSummary = providerTaskProgressSummary(payloadRecordValue);
  const rawEventType = progressSummary
    ? "task_progress"
    : (optionalStringEventValue(payloadRecordValue, "rawEventType") ??
      eventType);
  const withBase = (
    item: WorkspaceActivityTimelineItem,
  ): WorkspaceActivityTimelineItem => ({
    ...item,
    provider,
    runtimeName,
    runId,
    nativeRunId,
    sequence,
    rawEventType,
    raw: payloadEvent ?? event.payload,
    ...(event.nodeId ? { sourceNodeId: event.nodeId } : {}),
    ...(event.nodeTitle ? { sourceNodeTitle: event.nodeTitle } : {}),
  });

  switch (eventType) {
    case "run_started":
      return withBase({
        id: event.id,
        kind: "provider_run",
        title: "Provider run started",
        summary: provider,
        description: provider,
        tone: "info",
        timestamp,
      });
    case "text_delta":
      return withBase({
        id: event.id,
        kind: "assistant_message",
        title: "Assistant response",
        summary: providerActivityDescription(
          payloadRecordValue,
          "Assistant output streamed.",
        ),
        description: providerActivityDescription(
          payloadRecordValue,
          "Assistant output streamed.",
        ),
        tone: "info",
        timestamp,
        assistant: {
          text: providerActivityDescription(payloadRecordValue, ""),
          isReasoning: false,
          isPartial: true,
        },
      });
    case "reasoning_delta":
      return withBase({
        id: event.id,
        kind: "reasoning",
        title: "Reasoning",
        summary: providerActivityDescription(
          payloadRecordValue,
          "Reasoning streamed.",
        ),
        description: providerActivityDescription(
          payloadRecordValue,
          "Reasoning streamed.",
        ),
        tone: "neutral",
        timestamp,
        assistant: {
          text: providerActivityDescription(payloadRecordValue, ""),
          isReasoning: true,
          isPartial: true,
        },
      });
    case "tool_call":
    case "tool_started":
      return withBase({
        id: event.id,
        kind: "tool_started",
        title: "Tool started",
        summary: providerActivityDescription(
          payloadRecordValue,
          "Provider tool started.",
        ),
        description: providerActivityDescription(
          payloadRecordValue,
          "Provider tool started.",
        ),
        tone: "info",
        timestamp,
        tool: {
          name:
            optionalStringEventValue(payloadRecordValue, "toolName") ??
            optionalStringEventValue(payloadRecordValue, "tool"),
          label: providerActivityToolLabel(payloadRecordValue, "Provider tool"),
          callId: optionalStringEventValue(payloadRecordValue, "callId"),
          preview: optionalStringEventValue(payloadRecordValue, "preview"),
          inputSummary: providerToolInputSummary(payloadRecordValue),
          state: "started",
        },
      });
    case "tool_progress":
      return withBase({
        id: event.id,
        kind: "tool_progress",
        title: providerActivityToolLabel(payloadRecordValue, "Tool progress"),
        summary: providerActivityDescription(
          payloadRecordValue,
          "Tool is running.",
        ),
        description: providerActivityDescription(
          payloadRecordValue,
          "Tool is running.",
        ),
        tone: "info",
        timestamp,
        tool: {
          name: optionalStringEventValue(payloadRecordValue, "toolName"),
          label: providerActivityToolLabel(payloadRecordValue, "Tool progress"),
          callId: optionalStringEventValue(payloadRecordValue, "callId"),
          preview: optionalStringEventValue(payloadRecordValue, "preview"),
          state: "progress",
        },
      });
    case "tool_completed": {
      const error = providerActivityError(payloadRecordValue);
      const hasError = Boolean(error);
      return withBase({
        id: event.id,
        kind: "tool_completed",
        title: hasError ? "Tool failed" : "Tool completed",
        summary: providerActivityDescription(
          payloadRecordValue,
          "Provider tool completed.",
        ),
        description: providerActivityDescription(
          payloadRecordValue,
          "Provider tool completed.",
        ),
        tone: hasError ? "danger" : "success",
        timestamp,
        tool: {
          name:
            optionalStringEventValue(payloadRecordValue, "toolName") ??
            optionalStringEventValue(payloadRecordValue, "tool"),
          label: providerActivityToolLabel(payloadRecordValue, "Provider tool"),
          callId: optionalStringEventValue(payloadRecordValue, "callId"),
          resultPreview: hasError
            ? undefined
            : providerToolResultPreview(payloadRecordValue),
          durationMs: optionalNumberEventValue(
            payloadRecordValue,
            "durationMs",
          ),
          error,
          state: hasError ? "failed" : "completed",
        },
      });
    }
    case "raw_event": {
      const rawMessage = providerRawMessage(payloadRecordValue);
      if (progressSummary || rawMessage) {
        const message =
          rawMessage ?? progressSummary ?? "Provider task progress.";
        return withBase({
          id: event.id,
          kind: "provider_run",
          title: rawMessage ? "Agent lifecycle" : "Task progress",
          summary: message,
          description: message,
          tone: "info",
          timestamp,
        });
      }
      return withBase({
        id: event.id,
        kind: "raw",
        title: "Provider event",
        summary: providerActivityDescription(payloadRecordValue, rawEventType),
        description: providerActivityDescription(
          payloadRecordValue,
          rawEventType,
        ),
        tone: "neutral",
        timestamp,
      });
    }

    case "run_failed":
      return withBase({
        id: event.id,
        kind: "provider_run",
        title: "Provider run failed",
        summary: providerActivityDescription(payloadRecordValue, provider),
        description: providerActivityDescription(payloadRecordValue, provider),
        tone: "danger",
        timestamp,
      });
    case "run_cancelled":
      return withBase({
        id: event.id,
        kind: "provider_run",
        title: "Provider run cancelled",
        summary: provider,
        description: provider,
        tone: "warning",
        timestamp,
      });
    default:
      return withBase({
        id: event.id,
        kind: "raw",
        title: "Provider event",
        summary: providerActivityDescription(payloadRecordValue, eventType),
        description: providerActivityDescription(payloadRecordValue, eventType),
        tone: "neutral",
        timestamp,
      });
  }
}

function taskActivityItem(
  input: Omit<WorkspaceActivityTimelineItem, "summary"> & { summary?: string },
) {
  return {
    ...input,
    summary: input.summary ?? input.description,
  } satisfies WorkspaceActivityTimelineItem;
}

function eventTimestamp(event: TaskActivityEvent) {
  return (event.occurredAt ?? event.createdAt).toISOString();
}

function mapTaskEventToActivity(
  event: TaskActivityEvent,
): WorkspaceActivityTimelineItem {
  if (event.source === "provider" || event.eventType.startsWith("provider.")) {
    return mapProviderEventToActivity(event);
  }

  const timestamp = eventTimestamp(event);
  const payload = event.payload;

  switch (event.eventType) {
    case "task.created":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task created",
        description:
          compactParts([
            stringPayloadValue(payload, "title"),
            stringPayloadValue(payload, "status"),
            stringPayloadValue(payload, "priority"),
          ]) || "Task was created.",
        tone: "info",
        timestamp,
      });
    case "task.updated": {
      const changedFields =
        arrayPayloadValue(payload, "changed_fields")?.filter(
          (field): field is string => typeof field === "string",
        ) ?? [];
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task updated",
        description:
          changedFields.length > 0
            ? `Updated ${changedFields.join(", ")}`
            : "Task fields changed.",
        tone: "info",
        timestamp,
      });
    }
    case "task.deleted":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task deleted",
        description: "Task was deleted.",
        tone: "warning",
        timestamp,
      });
    case "task.result_accepted":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Result accepted",
        description:
          stringPayloadValue(payload, "summary") ?? "Task result was accepted.",
        tone: "success",
        timestamp,
      });
    case "task.reopened":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task reopened",
        description:
          stringPayloadValue(payload, "reason") ?? "Task was reopened.",
        tone: "warning",
        timestamp,
      });
    case "task.done":
    case "task.marked_done":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task completed",
        description:
          stringPayloadValue(payload, "reason") ?? "Task was marked done.",
        tone: "success",
        timestamp,
      });
    case "task.schedule_changed":
      return taskActivityItem({
        id: event.id,
        kind: "schedule",
        title: "Schedule changed",
        description:
          compactParts([
            stringPayloadValue(payload, "scheduledStartAt"),
            stringPayloadValue(payload, "scheduledEndAt"),
            stringPayloadValue(payload, "source"),
          ]) || "Task schedule changed.",
        tone: "info",
        timestamp,
      });
    case "task.schedule_proposed":
      return taskActivityItem({
        id: event.id,
        kind: "schedule",
        title: "Schedule proposed",
        description:
          stringPayloadValue(payload, "summary") ?? "A schedule was proposed.",
        tone: "info",
        timestamp,
      });
    case "task.auto_start.skipped":
      return taskActivityItem({
        id: event.id,
        kind: "schedule",
        title: "Auto-start skipped",
        description:
          stringPayloadValue(payload, "reason") ??
          "Scheduled task was not auto-started.",
        tone: "warning",
        timestamp,
      });
    case "plan_generation.started":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan generation started",
        description:
          stringPayloadValue(payload, "instruction") ??
          "Generating a task plan.",
        tone: "info",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.status":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan generation update",
        description:
          stringPayloadValue(payload, "message") ??
          stringPayloadValue(payload, "phase") ??
          "Plan generation progressed.",
        tone: "info",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.tool_called":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan tool called",
        description:
          compactParts([
            stringPayloadValue(payload, "tool"),
            stringPayloadValue(payload, "plan_title"),
            numberPayloadValue(payload, "node_count") !== null
              ? `${numberPayloadValue(payload, "node_count")} nodes`
              : null,
          ]) || "AI produced a plan blueprint.",
        tone: "info",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.draft_saved":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan draft saved",
        description:
          stringPayloadValue(payload, "plan_title") ??
          "Generated plan draft was saved.",
        tone: "success",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.completed":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan generated",
        description:
          stringPayloadValue(payload, "plan_title") ??
          "Plan generation completed.",
        tone: "success",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.failed":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan generation failed",
        description:
          stringPayloadValue(payload, "message") ??
          stringPayloadValue(payload, "code") ??
          "Plan generation failed.",
        tone: "danger",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    case "plan_generation.cancelled":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan generation cancelled",
        description: "Plan generation was cancelled.",
        tone: "warning",
        timestamp,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(payload),
      });
    default:
      if (
        event.eventType === "plan_execution.executable_path_computed" ||
        event.eventType === "plan_execution.plan_output_updated"
      ) {
        return taskActivityItem({
          id: event.id,
          kind: "raw",
          title: "Execution detail",
          description: humanizeEventType(event.eventType),
          tone: "neutral",
          timestamp,
          rawEventType: event.eventType,
        });
      }
      if (event.eventType.startsWith("plan_execution.")) {
        const title = humanizeEventType(event.eventType);
        const status = stringPayloadValue(payload, "status");
        const description =
          compactParts([
            event.nodeTitle,
            stringPayloadValue(payload, "checkpoint_id"),
            status,
          ]) || event.eventType;
        const tone =
          event.eventType.includes("failed") || status === "failed"
            ? "danger"
            : event.eventType.includes("completed") || status === "completed"
              ? "success"
              : "info";
        return taskActivityItem({
          id: event.id,
          kind: "node",
          title,
          description,
          tone,
          timestamp,
          sourceNodeId: event.nodeId ?? undefined,
          sourceNodeTitle: event.nodeTitle ?? undefined,
          rawEventType: event.eventType,
        });
      }
      return taskActivityItem({
        id: event.id,
        kind: "raw",
        title: "Task event",
        description: humanizeEventType(event.eventType),
        tone: "neutral",
        timestamp,
      });
  }
}

export function buildActivityTimeline(events: TaskActivityEvent[]) {
  const items: WorkspaceActivityTimelineItem[] = [];
  let currentTextSegment: {
    key: string;
    item: WorkspaceActivityTimelineItem;
  } | null = null;

  for (const event of events) {
    const payloadEvent = runtimePayloadEvent(event.payload);
    const eventType = providerActivityEventType(event, payloadEvent);

    if (
      event.source === "provider" &&
      !isDisplayableProviderEvent(eventType, payloadEvent)
    ) {
      currentTextSegment = null;
      continue;
    }

    if (
      event.source !== "provider" ||
      !payloadEvent ||
      !isMergeableProviderTextEvent(eventType)
    ) {
      currentTextSegment = null;
      items.push(mapTaskEventToActivity(event));
      continue;
    }

    const key = providerActivityMergeKey(event, eventType);
    const text = providerActivityText(payloadEvent) ?? "";
    const nextItem = mapProviderEventToActivity(event);

    if (currentTextSegment !== null && currentTextSegment.key === key) {
      currentTextSegment.item.description = `${currentTextSegment.item.description}${text}`;
      currentTextSegment.item.summary = currentTextSegment.item.description;
      currentTextSegment.item.assistant = {
        text: currentTextSegment.item.description,
        isReasoning: eventType === "reasoning_delta",
        isPartial: true,
      };
      currentTextSegment.item.timestamp = nextItem.timestamp;
      continue;
    }

    nextItem.description = text || nextItem.description;
    nextItem.summary = nextItem.description;
    if (nextItem.assistant) nextItem.assistant.text = nextItem.description;
    items.push(nextItem);
    currentTextSegment = { key, item: nextItem };
  }

  return items;
}

function activitySortValue(item: WorkspaceActivityTimelineItem) {
  return item.timestamp ? Date.parse(item.timestamp) : 0;
}

export function orderActivityNewestFirst(
  items: WorkspaceActivityTimelineItem[],
) {
  return [...items].sort((a, b) => {
    const timestampDelta = activitySortValue(b) - activitySortValue(a);
    if (timestampDelta !== 0) return timestampDelta;
    return (b.sequence ?? 0) - (a.sequence ?? 0);
  });
}

function timelineTone(
  severity: string | null,
): WorkspaceActivityTimelineItem["tone"] {
  if (severity === "warning") return "warning";
  if (severity === "danger" || severity === "error") return "danger";
  if (severity === "success") return "success";
  if (severity === "info") return "info";
  return "neutral";
}

export function mapTimelineItemToActivity(
  item: TaskTimelineActivityItem,
): WorkspaceActivityTimelineItem {
  return taskActivityItem({
    id: item.id,
    kind: item.kind.startsWith("plan_execution.") ? "node" : "task",
    title: item.title,
    description: item.body ?? item.status ?? item.kind,
    tone: timelineTone(item.severity),
    timestamp: item.sortTime.toISOString(),
    sourceNodeId: item.nodeId ?? undefined,
    raw: { metadata: item.metadata, eventId: item.eventId ?? undefined },
  });
}

async function resolveActivityCursor(
  cursor: string | undefined,
): Promise<ActivityCursor | null> {
  if (!cursor) return null;

  const timelineItem = await db.taskTimelineItem.findUnique({
    where: { id: cursor },
    select: { sortTime: true },
  });
  if (timelineItem)
    return { source: "timeline", timestamp: timelineItem.sortTime };

  const event = await db.event.findUnique({
    where: { id: cursor },
    select: { occurredAt: true, createdAt: true },
  });
  if (event)
    return { source: "event", timestamp: event.occurredAt ?? event.createdAt };

  return null;
}

function timelineCursorWhere<T extends Record<string, unknown>>(
  where: T,
  cursor: ActivityCursor | null,
) {
  if (!cursor) return where;

  return {
    ...where,
    sortTime: { lt: cursor.timestamp },
  };
}

function eventCursorWhere<T extends Record<string, unknown>>(
  where: T,
  cursor: ActivityCursor | null,
) {
  if (!cursor) return where;

  return {
    ...where,
    OR: [
      { occurredAt: { lt: cursor.timestamp } },
      { occurredAt: null, createdAt: { lt: cursor.timestamp } },
    ],
  };
}

async function getMergedActivity(input: {
  taskId: string;
  nodeId?: string;
  cursor?: string;
  limit: number;
}) {
  const cursor = await resolveActivityCursor(input.cursor);
  const take = Math.min(input.limit * 3, 3000) + 1;
  const baseWhere = input.nodeId
    ? { taskId: input.taskId, nodeId: input.nodeId }
    : { taskId: input.taskId };
  const [timelineItems, events] = await Promise.all([
    db.taskTimelineItem.findMany({
      where: timelineCursorWhere(baseWhere, cursor),
      orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.event.findMany({
      where: eventCursorWhere(baseWhere, cursor),
      orderBy: [
        { occurredAt: "desc" },
        { createdAt: "desc" },
        { ingestSequence: "desc" },
      ],
      take,
    }),
  ]);
  const activity = orderActivityNewestFirst(
    deduplicateProjectedActivity([
      ...timelineItems.map(mapTimelineItemToActivity),
      ...buildActivityTimeline([...events].reverse()),
    ]),
  );
  const items = activity.slice(0, input.limit);

  return {
    items,
    nextCursor: activity.length > input.limit ? items.at(-1)?.id : undefined,
  };
}
export async function getTaskActivityPage(input: TaskActivityPageInput) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 3000);
  const scope = input.scope ?? "task";
  if (scope === "node" && !input.nodeId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "nodeId is required for node activity",
    );
  }
  const activity = await getMergedActivity({
    taskId: input.taskId,
    ...(scope === "node" && input.nodeId ? { nodeId: input.nodeId } : {}),
    cursor: input.cursor,
    limit,
  });

  return {
    items: activity.items,
    nextCursor: activity.nextCursor,
    scope: {
      type: scope,
      taskId: input.taskId,
      ...(scope === "node" && input.nodeId ? { nodeId: input.nodeId } : {}),
      limit,
    },
  };
}
