import {
  DEFAULT_SCHEDULE_PAGE_COPY,
  type SchedulePageCopy,
} from "@/components/schedule/schedule-page-copy";

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

export function formatWeekdayShort(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    weekday: "short",
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
