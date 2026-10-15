import { describe, expect, it } from "vitest";
import { currentFolder, initialSchedule, newPagePath, scheduleInput } from "./affair-actions";

describe("affair action inputs", () => {
  it("creates Markdown in the current folder", () => {
    expect(currentFolder("README.md")).toBe("");
    expect(currentFolder("days/day-1.md")).toBe("days");
    expect(newPagePath("days", "notes.md")).toBe("days/notes.md");
    expect(() => newPagePath("", "script.sh")).toThrow();
  });
  it.each([
    { kind: "daily" as const, time: "08:00" },
    { kind: "weekly" as const, time: "08:00", days: [1] },
    { kind: "every" as const, minutes: 60 },
    { kind: "at" as const, at: "2027-01-01T08:00:00.000Z" },
  ])("builds $kind rule", rule => {
    expect(scheduleInput({ ...initialSchedule, kind: rule.kind, at: "2027-01-01T08:00:00Z" }).rule).toEqual(rule);
  });
  it("rejects empty weekdays, invalid dates, short intervals, and jobs without a command", () => {
    for (const patch of [{ kind: "weekly" as const, days: [] }, { kind: "at" as const, at: "" }, { kind: "every" as const, minutes: "1" }, { mode: "job" as const }]) expect(() => scheduleInput({ ...initialSchedule, ...patch })).toThrow();
    expect(scheduleInput({ ...initialSchedule, mode: "job", command: "sh check.sh" }).command).toBe("sh check.sh");
  });
});
