import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

import {
  runtimePayloadEvent,
  taskActivityItem,
  type ActivityCursor,
  type TaskActivityEvent,
  type TaskActivityPageInput,
  type TaskTimelineActivityItem,
  type WorkspaceActivityTimelineItem,
} from "./task-activity-types";
import {
  isDisplayableProviderEvent,
  mapProviderEventToActivity,
  providerActivityEventType,
  providerToolProgressMergeKey,
} from "./provider-activity";
import { mapTaskEventToActivity } from "./task-activity-mapper";

export type {
  TaskActivityEvent,
  TaskActivityPageInput,
  WorkspaceActivityGroup,
  WorkspaceActivityTimelineItem,
} from "./task-activity-types";

export function deduplicateProjectedActivity(items: WorkspaceActivityTimelineItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

type ActivityTimelineState = {
  items: WorkspaceActivityTimelineItem[];
  toolProgressIndexes: Map<string, number>;
};


function shouldSkipProviderEvent(
  event: TaskActivityEvent,
  eventType: string,
  payloadEvent: Record<string, unknown> | null,
) {
  return event.source === "provider" && !isDisplayableProviderEvent(eventType, payloadEvent);
}

function replaceToolProgress(
  state: ActivityTimelineState,
  event: TaskActivityEvent,
  eventType: string,
  payloadEvent: Record<string, unknown> | null,
) {
  if (event.source !== "provider" || !payloadEvent || eventType !== "tool_progress") return false;
  const progressKey = providerToolProgressMergeKey(event, payloadEvent);
  const progressItem = mapProviderEventToActivity(event);
  const existingIndex = state.toolProgressIndexes.get(progressKey);
  if (existingIndex === undefined) {
    state.toolProgressIndexes.set(progressKey, state.items.length);
    state.items.push(progressItem);
  } else {
    state.items[existingIndex] = progressItem;
  }
  return true;
}


export function buildActivityTimeline(events: TaskActivityEvent[]) {
  const state: ActivityTimelineState = {
    items: [],
    toolProgressIndexes: new Map(),
  };
  for (const event of events) {
    const payloadEvent = runtimePayloadEvent(event.payload);
    const eventType = providerActivityEventType(event, payloadEvent);
    if (shouldSkipProviderEvent(event, eventType, payloadEvent)) continue;
    if (replaceToolProgress(state, event, eventType, payloadEvent)) continue;
    const activity = mapTaskEventToActivity(event);
    if (activity) state.items.push(activity);
  }
  return state.items;
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
    id: item.eventId ?? item.id,
    kind: item.kind.startsWith("plan_execution.") ? "node" : "task",
    title: item.title,
    description: item.body ?? item.status ?? item.kind,
    tone: timelineTone(item.severity),
    timestamp: item.sortTime.toISOString(),
    sourceNodeId: item.nodeId ?? undefined,
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
