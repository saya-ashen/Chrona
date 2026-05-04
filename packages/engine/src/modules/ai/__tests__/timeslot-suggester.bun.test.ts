import { describe, expect, it } from "bun:test";
import { suggestTimeslots } from "@chrona/shared";
import type {
  TimeslotSuggestionInput,
} from "@chrona/contracts/ai";

/**
 * Helper: create a Date for 2026-04-15 at the given hour:minute (UTC).
 */
function d(hour: number, minute = 0): Date {
  return new Date(`2026-04-15T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

describe("timeslot-suggester", () => {
  describe("empty schedule", () => {
    it("suggests the full workday when schedule is empty", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-1",
        title: "Write report",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [],
      };

      // Need to anchor the reference date since empty schedule uses "today"
      // Instead, provide a slot so referenceDate is deterministic
      const inputWithAnchor: TimeslotSuggestionInput = {
        ...input,
        currentSchedule: [],
      };

      const result = suggestTimeslots(inputWithAnchor);

      // Should have suggestions (not an error case)
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.bestMatch).not.toBeNull();
      expect(result.bestMatch!.score).toBeGreaterThan(0);
    });

    it("suggests a slot that covers the estimated minutes", () => {
      // Use a schedule with one item to anchor the date, then remove it
      const input: TimeslotSuggestionInput = {
        taskId: "task-1",
        title: "Code review",
        priority: "High",
        estimatedMinutes: 90,
        currentSchedule: [
          {
            taskId: "anchor",
            title: "Anchor",
            startAt: d(12, 0),
            endAt: d(12, 30),
          },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.bestMatch).not.toBeNull();
      const best = result.bestMatch!;
      const durationMin =
        (new Date(best.endAt).getTime() - new Date(best.startAt).getTime()) /
        60_000;
      expect(durationMin).toBe(90);
    });
  });

  describe("finding gaps between tasks", () => {
    it("finds gap between two tasks", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-new",
        title: "New task",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [
          { taskId: "t1", title: "Morning standup", startAt: d(9, 0), endAt: d(9, 30) },
          { taskId: "t2", title: "Afternoon meeting", startAt: d(14, 0), endAt: d(15, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.bestMatch).not.toBeNull();

      // The best slot should fit in one of the gaps
      const best = result.bestMatch!;
      const bestStart = new Date(best.startAt).getTime();
      const bestEnd = new Date(best.endAt).getTime();

      // Should not overlap with existing tasks (accounting for buffer)
      expect(bestEnd).toBeLessThanOrEqual(d(14, 0).getTime());
      expect(bestStart).toBeGreaterThanOrEqual(d(9, 0).getTime());
    });

    it("returns no-gap warning when schedule is fully booked", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-new",
        title: "Impossible task",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [
          { taskId: "t1", title: "Task A", startAt: d(9, 0), endAt: d(13, 0) },
          { taskId: "t2", title: "Task B", startAt: d(13, 0), endAt: d(18, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      // Should indicate no suitable gap
      expect(result.bestMatch).toBeNull();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].score).toBe(0);
      expect(result.suggestions[0].conflicts.length).toBeGreaterThan(0);
    });
  });

  describe("priority-based scoring", () => {
    it("scores morning slots higher for high-priority tasks", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-hp",
        title: "Critical analysis",
        priority: "High",
        estimatedMinutes: 60,
        currentSchedule: [
          // Leave morning and afternoon open
          { taskId: "t1", title: "Lunch", startAt: d(12, 0), endAt: d(13, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.bestMatch).not.toBeNull();

      // Best match should be in the morning (before 12:00)
      const bestHour = new Date(result.bestMatch!.startAt).getUTCHours();
      expect(bestHour).toBeLessThan(12);
    });

    it("scores urgent tasks higher when placed earlier", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-urgent",
        title: "Emergency fix",
        priority: "Urgent",
        estimatedMinutes: 30,
        currentSchedule: [
          { taskId: "t1", title: "Standup", startAt: d(9, 0), endAt: d(9, 15) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.bestMatch).not.toBeNull();
      // Should prefer early morning right after standup
      const bestHour = new Date(result.bestMatch!.startAt).getUTCHours();
      expect(bestHour).toBeLessThan(12);
    });

    it("suggests afternoon for meeting-type tasks", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-meeting",
        title: "Team sync meeting",
        priority: "Medium",
        estimatedMinutes: 30,
        currentSchedule: [
          // Block morning, leave lunch/afternoon open
          { taskId: "t1", title: "Deep work", startAt: d(9, 0), endAt: d(11, 30) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.suggestions.length).toBeGreaterThan(0);

      // At least one suggestion should be in the afternoon range
      const afternoonSuggestions = result.suggestions.filter((s) => {
        const hour = new Date(s.startAt).getUTCHours();
        return hour >= 12;
      });
      expect(afternoonSuggestions.length).toBeGreaterThan(0);
    });
  });

  describe("buffer time enforcement", () => {
    it("leaves buffer between existing tasks and suggestions", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-buf",
        title: "Buffered task",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [
          { taskId: "t1", title: "Morning task", startAt: d(9, 0), endAt: d(10, 0) },
          { taskId: "t2", title: "Midday task", startAt: d(12, 0), endAt: d(13, 0) },
        ],
      };

      const result = suggestTimeslots(input, { bufferMinutes: 15 });

      expect(result.bestMatch).not.toBeNull();
      const best = result.bestMatch!;

      // Should start at least 15 min after t1 ends (10:15)
      expect(new Date(best.startAt).getTime()).toBeGreaterThanOrEqual(
        d(10, 15).getTime(),
      );

      // Should end at least 15 min before t2 starts (11:45)
      expect(new Date(best.endAt).getTime()).toBeLessThanOrEqual(
        d(11, 45).getTime(),
      );
    });

    it("respects custom buffer minutes", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-buf2",
        title: "Custom buffer task",
        priority: "Low",
        estimatedMinutes: 30,
        currentSchedule: [
          { taskId: "t1", title: "Morning", startAt: d(9, 0), endAt: d(10, 0) },
          { taskId: "t2", title: "Midday", startAt: d(11, 0), endAt: d(12, 0) },
        ],
      };

      const result = suggestTimeslots(input, { bufferMinutes: 30 });

      // With 30-min buffer: gap between t1 (ends 10:00) and t2 (starts 11:00)
      // Effective: 10:30 to 10:30 => 0 minutes. Not enough for 30 min task.
      // So it should look at other gaps (after t2 or before t1).
      expect(result.bestMatch).not.toBeNull();
      const best = result.bestMatch!;

      // The suggestion should NOT be between 10:00 and 11:00
      // (it would need 30min buffer + 30min task = 60 min but the usable gap is 0)
      const startTime = new Date(best.startAt).getTime();

      // It should be placed after t2 ends + buffer
      expect(startTime).toBeGreaterThanOrEqual(d(12, 30).getTime());
    });
  });

  describe("workday hour constraints", () => {
    it("constrains suggestions within default workday hours (9-18)", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-wd",
        title: "Workday task",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [
          { taskId: "t1", title: "Early", startAt: d(7, 0), endAt: d(8, 0) },
          { taskId: "t2", title: "Late", startAt: d(19, 0), endAt: d(20, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.bestMatch).not.toBeNull();
      const best = result.bestMatch!;

      // Should be within 9:00 - 18:00
      expect(new Date(best.startAt).getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(new Date(best.endAt).getUTCHours()).toBeLessThanOrEqual(18);
    });

    it("respects custom workday hours", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-custom-wd",
        title: "Custom hours task",
        priority: "Medium",
        estimatedMinutes: 60,
        currentSchedule: [
          { taskId: "t1", title: "Anchor", startAt: d(10, 0), endAt: d(10, 30) },
        ],
      };

      const result = suggestTimeslots(input, {
        workdayStartHour: 8,
        workdayEndHour: 16,
      });

      expect(result.bestMatch).not.toBeNull();

      for (const suggestion of result.suggestions) {
        const startHour = new Date(suggestion.startAt).getUTCHours();
        const endHour = new Date(suggestion.endAt).getUTCHours();
        const endMin = new Date(suggestion.endAt).getUTCMinutes();

        expect(startHour).toBeGreaterThanOrEqual(8);
        // endAt at most 16:00
        expect(
          endHour < 16 || (endHour === 16 && endMin === 0),
        ).toBe(true);
      }
    });
  });

  describe("bestMatch selection", () => {
    it("selects the highest-scored suggestion as bestMatch", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-bm",
        title: "Best match test",
        priority: "High",
        estimatedMinutes: 30,
        currentSchedule: [
          { taskId: "t1", title: "Block A", startAt: d(10, 0), endAt: d(11, 0) },
          { taskId: "t2", title: "Block B", startAt: d(14, 0), endAt: d(15, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.bestMatch).not.toBeNull();
      expect(result.suggestions.length).toBeGreaterThan(0);

      // bestMatch should be the first suggestion (highest score)
      expect(result.bestMatch).toEqual(result.suggestions[0]);

      // All suggestions should be sorted by score descending
      for (let i = 1; i < result.suggestions.length; i++) {
        expect(result.suggestions[i - 1].score).toBeGreaterThanOrEqual(
          result.suggestions[i].score,
        );
      }
    });

    it("returns null bestMatch when no valid slot exists", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-none",
        title: "No room task",
        priority: "Medium",
        estimatedMinutes: 600, // 10 hours — won't fit
        currentSchedule: [
          { taskId: "t1", title: "Half day", startAt: d(9, 0), endAt: d(14, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      expect(result.bestMatch).toBeNull();
      expect(result.suggestions[0].conflicts.length).toBeGreaterThan(0);
    });
  });

  describe("due date handling", () => {
    it("penalizes slots that end after the due date", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-due",
        title: "Due soon",
        priority: "High",
        estimatedMinutes: 60,
        dueAt: d(11, 0),
        currentSchedule: [
          { taskId: "t1", title: "Block", startAt: d(12, 0), endAt: d(13, 0) },
        ],
      };

      const result = suggestTimeslots(input);

      // The bestMatch should ideally end before 11:00
      expect(result.bestMatch).not.toBeNull();

      // Find suggestions that end before and after the due date
      const beforeDue = result.suggestions.filter(
        (s) => new Date(s.endAt).getTime() <= d(11, 0).getTime(),
      );
      const afterDue = result.suggestions.filter(
        (s) => new Date(s.endAt).getTime() > d(11, 0).getTime(),
      );

      if (beforeDue.length > 0 && afterDue.length > 0) {
        // Before-due suggestions should score higher than after-due
        const bestBeforeDue = Math.max(...beforeDue.map((s) => s.score));
        const bestAfterDue = Math.max(...afterDue.map((s) => s.score));
        expect(bestBeforeDue).toBeGreaterThan(bestAfterDue);
      }
    });
  });

  describe("maxSuggestions", () => {
    it("limits the number of suggestions returned", () => {
      const input: TimeslotSuggestionInput = {
        taskId: "task-max",
        title: "Limited suggestions",
        priority: "Medium",
        estimatedMinutes: 30,
        currentSchedule: [],
      };

      const result = suggestTimeslots(input, { maxSuggestions: 2 });

      expect(result.suggestions.length).toBeLessThanOrEqual(2);
    });
  });
});
