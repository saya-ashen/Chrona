import type {
  TaskActivityEvent,
  WorkspaceActivityTimelineItem,
} from "./task-activity-types";
import {
  executionActivityMetadata,
  numberPayloadValue,
  payloadRecord,
  runtimePayloadEvent,
  stringPayloadValue,
} from "./task-activity-types";

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
      /token|secret|credential|password|api.?key|authorization|cookie/i.test(key)
        ? "[redacted]"
        : nested,
    2,
  );
  if (!serialized) return undefined;
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength - 3)}...`
    : serialized;
}

function redactActivityRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactActivityRaw);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      /token|secret|credential|password|api.?key|authorization|cookie/i.test(key)
        ? "[redacted]"
        : redactActivityRaw(nested),
    ]),
  );
}

function providerActivityDescription(event: Record<string, unknown>, fallback: string) {
  const text = ["preview", "text", "toolName", "tool", "error"]
    .map((key) => optionalStringEventValue(event, key))
    .find(Boolean);
  if (text) return text;
  const error = payloadRecord(event.error);
  const errorMessage = optionalStringEventValue(error ?? {}, "message");
  return errorMessage ?? optionalStringEventValue(event, "rawEventType") ?? fallback;
}

function providerActivityToolLabel(event: Record<string, unknown>, fallback: string) {
  return optionalStringEventValue(event, "label") ??
    optionalStringEventValue(event, "toolName") ??
    optionalStringEventValue(event, "tool") ??
    fallback;
}

function providerActivityError(event: Record<string, unknown>) {
  return optionalStringEventValue(event, "error") ??
    optionalStringEventValue(payloadRecord(event.error) ?? {}, "message");
}

function providerToolInputSummary(event: Record<string, unknown>) {
  return optionalStringEventValue(event, "inputSummary") ?? compactJsonValue(event.input);
}

function providerToolResultPreview(event: Record<string, unknown>) {
  return optionalStringEventValue(event, "preview") ??
    compactJsonValue(event.result) ??
    compactJsonValue(event.raw);
}

function latestWorkflowProgress(raw: Record<string, unknown>) {
  const progress = Array.isArray(raw.workflow_progress) ? raw.workflow_progress : [];
  return [...progress].reverse().map(payloadRecord).find(Boolean) ?? null;
}

function providerTaskProgressSummary(event: Record<string, unknown>) {
  const raw = payloadRecord(event.raw);
  if (raw?.type !== "system" || raw.subtype !== "task_progress") return null;
  const progress = latestWorkflowProgress(raw) ?? {};
  const usage = payloadRecord(raw.usage);
  const toolName = optionalStringEventValue(progress, "lastToolName") ??
    optionalStringEventValue(raw, "last_tool_name");
  const toolSummary = optionalStringEventValue(progress, "lastToolSummary");
  const toolUses = usage ? optionalNumberEventValue(usage, "tool_uses") : undefined;
  const parts = [
    optionalStringEventValue(raw, "description"),
    toolSummary ? `${toolName ?? "Tool"}: ${toolSummary}` : undefined,
    toolUses !== undefined ? `${toolUses} tool uses` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || optionalStringEventValue(raw, "summary") || "Provider task progress.";
}

function providerRawMessage(event: Record<string, unknown>) {
  return optionalStringEventValue(payloadRecord(event.raw) ?? {}, "message");
}

function providerActivityEventType(event: TaskActivityEvent, payloadEvent: Record<string, unknown> | null) {
  return typeof payloadEvent?.type === "string"
    ? payloadEvent.type
    : event.eventType.replace(/^provider\./, "");
}

function canonicalProviderLabel(event: TaskActivityEvent, payloadEvent: Record<string, unknown> | null) {
  return stringPayloadValue(event.payload, "provider") ??
    optionalStringEventValue(payloadEvent ?? {}, "provider") ??
    "provider";
}

export function isMergeableProviderTextEvent(eventType: string) {
  return eventType === "text_delta" || eventType === "reasoning_delta";
}

export function isDisplayableProviderEvent(eventType: string, payloadEvent?: Record<string, unknown> | null) {
  const displayable = new Set([
    "run_started", "text_delta", "reasoning_delta", "tool_call", "tool_progress",
    "tool_started", "tool_completed", "approval_required", "run_completed", "run_failed", "run_cancelled",
  ]);
  return displayable.has(eventType) ||
    (eventType === "raw_event" && Boolean(payloadEvent && (providerTaskProgressSummary(payloadEvent) || providerRawMessage(payloadEvent))));
}

// Provider payload normalization deliberately covers all supported runtime event shapes.
// eslint-disable-next-line complexity
function providerBase(event: TaskActivityEvent) {
  const payloadEvent = runtimePayloadEvent(event.payload);
  const payload = payloadEvent ?? payloadRecord(event.payload) ?? {};
  const eventType = providerActivityEventType(event, payloadEvent);
  const progressSummary = providerTaskProgressSummary(payload);
  const rawEventType = progressSummary
    ? "task_progress"
    : optionalStringEventValue(payload, "rawEventType") ?? eventType;
  const timestamp = (event.occurredAt ?? event.createdAt).toISOString();
  const base = {
    provider: canonicalProviderLabel(event, payloadEvent),
    runtimeName: stringPayloadValue(event.payload, "runtimeName") ?? undefined,
    runId: stringPayloadValue(event.payload, "runId") ?? undefined,
    nativeRunId: stringPayloadValue(event.payload, "nativeRunId") ?? undefined,
    sequence: numberPayloadValue(event.payload, "sequence") ?? undefined,
    rawEventType,
    raw: redactActivityRaw(payloadEvent ?? event.payload),
    ...executionActivityMetadata(event.payload),
    ...(event.nodeId ? { sourceNodeId: event.nodeId } : {}),
    ...(event.nodeTitle ? { sourceNodeTitle: event.nodeTitle } : {}),
  };
  return { payload, eventType, progressSummary, timestamp, base };
}

// Timeline construction keeps the user-visible activity fields explicit at each call site.
// eslint-disable-next-line max-params
function providerItem(
  event: TaskActivityEvent,
  kind: WorkspaceActivityTimelineItem["kind"],
  title: string,
  description: string,
  tone: WorkspaceActivityTimelineItem["tone"],
  extras: Partial<WorkspaceActivityTimelineItem> = {},
) {
  const { base, timestamp } = providerBase(event);
  return { id: event.id, kind, title, summary: description, description, tone, timestamp, ...extras, ...base };
}

function streamMessageItem(event: TaskActivityEvent, reasoning: boolean) {
  const { payload } = providerBase(event);
  const fallback = reasoning ? "Reasoning streamed." : "Assistant output streamed.";
  const description = providerActivityDescription(payload, fallback);
  return providerItem(event, reasoning ? "reasoning" : "assistant_message", reasoning ? "Reasoning" : "Assistant response", description, reasoning ? "neutral" : "info", {
    assistant: { text: providerActivityDescription(payload, ""), isReasoning: reasoning, isPartial: true },
  });
}

// Tool lifecycle mapping keeps started, progress, completed, and failure states exhaustive.
// eslint-disable-next-line complexity
function toolItem(event: TaskActivityEvent, state: "started" | "progress" | "completed") {
  const { payload } = providerBase(event);
  const error = state === "completed" ? providerActivityError(payload) : undefined;
  const failed = Boolean(error);
  const fallback = state === "started" ? "Provider tool started." : state === "progress" ? "Tool is running." : "Provider tool completed.";
  const label = providerActivityToolLabel(payload, state === "progress" ? "Tool progress" : "Provider tool");
  return providerItem(
    event,
    state === "started" ? "tool_started" : state === "progress" ? "tool_progress" : "tool_completed",
    state === "completed" ? (failed ? "Tool failed" : "Tool completed") : state === "started" ? "Tool started" : label,
    providerActivityDescription(payload, fallback),
    failed ? "danger" : state === "completed" ? "success" : "info",
    {
      tool: {
        name: optionalStringEventValue(payload, "toolName") ?? optionalStringEventValue(payload, "tool"),
        label,
        callId: optionalStringEventValue(payload, "callId"),
        ...(state === "started" ? { preview: optionalStringEventValue(payload, "preview"), inputSummary: providerToolInputSummary(payload) } : {}),
        ...(state === "completed" ? { resultPreview: failed ? undefined : providerToolResultPreview(payload), durationMs: optionalNumberEventValue(payload, "durationMs"), error } : {}),
        state: failed ? "failed" : state,
      },
    },
  );
}

function rawProviderItem(event: TaskActivityEvent) {
  const { payload, eventType, progressSummary } = providerBase(event);
  const rawMessage = providerRawMessage(payload);
  if (progressSummary || rawMessage) {
    const message = rawMessage ?? progressSummary ?? "Provider task progress.";
    return providerItem(event, "provider_run", rawMessage ? "Agent lifecycle" : "Task progress", message, "info");
  }
  const fallback = optionalStringEventValue(payload, "rawEventType") ?? eventType;
  return providerItem(event, "raw", "Provider event", providerActivityDescription(payload, fallback), "neutral");
}

export function mapProviderEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  const eventType = providerBase(event).eventType;
  switch (eventType) {
    case "run_started": return providerItem(event, "provider_run", "Provider run started", providerBase(event).base.provider, "info");
    case "text_delta": return streamMessageItem(event, false);
    case "reasoning_delta": return streamMessageItem(event, true);
    case "tool_call":
    case "tool_started": return toolItem(event, "started");
    case "tool_progress": return toolItem(event, "progress");
    case "tool_completed": return toolItem(event, "completed");
    case "approval_required": return providerItem(event, "approval", "Approval required", providerActivityDescription(providerBase(event).payload, "Provider approval required."), "warning");
    case "raw_event": return rawProviderItem(event);
    case "run_failed": return providerItem(event, "provider_run", "Provider run failed", providerActivityDescription(providerBase(event).payload, providerBase(event).base.provider), "danger");
    case "run_cancelled": return providerItem(event, "provider_run", "Provider run cancelled", providerBase(event).base.provider, "warning");
    default: return rawProviderItem(event);
  }
}

export function providerActivityMergeKey(event: TaskActivityEvent, eventType: string) {
  return [
    eventType,
    stringPayloadValue(event.payload, "runtimeName") ?? "runtime",
    stringPayloadValue(event.payload, "provider") ?? "provider",
    stringPayloadValue(event.payload, "runId") ?? "run",
    stringPayloadValue(event.payload, "nativeRunId") ?? "native",
    event.nodeId ?? "task",
  ].join(":");
}

export function providerToolProgressMergeKey(event: TaskActivityEvent, payloadEvent: Record<string, unknown>) {
  return [
    providerActivityMergeKey(event, "tool_progress"),
    optionalStringEventValue(payloadEvent, "callId") ?? "call",
    optionalStringEventValue(payloadEvent, "toolName") ?? "tool",
  ].join(":");
}

export function providerActivityText(event: Record<string, unknown>) {
  return typeof event.text === "string" ? event.text : null;
}

export { providerActivityEventType };
