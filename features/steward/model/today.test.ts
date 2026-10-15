import { describe, expect, it } from "vitest";
import { emptyToday, todayFixture } from "./fixtures";
import { headline, visibleSections, healthProblems, relativeTime } from "./today";
describe("Today view model", () => {
  it.each([0, 1, 2])("headline for %i waiting", waiting => {
    expect(headline({ ...emptyToday().counts, waiting }, { waiting: "{count} waiting", clear: "Clear" })).toBe(waiting ? `${waiting} waiting` : "Clear");
  });
  it("hides empty sections and preserves reading order", () => {
    expect(visibleSections(emptyToday())).toEqual([]);
    expect(visibleSections(todayFixture())).toEqual(["decisions", "changes", "results", "upcoming", "suggestions"]);
  });
  it("shows quiet health problems only when present", () => {
    const view = emptyToday(); expect(healthProblems(view)).toEqual([]);
    view.health.agent.available = false; view.health.failedNotifications = 1;
    expect(healthProblems(view)).toEqual(["agentUnavailable", "notificationFailed"]);
  });
  it("localizes relative times", () => {
    expect(relativeTime("2026-10-15T08:00:00Z", "2026-10-15T10:00:00Z", "en")).toBe("2 hours ago");
  });
});
