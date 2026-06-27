/**
 * Re-exports from split utility modules.
 * Prefer importing from specific sub-modules for better tree-shaking:
 *   ./utils/date
 *   ./utils/format
 *   ./utils/tone
 *   ./utils/timeline
 *   ./utils/item-transforms
 *   ./utils/state
 *   ./utils/hydrate
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
} from "./utils/date";

// format
export {
  formatDateTime,
  formatTime,
  formatDayHeading,
  formatWeekdayShort,
  formatTimeRange,
  formatShortDay,
  formatDurationMinutes,
} from "./utils/format";

// tone
export {
  getPriorityAccent,
  getPriorityTone,
  getScheduleTone,
  getRunTone,
  getRunnabilityTone,
} from "./utils/tone";

// timeline
export {
  snapMinuteToGrid,
  clampScheduledStartMinute,
  clampScheduledEndMinute,
  getBlockDurationMinutes,
  buildCompressedTimeline,
  detectScheduleConflicts,
  buildTimelinePlacementPreview,
} from "./utils/timeline";

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
} from "./utils/item-transforms";

// state
export {
  buildWeekGroups,
  sortScheduledItems,
  buildTodayFocusItems,
  buildScheduleHref,
  buildScheduleViewHref,
  normalizeScheduleView,
  buildPlanningSummary,
} from "./utils/state";

// hydrate
export { hydrateSchedulePageData } from "./utils/hydrate";
