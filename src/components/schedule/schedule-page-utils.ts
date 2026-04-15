import type { Prisma } from "@/generated/prisma/client";
import type { TaskConfigFormInput } from "@/components/schedule/task-config-form";
import {
  DEFAULT_SCHEDULE_BLOCK_MINUTES,
  DEFAULT_SCHEDULE_PAGE_COPY,
  TIMELINE_SLOT_MINUTES,
  type SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";
import type {
  CompressedTimelineHour,
  ListItem,
  QuickCreateDraft,
  ScheduleCardItem,
  SchedulePageData,
  SchedulePageProps,
  SchedulePlanningSummary,
  ScheduleRecord,
  ScheduleViewMode,
  ScheduledDayGroup,
  ScheduledItem,
  TimelineCreateInput,
  TimelinePlacementPreview,
  TodayFocusItem,
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

export function formatDateTime(value: Date | null | undefined, locale: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatTime(value: Date | null | undefined, locale: string) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatDayHeading(
  value: Date | null | undefined,
  locale = "en",
  copy: SchedulePageCopy = DEFAULT_SCHEDULE_PAGE_COPY,
) {
  if (!value) {
    return copy.noScheduledStart;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

export function describeOwner(
  ownerType: string,
  assigneeAgentId: string | null,
  copy: Pick<
    SchedulePageCopy,
    "agentPrefix" | "agentAssigned" | "humanOwned"
  >,
) {
  if (ownerType === "agent") {
    return assigneeAgentId
      ? `${copy.agentPrefix} · ${assigneeAgentId}`
      : copy.agentAssigned;
  }

  return copy.humanOwned;
}

export function formatTimeRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
  locale: string,
  copy: Pick<SchedulePageCopy, "timeNotSet">,
) {
  if (!start && !end) {
    return copy.timeNotSet;
  }

  return `${formatTime(start, locale)} → ${formatTime(end, locale)}`;
}

export function getPriorityAccent(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-amber-500";
    case "medium":
      return "bg-sky-500";
    default:
      return "bg-emerald-500";
  }
}

export function getPriorityTone(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "critical" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    default:
      return "success" as const;
  }
}

export function getScheduleTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "overdue":
    case "blocked":
      return "critical" as const;
    case "atrisk":
    case "at risk":
      return "warning" as const;
    case "scheduled":
    case "inprogress":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

export function getRunTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "completed":
      return "success" as const;
    case "waitingforapproval":
    case "waitingforinput":
      return "warning" as const;
    case "failed":
    case "cancelled":
      return "critical" as const;
    default:
      return "info" as const;
  }
}

export function getRunnabilityTone(isRunnable: boolean | undefined) {
  return isRunnable ? ("success" as const) : ("warning" as const);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateKeyParts(year: number, month: number, day: number) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

export function getDayKey(value: Date | null | undefined) {
  return value
    ? formatLocalDateKeyParts(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      )
    : "unspecified";
}

export function formatShortDay(
  value: Date | null | undefined,
  locale: string,
  copy: Pick<SchedulePageCopy, "unscheduled">,
) {
  if (!value) {
    return copy.unscheduled;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    day: "numeric",
  }).format(value);
}

export function formatDateKey(value: Date) {
  return formatLocalDateKeyParts(
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
  );
}

export function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfWeek(value: Date) {
  const day = value.getDay();
  const offset = (day + 6) % 7;
  return addDays(startOfDay(value), -offset);
}

export function parseDayKey(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parts = value.split("-").map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return startOfDay(new Date(parts[0], parts[1] - 1, parts[2]));
}

export function toDateForDay(dayKey: string, minute: number) {
  const date = parseDayKey(dayKey) ?? startOfDay(new Date());
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

export function getTodayKey() {
  return formatDateKey(startOfDay(new Date()));
}

export function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

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
  const start = item.scheduledStartAt ? item.scheduledStartAt.getTime() : null;
  const end = item.scheduledEndAt ? item.scheduledEndAt.getTime() : null;

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

export function buildWeekGroups(
  items: SchedulePageProps["data"]["scheduled"],
  proposals: SchedulePageProps["data"]["proposals"],
  risks: SchedulePageProps["data"]["risks"],
  referenceDay: string | undefined,
  locale: string,
  copy: SchedulePageCopy,
) {
  const anchorDate = parseDayKey(referenceDay) ?? startOfDay(new Date());
  const weekStart = startOfWeek(anchorDate);
  const groups: ScheduledDayGroup[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);

    return {
      key: formatDateKey(date),
      date,
      label: formatDayHeading(date, locale, copy),
      items: [],
      proposalCount: 0,
      riskCount: 0,
    };
  });

  const groupMap = new Map(groups.map((group) => [group.key, group]));

  for (const proposal of proposals) {
    const group = groupMap.get(getDayKey(proposal.scheduledStartAt));
    if (group) {
      group.proposalCount += 1;
    }
  }

  for (const risk of risks) {
    const group = groupMap.get(getDayKey(risk.scheduledStartAt));
    if (group) {
      group.riskCount += 1;
    }
  }

  for (const item of items) {
    const group = groupMap.get(getDayKey(item.scheduledStartAt));
    if (group) {
      group.items.push(item);
    }
  }

  return groups.map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }),
  }));
}

export function sortScheduledItems(items: ScheduledItem[]) {
  return [...items].sort((a, b) => {
    const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
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

export function moveScheduledItem(
  item: ScheduledItem,
  startAt: Date,
  endAt: Date,
): ScheduledItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
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

function roundUpToQuarterHour(value: Date) {
  const next = new Date(value);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  const rounded = Math.ceil(minutes / 15) * 15;

  if (rounded === 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }

  next.setMinutes(rounded, 0, 0);
  return next;
}

export function buildQuickCreateDraft(args: {
  title: string;
  selectedDay: string;
  now?: Date;
  priority?: QuickCreateDraft["priority"];
  durationMinutes?: number;
}): QuickCreateDraft {
  const now = args.now ?? new Date();
  const selectedDate = parseDayKey(args.selectedDay) ?? startOfDay(now);
  const sameDay = formatDateKey(selectedDate) === formatDateKey(now);
  const scheduledStartAt = sameDay
    ? roundUpToQuarterHour(now)
    : new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        9,
        0,
        0,
        0,
      );
  const scheduledEndAt = new Date(scheduledStartAt.getTime());
  scheduledEndAt.setMinutes(
    scheduledEndAt.getMinutes() + (args.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES),
  );

  return {
    title: args.title.trim(),
    dueAt: null,
    scheduledStartAt,
    scheduledEndAt,
    priority: args.priority ?? "Medium",
  };
}

export function parseQuickCreateCommand(
  command: string,
  referenceDate = new Date(),
): QuickCreateDraft | null {
  const normalized = command.trim();

  if (!normalized) {
    return null;
  }

  const priorityMatch = normalized.match(/!(low|medium|high|urgent)\b/i);
  const timeMatch = normalized.match(/@\s*(\d{1,2})(?::(\d{2}))?/i);
  const durationMatch = normalized.match(/for\s+(\d+)\s*(m|min|h)\b/i);
  const dueMatch = normalized.match(/due\s+(\d{1,2})(?::(\d{2}))?/i);
  const title = normalized
    .replace(/!(low|medium|high|urgent)\b/gi, "")
    .replace(/@\s*\d{1,2}(?::\d{2})?/gi, "")
    .replace(/for\s+\d+\s*(m|min|h)\b/gi, "")
    .replace(/due\s+\d{1,2}(?::\d{2})?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const priority = (priorityMatch?.[1]
    ? `${priorityMatch[1].slice(0, 1).toUpperCase()}${priorityMatch[1].slice(1).toLowerCase()}`
    : "Medium") as QuickCreateDraft["priority"];
  const dueAt = dueMatch
    ? new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate(),
        Number(dueMatch[1]),
        Number(dueMatch[2] ?? "0"),
        0,
        0,
      )
    : null;

  if (!timeMatch) {
    return {
      title,
      dueAt,
      scheduledStartAt: null,
      scheduledEndAt: null,
      priority,
    };
  }

  const scheduledStartAt = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    Number(timeMatch[1]),
    Number(timeMatch[2] ?? "0"),
    0,
    0,
  );
  const durationAmount = Number(durationMatch?.[1] ?? DEFAULT_SCHEDULE_BLOCK_MINUTES);
  const durationMinutes = durationMatch?.[2]?.toLowerCase() === "h" ? durationAmount * 60 : durationAmount;
  const scheduledEndAt = new Date(scheduledStartAt.getTime());
  scheduledEndAt.setMinutes(scheduledEndAt.getMinutes() + durationMinutes);

  return {
    title,
    dueAt,
    scheduledStartAt,
    scheduledEndAt,
    priority,
  };
}

export function createScheduledItemFromQueueItem(
  item: UnscheduledItem,
  startAt: Date,
  endAt: Date,
): ScheduledItem {
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    title: item.title,
    priority: item.priority,
    ownerType: item.ownerType,
    assigneeAgentId: item.assigneeAgentId,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
    approvalPendingCount: item.approvalPendingCount,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
    description: item.description,
    runtimeAdapterKey: item.runtimeAdapterKey,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion,
    runtimeModel: item.runtimeModel,
    prompt: item.prompt,
    runtimeConfig: item.runtimeConfig,
    isRunnable: item.isRunnable,
    runnabilityState: item.runnabilityState,
    runnabilitySummary: item.runnabilitySummary,
  };
}

export function createScheduledItemFromCreateInput(
  taskId: string,
  workspaceId: string,
  workspaceDefaultRuntime: string,
  input: TimelineCreateInput,
): ScheduledItem {
  const runnability = deriveTaskRunnability({
    workspaceDefaultRuntime,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
  });

  return {
    taskId,
    workspaceId,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    ownerType: "human",
    assigneeAgentId: null,
    persistedStatus: runnability.isRunnable ? "Ready" : "Draft",
    displayState: null,
    actionRequired: runnability.isRunnable ? null : runnability.summary,
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: new Date(),
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
  };
}

export function createListItemFromScheduledItem(item: ScheduledItem): ListItem {
  return {
    ...item,
    displayState: item.displayState,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
  };
}

export function applyScheduleToListItem(
  item: ListItem,
  startAt: Date,
  endAt: Date,
): ListItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
  };
}

export function applyTaskConfigToItem<
  T extends ScheduledItem | UnscheduledItem | ListItem | ScheduleRecord,
>(item: T, input: TaskConfigFormInput): T {
  const runtimeConfig = input.runtimeConfig ?? null;
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
  });

  return {
    ...item,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: input.dueAt,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
    persistedStatus:
      item.persistedStatus === "Draft" || item.persistedStatus === "Ready"
        ? runnability.isRunnable
          ? "Ready"
          : "Draft"
        : item.persistedStatus,
    actionRequired: runnability.isRunnable ? item.actionRequired : runnability.summary,
  };
}

export function buildTodayFocusItems(
  data: SchedulePageData,
  activeGroup: ScheduledDayGroup | null,
  copy: Pick<
    SchedulePageCopy,
    | "focusOverdue"
    | "focusWaitingForInput"
    | "focusWaitingForApproval"
    | "focusAtRisk"
    | "focusReadyToday"
  >,
): TodayFocusItem[] {
  const focus = new Map<string, TodayFocusItem>();

  function push(
    item: ScheduleCardItem,
    reason: string,
    tone: TodayFocusItem["tone"],
  ) {
    if (focus.has(item.taskId)) {
      return;
    }

    focus.set(item.taskId, {
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.title,
      reason,
      tone,
    });
  }

  for (const item of data.risks) {
    if (item.scheduleStatus === "Overdue") {
      push(item, copy.focusOverdue, "critical");
      continue;
    }

    if (
      item.latestRunStatus === "WaitingForInput" ||
      item.displayState === "WaitingForInput"
    ) {
      push(item, copy.focusWaitingForInput, "warning");
      continue;
    }

    if (
      item.latestRunStatus === "WaitingForApproval" ||
      item.displayState === "WaitingForApproval"
    ) {
      push(item, copy.focusWaitingForApproval, "warning");
      continue;
    }

    push(item, copy.focusAtRisk, "warning");
  }

  for (const item of activeGroup?.items ?? []) {
    const isHighPriority = item.priority === "High" || item.priority === "Urgent";
    const hasStarted = Boolean(
      item.latestRunStatus && item.latestRunStatus !== "Pending",
    );

    if (!hasStarted && isHighPriority) {
      push(item, copy.focusReadyToday, "info");
    }
  }

  return Array.from(focus.values()).slice(0, 5);
}

export function buildScheduleHref(day: string, taskId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  return `/schedule?${params.toString()}`;
}

export function buildScheduleViewHref(
  day: string,
  view: ScheduleViewMode,
  taskId?: string,
) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  if (view === "list") {
    params.set("view", view);
  }

  return `/schedule?${params.toString()}`;
}

export function normalizeScheduleView(view: string | undefined): ScheduleViewMode {
  return view === "list" ? "list" : "timeline";
}

export function toTaskConfigInitialValues(item: {
  title: string;
  description?: string | null;
  priority: string;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  dueAt?: Date | null;
  runtimeConfig?: unknown;
}) {
  return {
    title: item.title,
    description: item.description ?? null,
    priority: item.priority as TaskConfigFormInput["priority"],
    runtimeAdapterKey: item.runtimeAdapterKey ?? null,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion ?? null,
    runtimeModel: item.runtimeModel ?? null,
    prompt: item.prompt ?? null,
    dueAt: item.dueAt ?? null,
    runtimeConfig: item.runtimeConfig,
  };
}

function getScheduledMinutesForItem(item: {
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  if (!item.scheduledStartAt || !item.scheduledEndAt) {
    return DEFAULT_SCHEDULE_BLOCK_MINUTES;
  }

  return Math.max(
    Math.round((item.scheduledEndAt.getTime() - item.scheduledStartAt.getTime()) / 60000),
    TIMELINE_SLOT_MINUTES,
  );
}

function countScheduleConflicts(items: ScheduledItem[]) {
  const byDay = new Map<string, ScheduledItem[]>();

  for (const item of items) {
    const dayKey = getDayKey(item.scheduledStartAt);
    const group = byDay.get(dayKey) ?? [];
    group.push(item);
    byDay.set(dayKey, group);
  }

  let conflicts = 0;

  for (const dayItems of byDay.values()) {
    const sorted = [...dayItems].sort((left, right) => {
      const leftStart = left.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = sorted[index - 1].scheduledEndAt?.getTime() ?? 0;
      const currentStart = sorted[index].scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

      if (currentStart < previousEnd) {
        conflicts += 1;
      }
    }
  }

  return conflicts;
}

function countOverloadedDays(items: ScheduledItem[]) {
  const minutesByDay = new Map<string, number>();

  for (const item of items) {
    const key = getDayKey(item.scheduledStartAt);
    minutesByDay.set(
      key,
      (minutesByDay.get(key) ?? 0) + getScheduledMinutesForItem(item),
    );
  }

  return Array.from(minutesByDay.values()).filter((minutes) => minutes > 8 * 60)
    .length;
}

function countOverloadedMinutes(items: ScheduledItem[]) {
  const minutesByDay = new Map<string, number>();

  for (const item of items) {
    const key = getDayKey(item.scheduledStartAt);
    minutesByDay.set(
      key,
      (minutesByDay.get(key) ?? 0) + getScheduledMinutesForItem(item),
    );
  }

  return Array.from(minutesByDay.values()).reduce(
    (total, minutes) => total + Math.max(0, minutes - 8 * 60),
    0,
  );
}

function getLargestIdleWindowMinutes(items: ScheduledItem[]) {
  const byDay = new Map<string, ScheduledItem[]>();

  for (const item of items) {
    const dayKey = getDayKey(item.scheduledStartAt);
    const group = byDay.get(dayKey) ?? [];
    group.push(item);
    byDay.set(dayKey, group);
  }

  let largestGap = 0;

  for (const dayItems of byDay.values()) {
    const sorted = [...dayItems].sort((left, right) => {
      const leftStart = left.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = sorted[index - 1].scheduledEndAt?.getTime() ?? 0;
      const currentStart = sorted[index].scheduledStartAt?.getTime() ?? previousEnd;
      largestGap = Math.max(largestGap, Math.round((currentStart - previousEnd) / 60000));
    }
  }

  return largestGap;
}

function countDueSoonUnscheduledItems(items: UnscheduledItem[]) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1).getTime();

  return items.filter((item) => {
    if (!item.dueAt) {
      return false;
    }

    const dueAt = item.dueAt.getTime();
    return dueAt >= today.getTime() && dueAt < tomorrow;
  }).length;
}

export function buildPlanningSummary(input: {
  scheduled: ScheduledItem[];
  unscheduled: UnscheduledItem[];
  proposals: SchedulePageData["proposals"];
  risks: SchedulePageData["risks"];
}): SchedulePlanningSummary {
  const todayKey = getTodayKey();

  return {
    scheduledMinutes: input.scheduled.reduce(
      (total, item) => total + getScheduledMinutesForItem(item),
      0,
    ),
    runnableQueueCount: input.unscheduled.filter((item) => item.isRunnable).length,
    conflictCount: countScheduleConflicts(input.scheduled),
    overloadedDayCount: countOverloadedDays(input.scheduled),
    proposalCount: input.proposals.length,
    riskCount: input.risks.length,
    todayLoadMinutes: input.scheduled.reduce((total, item) => {
      const key = getDayKey(item.scheduledStartAt);
      return key === todayKey ? total + getScheduledMinutesForItem(item) : total;
    }, 0),
    overdueCount: input.scheduled.filter((item) => item.scheduleStatus === "Overdue").length,
    atRiskCount: input.scheduled.filter((item) => item.scheduleStatus === "AtRisk").length,
    readyToScheduleCount: input.unscheduled.filter(
      (item) => item.scheduleStatus === "Unscheduled",
    ).length,
    autoRunnableCount: input.unscheduled.filter((item) => item.isRunnable).length,
    waitingOnUserCount: input.risks.filter(
      (item) =>
        item.actionRequired === "Schedule task" ||
        item.actionRequired === "Reschedule task" ||
        item.latestRunStatus === "WaitingForInput" ||
        item.displayState === "WaitingForInput" ||
        item.latestRunStatus === "WaitingForApproval" ||
        item.displayState === "WaitingForApproval",
    ).length,
    dueSoonUnscheduledCount: countDueSoonUnscheduledItems(input.unscheduled),
    largestIdleWindowMinutes: getLargestIdleWindowMinutes(input.scheduled),
    overloadedMinutes: countOverloadedMinutes(input.scheduled),
  };
}
