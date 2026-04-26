/**
 * Re-exports from split utility modules.
 * Prefer importing from specific sub-modules for better tree-shaking:
 *   @/components/schedule/utils/date
 *   @/components/schedule/utils/format
 *   @/components/schedule/utils/tone
 *   @/components/schedule/utils/timeline
 *   @/components/schedule/utils/item-transforms
 *   @/components/schedule/utils/state
 *   @/components/schedule/utils/hydrate
 */

// date
export {
  getDayKey,
  toTimestamp,
  toDate,
  formatDateKey,
  startOfDay,
  addDays,
  startOfWeek,
  parseDayKey,
  toDateForDay,
  getTodayKey,
} from "@/components/schedule/utils/date";

// format
export {
  formatDateTime,
  formatTime,
  formatDayHeading,
  formatWeekdayShort,
  describeOwner,
  formatTimeRange,
  formatShortDay,
  formatDurationMinutes,
} from "@/components/schedule/utils/format";

// tone
export {
  getPriorityAccent,
  getPriorityTone,
  getScheduleTone,
  getRunTone,
  getRunnabilityTone,
} from "@/components/schedule/utils/tone";

// timeline
export {
  snapMinuteToGrid,
  clampScheduledStartMinute,
  clampScheduledEndMinute,
  getBlockDurationMinutes,
  buildCompressedTimeline,
  detectScheduleConflicts,
  buildTimelinePlacementPreview,
} from "@/components/schedule/utils/timeline";

// item-transforms
export {
  moveScheduledItem,
  createScheduledItemFromQueueItem,
  createScheduledItemFromCreateInput,
  createListItemFromScheduledItem,
  applyScheduleToListItem,
  applyTaskConfigToItem,
  toTaskConfigInitialValues,
  buildQuickCreateDraft,
} from "@/components/schedule/utils/item-transforms";

// state
export {
  buildWeekGroups,
  sortScheduledItems,
  buildTodayFocusItems,
  buildScheduleHref,
  buildScheduleViewHref,
  normalizeScheduleView,
  buildPlanningSummary,
} from "@/components/schedule/utils/state";

// hydrate
export { hydrateSchedulePageData } from "@/components/schedule/utils/hydrate";
