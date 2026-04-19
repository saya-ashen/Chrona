function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateKeyParts(year: number, month: number, day: number) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

export function getDayKey(value: Date | string | null | undefined) {
  if (!value) return "unspecified";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "unspecified";
  return formatLocalDateKeyParts(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
  );
}

/**
 * Safely extract a Unix-ms timestamp from a Date or ISO string.
 * Returns `null` for nullish / invalid inputs.
 */
export function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Safely convert a Date-or-string into a real Date object.
 * Returns `null` for nullish / invalid inputs.
 */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(d.getTime()) ? d : null;
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
