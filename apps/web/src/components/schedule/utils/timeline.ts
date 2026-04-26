import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  TIMELINE_SLOT_MINUTES,
} from "@/components/schedule/schedule-page-copy";
import type {
  CompressedTimelineHour,
  ScheduledItem,
  TimelinePlacementPreview,
} from "@/components/schedule/schedule-page-types";
import { toDateForDay, toTimestamp } from "@/components/schedule/utils/date";

export function snapMinuteToGrid(minute: number) {
  return Math.round(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES;
}

export function clampScheduledStartMinute(minute: number) {
  return Math.min(
    Math.max(minute, 0),
    24 * 60 - DEFAULT_SCHEDULE_BLOCK_MINUTES,
  );
}

export function clampScheduledEndMinute(
  startMinute: number,
  endMinute: number,
  minDuration = TIMELINE_SLOT_MINUTES,
) {
  return Math.min(Math.max(endMinute, startMinute + minDuration), 24 * 60);
}

export function getBlockDurationMinutes(item: {
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  const start = toTimestamp(item.scheduledStartAt);
  const end = toTimestamp(item.scheduledEndAt);

  if (start === null || end === null) {
    return DEFAULT_SCHEDULE_BLOCK_MINUTES;
  }

  return Math.max(Math.round((end - start) / 60000), TIMELINE_SLOT_MINUTES);
}

export function buildCompressedTimeline(items: ScheduledItem[]) {
  const activeHourHeight = 72;
  const idleHourHeight = 22;
  const dayStartMinute = 0;
  const dayEndMinute = 24 * 60;
  const hourActivity = Array.from({ length: 24 }, () => false);

  for (const item of items) {
    const start = item.scheduledStartAt
      ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes()
      : null;
    const end = item.scheduledEndAt
      ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
      : null;

    if (start === null) {
      continue;
    }

    const safeEnd = Math.max(end ?? start + 60, start + 45);
    const firstHour = Math.floor(start / 60);
    const lastHour = Math.min(23, Math.floor((safeEnd - 1) / 60));

    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      hourActivity[hour] = true;
    }
  }

  const hours: CompressedTimelineHour[] = [];
  let visualCursor = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const visualHeight = hourActivity[hour] ? activeHourHeight : idleHourHeight;
    hours.push({
      hour,
      startMinute: hour * 60,
      endMinute: (hour + 1) * 60,
      visualStart: visualCursor,
      visualHeight,
      active: hourActivity[hour],
    });
    visualCursor += visualHeight;
  }

  const compressedGapCount = hourActivity.filter((active) => !active).length;
  const visualMinutes = (visualCursor / activeHourHeight) * 60;

  function mapMinuteToY(minute: number) {
    const safeMinute = Math.min(Math.max(minute, dayStartMinute), dayEndMinute);

    if (safeMinute === dayEndMinute) {
      return visualCursor;
    }

    const hourIndex = Math.min(23, Math.floor(safeMinute / 60));
    const hour = hours[hourIndex];
    const minuteWithinHour = safeMinute - hour.startMinute;
    return hour.visualStart + (minuteWithinHour / 60) * hour.visualHeight;
  }

  function mapYToMinute(y: number) {
    const safeY = Math.min(Math.max(y, 0), visualCursor);

    if (safeY === visualCursor) {
      return dayEndMinute;
    }

    const hour =
      hours.find(
        (candidate) =>
          safeY >= candidate.visualStart &&
          safeY < candidate.visualStart + candidate.visualHeight,
      ) ?? hours[hours.length - 1];

    const relativeY = safeY - hour.visualStart;
    return hour.startMinute + (relativeY / hour.visualHeight) * 60;
  }

  return {
    hours,
    totalVisualHeight: Math.max(visualCursor, 320),
    compressedGapCount,
    visualMinutes,
    mapMinuteToY,
    mapYToMinute,
  };
}

export function detectScheduleConflicts(
  items: ScheduledItem[],
  candidate: { taskId?: string; startAt: Date; endAt: Date },
) {
  const conflicts = items.filter((item) => {
    if (!item.scheduledStartAt || !item.scheduledEndAt) {
      return false;
    }
    if (candidate.taskId && item.taskId === candidate.taskId) {
      return false;
    }
    return candidate.startAt < item.scheduledEndAt && candidate.endAt > item.scheduledStartAt;
  });

  return {
    hasConflict: conflicts.length > 0,
    conflictingTaskIds: conflicts.map((item) => item.taskId),
  };
}

export function buildTimelinePlacementPreview(args: {
  selectedDay: string;
  startMinute: number;
  endMinute: number;
  compressedTimeline: {
    mapMinuteToY: (minute: number) => number;
  };
  items: ScheduledItem[];
  taskId?: string;
  source: TimelinePlacementPreview["source"];
}): TimelinePlacementPreview {
  const top = args.compressedTimeline.mapMinuteToY(args.startMinute);
  const bottom = args.compressedTimeline.mapMinuteToY(args.endMinute);
  const startAt = toDateForDay(args.selectedDay, args.startMinute);
  const endAt = toDateForDay(args.selectedDay, args.endMinute);
  const { hasConflict, conflictingTaskIds } = detectScheduleConflicts(args.items, {
    taskId: args.taskId,
    startAt,
    endAt,
  });

  return {
    top,
    height: Math.max(bottom - top, 56),
    startMinute: args.startMinute,
    endMinute: args.endMinute,
    startAt,
    endAt,
    hasConflict,
    conflictingTaskIds,
    source: args.source,
  };
}
