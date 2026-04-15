import type {
  TimeslotSuggestionInput,
  TimeslotSuggestionResult,
  TimeslotSuggestion,
  TimeslotOptions,
  ScheduleSlot,
} from "./types";

const DEFAULT_OPTIONS: Required<TimeslotOptions> = {
  workdayStartHour: 9,
  workdayEndHour: 18,
  bufferMinutes: 15,
  maxSuggestions: 5,
};

/**
 * Represents a gap (free window) in the schedule.
 */
interface Gap {
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  /** Minutes remaining before the gap (from previous task end to gap start) — 0 if gap starts at workday start */
  gapBeforeMinutes: number;
  /** Minutes remaining after the gap (from gap end to next task start) — 0 if gap ends at workday end */
  gapAfterMinutes: number;
}

/**
 * Extract the reference date from the schedule or default to today.
 */
function getReferenceDate(input: TimeslotSuggestionInput): Date {
  if (input.currentSchedule.length > 0) {
    return new Date(input.currentSchedule[0].startAt);
  }
  return new Date();
}

/**
 * Build workday boundaries for the reference date.
 */
function getWorkdayBounds(
  referenceDate: Date,
  opts: Required<TimeslotOptions>,
): { workdayStart: Date; workdayEnd: Date } {
  const workdayStart = new Date(referenceDate);
  workdayStart.setUTCHours(opts.workdayStartHour, 0, 0, 0);

  const workdayEnd = new Date(referenceDate);
  workdayEnd.setUTCHours(opts.workdayEndHour, 0, 0, 0);

  return { workdayStart, workdayEnd };
}

/**
 * Sort schedule slots by start time ascending.
 */
function sortSchedule(schedule: ScheduleSlot[]): ScheduleSlot[] {
  return [...schedule].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
}

/**
 * Find all free gaps in the schedule within workday boundaries.
 */
function findGaps(
  schedule: ScheduleSlot[],
  workdayStart: Date,
  workdayEnd: Date,
  bufferMinutes: number,
): Gap[] {
  const sorted = sortSchedule(schedule);
  const gaps: Gap[] = [];

  // Filter to only tasks that overlap with the workday
  const relevantSlots = sorted.filter(
    (s) =>
      new Date(s.endAt).getTime() > workdayStart.getTime() &&
      new Date(s.startAt).getTime() < workdayEnd.getTime(),
  );

  // Clamp slots to workday boundaries
  const clampedSlots = relevantSlots.map((s) => ({
    ...s,
    startAt: new Date(
      Math.max(new Date(s.startAt).getTime(), workdayStart.getTime()),
    ),
    endAt: new Date(
      Math.min(new Date(s.endAt).getTime(), workdayEnd.getTime()),
    ),
  }));

  // Build ordered boundary points
  let cursor = workdayStart.getTime();

  for (const slot of clampedSlots) {
    const slotStart = new Date(slot.startAt).getTime();
    const slotEnd = new Date(slot.endAt).getTime();

    // Account for buffer: we need buffer after previous task
    const effectiveCursor = cursor === workdayStart.getTime()
      ? cursor
      : cursor + bufferMinutes * 60_000;

    // Account for buffer: we need buffer before next task
    const effectiveSlotStart = slotStart - bufferMinutes * 60_000;

    if (effectiveSlotStart > effectiveCursor) {
      const gapStart = new Date(effectiveCursor);
      const gapEnd = new Date(effectiveSlotStart);
      const durationMinutes = (effectiveSlotStart - effectiveCursor) / 60_000;

      // Calculate surrounding space
      const gapBeforeMinutes =
        cursor === workdayStart.getTime()
          ? 0
          : bufferMinutes;
      const gapAfterMinutes = bufferMinutes;

      gaps.push({
        startAt: gapStart,
        endAt: gapEnd,
        durationMinutes,
        gapBeforeMinutes,
        gapAfterMinutes,
      });
    }

    cursor = Math.max(cursor, slotEnd);
  }

  // Gap after the last task to workday end
  const effectiveCursor =
    cursor === workdayStart.getTime()
      ? cursor
      : cursor + bufferMinutes * 60_000;

  if (effectiveCursor < workdayEnd.getTime()) {
    const gapStart = new Date(effectiveCursor);
    const gapEnd = workdayEnd;
    const durationMinutes =
      (workdayEnd.getTime() - effectiveCursor) / 60_000;

    gaps.push({
      startAt: gapStart,
      endAt: gapEnd,
      durationMinutes,
      gapBeforeMinutes:
        cursor === workdayStart.getTime() ? 0 : bufferMinutes,
      gapAfterMinutes: 0,
    });
  }

  return gaps;
}

/**
 * Score a potential timeslot placement within a gap.
 *
 * Base score = 100, then apply bonuses/penalties.
 */
function scoreSlot(
  slotStart: Date,
  slotEnd: Date,
  gap: Gap,
  input: TimeslotSuggestionInput,
  opts: Required<TimeslotOptions>,
): { score: number; reasons: string[]; conflicts: string[] } {
  let score = 100;
  const reasons: string[] = [];
  const conflicts: string[] = [];

  const hour = slotStart.getUTCHours();
  const priority = input.priority;

  // --- Time-of-day preference ---
  // Morning (9-12): great for deep work / high-priority tasks
  if (hour >= 9 && hour < 12) {
    if (priority === "Urgent" || priority === "High") {
      score += 20;
      reasons.push("Morning slot ideal for high-priority deep work");
    } else {
      score += 5;
      reasons.push("Morning slot");
    }
  }

  // Early afternoon (12-14): good for meetings / lighter tasks
  if (hour >= 12 && hour < 14) {
    const titleLower = input.title.toLowerCase();
    const isMeeting =
      titleLower.includes("meeting") ||
      titleLower.includes("sync") ||
      titleLower.includes("standup") ||
      titleLower.includes("call") ||
      titleLower.includes("review");

    if (isMeeting) {
      score += 15;
      reasons.push("Early afternoon suits meetings and syncs");
    } else {
      score += 0; // neutral
    }
  }

  // Late afternoon (14-16): decent for medium-priority work
  if (hour >= 14 && hour < 16) {
    if (priority === "Medium") {
      score += 10;
      reasons.push("Afternoon slot works well for medium-priority tasks");
    }
  }

  // End of day (16-18): best for low-priority / wrap-up
  if (hour >= 16 && hour < 18) {
    if (priority === "Low") {
      score += 10;
      reasons.push("End of day suitable for low-priority tasks");
    } else if (priority === "Urgent" || priority === "High") {
      score -= 10;
      reasons.push("End of day less ideal for urgent tasks");
    }
  }

  // --- Fragmentation penalty ---
  // If placing the task would leave a small gap (< 30 min) before or after,
  // that's wasteful fragmentation.
  const remainingBefore =
    (slotStart.getTime() - gap.startAt.getTime()) / 60_000;
  const remainingAfter =
    (gap.endAt.getTime() - slotEnd.getTime()) / 60_000;

  if (remainingBefore > 0 && remainingBefore < 30) {
    score -= 15;
    conflicts.push(
      `Creates ${Math.round(remainingBefore)}min fragment before slot`,
    );
  }

  if (remainingAfter > 0 && remainingAfter < 30) {
    score -= 15;
    conflicts.push(
      `Creates ${Math.round(remainingAfter)}min fragment after slot`,
    );
  }

  // Bonus if slot perfectly fills the gap (no fragments)
  if (Math.abs(remainingBefore) < 1 && Math.abs(remainingAfter) < 1) {
    score += 10;
    reasons.push("Perfectly fills available gap");
  }

  // --- Due date proximity penalty ---
  if (input.dueAt) {
    const dueTime = new Date(input.dueAt).getTime();
    const endTime = slotEnd.getTime();
    const hoursBeforeDue = (dueTime - endTime) / (1000 * 60 * 60);

    if (endTime > dueTime) {
      score -= 40;
      conflicts.push("Slot ends after task due date");
    } else if (hoursBeforeDue < 1) {
      score -= 20;
      conflicts.push("Less than 1 hour before due date");
    } else if (hoursBeforeDue < 4) {
      score -= 10;
      conflicts.push("Less than 4 hours before due date");
    } else {
      score += 5;
      reasons.push("Comfortable margin before due date");
    }
  }

  // --- Priority urgency bonus for earlier slots ---
  if (priority === "Urgent") {
    // Prefer the earliest possible slot
    const minutesFromWorkdayStart =
      (slotStart.getTime() -
        new Date(slotStart).setUTCHours(opts.workdayStartHour, 0, 0, 0)) /
      60_000;
    const earlinessBonus = Math.max(0, 20 - minutesFromWorkdayStart / 15);
    score += earlinessBonus;
    if (earlinessBonus > 10) {
      reasons.push("Early slot prioritized for urgent task");
    }
  }

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, reasons, conflicts };
}

/**
 * Generate candidate timeslot suggestions from available gaps.
 */
function generateCandidates(
  gaps: Gap[],
  input: TimeslotSuggestionInput,
  opts: Required<TimeslotOptions>,
): TimeslotSuggestion[] {
  const candidates: TimeslotSuggestion[] = [];
  const neededMinutes = input.estimatedMinutes;

  for (const gap of gaps) {
    if (gap.durationMinutes < neededMinutes) {
      continue; // Gap too small
    }

    // Strategy 1: Place at the start of the gap
    const startAtBeginning = new Date(gap.startAt);
    const endAtBeginning = new Date(
      startAtBeginning.getTime() + neededMinutes * 60_000,
    );

    const startScore = scoreSlot(
      startAtBeginning,
      endAtBeginning,
      gap,
      input,
      opts,
    );

    candidates.push({
      startAt: startAtBeginning,
      endAt: endAtBeginning,
      ...startScore,
    });

    // Strategy 2: Place at the end of the gap (if different from start)
    if (gap.durationMinutes > neededMinutes + 5) {
      const endAtEnd = new Date(gap.endAt);
      const startAtEnd = new Date(
        endAtEnd.getTime() - neededMinutes * 60_000,
      );

      const endScore = scoreSlot(startAtEnd, endAtEnd, gap, input, opts);

      candidates.push({
        startAt: startAtEnd,
        endAt: endAtEnd,
        ...endScore,
      });
    }

    // Strategy 3: Center in the gap (if substantially larger)
    if (gap.durationMinutes > neededMinutes + 30) {
      const gapCenter =
        gap.startAt.getTime() +
        (gap.endAt.getTime() - gap.startAt.getTime()) / 2;
      const startAtCenter = new Date(
        gapCenter - (neededMinutes * 60_000) / 2,
      );
      const endAtCenter = new Date(
        gapCenter + (neededMinutes * 60_000) / 2,
      );

      const centerScore = scoreSlot(
        startAtCenter,
        endAtCenter,
        gap,
        input,
        opts,
      );

      candidates.push({
        startAt: startAtCenter,
        endAt: endAtCenter,
        ...centerScore,
      });
    }
  }

  return candidates;
}

/**
 * Suggest optimal timeslots for a task given the current schedule.
 *
 * This is a rule-based/heuristic engine that:
 * 1. Finds available gaps in the schedule
 * 2. Scores each gap based on priority, time-of-day, fragmentation, and urgency
 * 3. Returns the top N suggestions sorted by score
 */
export function suggestTimeslots(
  input: TimeslotSuggestionInput,
  options?: TimeslotOptions,
): TimeslotSuggestionResult {
  const opts: Required<TimeslotOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const referenceDate = getReferenceDate(input);
  const { workdayStart, workdayEnd } = getWorkdayBounds(referenceDate, opts);

  // Find gaps in the schedule
  const gaps = findGaps(
    input.currentSchedule,
    workdayStart,
    workdayEnd,
    opts.bufferMinutes,
  );

  // No gaps at all? Return warning
  if (gaps.length === 0) {
    return {
      suggestions: [
        {
          startAt: workdayStart,
          endAt: new Date(
            workdayStart.getTime() + input.estimatedMinutes * 60_000,
          ),
          score: 0,
          reasons: [],
          conflicts: [
            "No available gap found within workday hours; schedule is fully booked",
          ],
        },
      ],
      bestMatch: null,
    };
  }

  // Generate candidates
  const candidates = generateCandidates(gaps, input, opts);

  // No candidates fit? (all gaps too small)
  if (candidates.length === 0) {
    return {
      suggestions: [
        {
          startAt: workdayStart,
          endAt: new Date(
            workdayStart.getTime() + input.estimatedMinutes * 60_000,
          ),
          score: 0,
          reasons: [],
          conflicts: [
            `No gap of ${input.estimatedMinutes} minutes (+ ${opts.bufferMinutes}min buffer) found within workday hours`,
          ],
        },
      ],
      bestMatch: null,
    };
  }

  // Sort by score descending, then by start time ascending for ties
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );
  });

  // Deduplicate: remove candidates whose start times are within 5 minutes of
  // an already-selected candidate
  const deduped: TimeslotSuggestion[] = [];
  for (const c of candidates) {
    const isDuplicate = deduped.some(
      (d) =>
        Math.abs(
          new Date(d.startAt).getTime() - new Date(c.startAt).getTime(),
        ) <
        5 * 60_000,
    );
    if (!isDuplicate) {
      deduped.push(c);
    }
    if (deduped.length >= opts.maxSuggestions) break;
  }

  const suggestions = deduped.slice(0, opts.maxSuggestions);
  const bestMatch = suggestions.length > 0 ? suggestions[0] : null;

  return {
    suggestions,
    bestMatch,
  };
}
