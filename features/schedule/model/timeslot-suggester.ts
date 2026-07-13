import type {
  TimeslotOptions,
  TimeslotSuggestion,
  TimeslotSuggestionInput,
  TimeslotSuggestionResult,
} from "@chrona/contracts";

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function atHour(anchor: Date, hour: number) {
  const value = new Date(anchor);
  value.setUTCHours(hour, 0, 0, 0);
  return value;
}

function scoreSlot(
  input: TimeslotSuggestionInput,
  startAt: Date,
  endAt: Date,
  workdayStart: Date,
) {
  let score = 100;
  const hour = startAt.getUTCHours() + startAt.getUTCMinutes() / 60;
  const priority = input.priority.toLowerCase();

  if (priority === "urgent") score -= minutesBetween(workdayStart, startAt) / 6;
  if (priority === "high") score += hour < 12 ? 20 : -10;
  if (input.title.toLowerCase().includes("meeting")) score += hour >= 12 ? 15 : -5;
  if (input.dueAt && endAt.getTime() > input.dueAt.getTime()) score -= 60;

  return Math.max(1, Math.round(score));
}

function buildNoFitSuggestion(input: TimeslotSuggestionInput): TimeslotSuggestion {
  const anchor = input.currentSchedule[0]?.startAt ?? new Date();
  const startAt = atHour(anchor, 9);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + input.estimatedMinutes * 60_000),
    score: 0,
    reasons: ["No suitable time slot found"],
    conflicts: ["No available gap can fit the requested duration"],
  };
}

function addGapSuggestion(
  suggestions: TimeslotSuggestion[],
  input: TimeslotSuggestionInput,
  startAt: Date,
  gapEnd: Date,
  durationMs: number,
  workdayStart: Date,
) {
  const endAt = new Date(startAt.getTime() + durationMs);
  if (endAt > gapEnd) {
    return;
  }

  if (suggestions.some((item) => item.startAt.getTime() === startAt.getTime())) {
    return;
  }

  suggestions.push({
    startAt,
    endAt,
    score: scoreSlot(input, startAt, endAt, workdayStart),
    reasons: ["Fits an available schedule gap"],
    conflicts: [],
  });
}

export function suggestTimeslots(
  input: TimeslotSuggestionInput,
  options: TimeslotOptions = {},
): TimeslotSuggestionResult {
  const workdayStartHour = options.workdayStartHour ?? 9;
  const workdayEndHour = options.workdayEndHour ?? 18;
  const bufferMinutes = options.bufferMinutes ?? 0;
  const maxSuggestions = options.maxSuggestions ?? 5;
  const anchor = input.currentSchedule[0]?.startAt ?? input.dueAt ?? new Date();
  const workdayStart = atHour(anchor, workdayStartHour);
  const workdayEnd = atHour(anchor, workdayEndHour);
  const durationMs = input.estimatedMinutes * 60_000;
  const bufferMs = bufferMinutes * 60_000;
  const schedule = [...input.currentSchedule]
    .filter((slot) => slot.endAt > workdayStart && slot.startAt < workdayEnd)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const suggestions: TimeslotSuggestion[] = [];

  let cursor = workdayStart;
  for (const slot of schedule) {
    const gapStart = new Date(cursor.getTime() + bufferMs);
    const gapEnd = new Date(Math.min(slot.startAt.getTime() - bufferMs, workdayEnd.getTime()));

    if (gapEnd.getTime() - gapStart.getTime() >= durationMs) {
      addGapSuggestion(suggestions, input, gapStart, gapEnd, durationMs, workdayStart);
      if (input.title.toLowerCase().includes("meeting")) {
        const afternoonStart = atHour(gapStart, 13);
        if (afternoonStart > gapStart) {
          addGapSuggestion(suggestions, input, afternoonStart, gapEnd, durationMs, workdayStart);
        }
      }
    }

    if (slot.endAt > cursor) cursor = slot.endAt;
  }

  const tailStart = new Date(cursor.getTime() + (schedule.length > 0 ? bufferMs : 0));
  if (workdayEnd.getTime() - tailStart.getTime() >= durationMs) {
    addGapSuggestion(suggestions, input, tailStart, workdayEnd, durationMs, workdayStart);
    if (input.title.toLowerCase().includes("meeting")) {
      const afternoonStart = atHour(tailStart, 13);
      if (afternoonStart > tailStart) {
        addGapSuggestion(suggestions, input, afternoonStart, workdayEnd, durationMs, workdayStart);
      }
    }
  }

  if (suggestions.length === 0) {
    const fallback = buildNoFitSuggestion(input);
    return { suggestions: [fallback], bestMatch: null };
  }

  suggestions.sort((left, right) => right.score - left.score);
  const limited = suggestions.slice(0, maxSuggestions);
  return { suggestions: limited, bestMatch: limited[0] ?? null };
}
