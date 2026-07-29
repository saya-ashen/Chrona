import type { TaskActivityEvent, WorkspaceActivityTimelineItem } from "./task-activity-types";
import {
  compactParts,
  arrayPayloadValue,
  executionActivityMetadata,
  humanizeEventType,
  numberPayloadValue,
  planGenerationActivityGroup,
  stringPayloadValue,
  taskActivityItem,
} from "./task-activity-types";
import { mapProviderEventToActivity } from "./provider-activity";

type TaskEventDetails = {
  kind: WorkspaceActivityTimelineItem["kind"];
  title: string;
  description: string;
  tone: WorkspaceActivityTimelineItem["tone"];
  extra?: Partial<WorkspaceActivityTimelineItem>;
};

function taskEvent(
  event: TaskActivityEvent,
  { kind, title, description, tone, extra = {} }: TaskEventDetails,
) {
  return taskActivityItem({
    id: event.id,
    kind,
    title,
    description,
    tone,
    timestamp: (event.occurredAt ?? event.createdAt).toISOString(),
    ...extra,
  });
}

function taskLifecycleActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem | null {
  const descriptions: Partial<Record<string, TaskEventDetails>> = {
    "task.created": { kind: "task", title: "Task created", description: compactParts([stringPayloadValue(event.payload, "title"), stringPayloadValue(event.payload, "status"), stringPayloadValue(event.payload, "priority")]) || "Task was created.", tone: "info" },
    "task.deleted": { kind: "task", title: "Task deleted", description: "Task was deleted.", tone: "warning" },
    "task.result_accepted": { kind: "task", title: "Result accepted", description: stringPayloadValue(event.payload, "summary") ?? "Task result was accepted.", tone: "success" },
    "task.reopened": { kind: "task", title: "Task reopened", description: stringPayloadValue(event.payload, "reason") ?? "Task was reopened.", tone: "warning" },
    "task.done": { kind: "task", title: "Task completed", description: stringPayloadValue(event.payload, "reason") ?? "Task was marked done.", tone: "success" },
    "task.marked_done": { kind: "task", title: "Task completed", description: stringPayloadValue(event.payload, "reason") ?? "Task was marked done.", tone: "success" },
    "task.schedule_changed": { kind: "schedule", title: "Schedule changed", description: compactParts([stringPayloadValue(event.payload, "scheduledStartAt"), stringPayloadValue(event.payload, "scheduledEndAt"), stringPayloadValue(event.payload, "source")]) || "Task schedule changed.", tone: "info" },
    "task.schedule_proposed": { kind: "schedule", title: "Schedule proposed", description: stringPayloadValue(event.payload, "summary") ?? "A schedule was proposed.", tone: "info" },
    "task.auto_start.skipped": { kind: "schedule", title: "Auto-start skipped", description: stringPayloadValue(event.payload, "reason") ?? "Scheduled task was not auto-started.", tone: "warning" },
  };
  const definition = descriptions[event.eventType];
  return definition ? taskEvent(event, definition) : null;
}

function updatedTaskActivity(event: TaskActivityEvent) {
  const changedFields = arrayPayloadValue(event.payload, "changed_fields")
    ?.filter((field): field is string => typeof field === "string")
    ?? [];
  return taskEvent(event, { kind: "task", title: "Task updated", description: changedFields.length > 0 ? `Updated ${changedFields.join(", ")}` : "Task fields changed.", tone: "info" });
}

function planGenerationActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem | null {
  const details: Partial<Record<string, TaskEventDetails>> = {
    "plan_generation.started": { kind: "task", title: "Plan generation started", description: stringPayloadValue(event.payload, "instruction") ?? "Generating a task plan.", tone: "info" },
    "plan_generation.status": { kind: "task", title: "Plan generation update", description: stringPayloadValue(event.payload, "message") ?? stringPayloadValue(event.payload, "phase") ?? "Plan generation progressed.", tone: "info" },
    "plan_generation.draft_saved": { kind: "task", title: "Plan draft saved", description: stringPayloadValue(event.payload, "plan_title") ?? "Generated plan draft was saved.", tone: "success" },
    "plan_generation.completed": { kind: "task", title: "Plan generated", description: stringPayloadValue(event.payload, "plan_title") ?? "Plan generation completed.", tone: "success" },
    "plan_generation.failed": { kind: "task", title: "Plan generation failed", description: stringPayloadValue(event.payload, "message") ?? stringPayloadValue(event.payload, "code") ?? "Plan generation failed.", tone: "danger" },
    "plan_generation.cancelled": { kind: "task", title: "Plan generation cancelled", description: "Plan generation was cancelled.", tone: "warning" },
  };
  if (event.eventType === "plan_generation.tool_called") {
    return taskEvent(event, {
      kind: "task",
      title: "Plan tool called",
      description: compactParts([
        stringPayloadValue(event.payload, "tool"),
        stringPayloadValue(event.payload, "plan_title"),
        numberPayloadValue(event.payload, "node_count") !== null ? `${numberPayloadValue(event.payload, "node_count")} nodes` : null,
      ]) || "AI produced a plan blueprint.",
      tone: "info",
      extra: {
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(event.payload),
      },
    });
  }
  const detail = details[event.eventType];
  return detail
    ? taskEvent(event, {
      ...detail,
      extra: {
        ...detail.extra,
        rawEventType: event.eventType,
        activityGroup: planGenerationActivityGroup(event.payload),
      },
    })
    : null;
}

function planExecutionActivity(event: TaskActivityEvent) {
  const status = stringPayloadValue(event.payload, "status");
  const description = compactParts([event.nodeTitle, stringPayloadValue(event.payload, "checkpoint_id"), status]) || event.eventType;
  const tone = event.eventType.includes("failed") || status === "failed"
    ? "danger"
    : event.eventType.includes("completed") || status === "completed" ? "success" : "info";
  return taskEvent(event, {
    kind: "node",
    title: humanizeEventType(event.eventType),
    description,
    tone,
    extra: {
      sourceNodeId: event.nodeId ?? undefined,
      sourceNodeTitle: event.nodeTitle ?? undefined,
      rawEventType: event.eventType,
      ...executionActivityMetadata(event.payload),
    },
  });
}

export function mapTaskEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  if (event.source === "provider" || event.eventType.startsWith("provider.")) return mapProviderEventToActivity(event);
  if (event.eventType === "task.updated") return updatedTaskActivity(event);
  const lifecycle = taskLifecycleActivity(event);
  if (lifecycle) return lifecycle;
  const generation = planGenerationActivity(event);
  if (generation) return generation;
  if (event.eventType === "plan_execution.executable_path_computed" || event.eventType === "plan_execution.plan_output_updated") {
    return taskEvent(event, { kind: "raw", title: "Execution detail", description: humanizeEventType(event.eventType), tone: "neutral", extra: { rawEventType: event.eventType } });
  }
  if (event.eventType.startsWith("plan_execution.")) return planExecutionActivity(event);
  return taskEvent(event, { kind: "raw", title: "Task event", description: humanizeEventType(event.eventType), tone: "neutral" });
}
