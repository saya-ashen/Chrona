import { describe, expect, it } from "bun:test";
import { CalendarSourceUrlError, normalizeCalendarSourceUrl, redactCalendarSourceUrl, safeCalendarErrorMessage } from "./source-url";

describe("calendar source URLs", () => {
  it("normalizes https URLs, strips fragments, and redacts query secrets", () => {
    const normalized = normalizeCalendarSourceUrl(" https://calendar.example.com/private/team.ics?token=secret#frag ");

    expect(normalized).toEqual({
      url: "https://calendar.example.com/private/team.ics?token=secret",
      redactedUrlLabel: "calendar.example.com/team.ics",
    });
  });

  it("rejects non-https calendar URLs", () => {
    expect(() => normalizeCalendarSourceUrl("http://calendar.example.com/team.ics")).toThrow(CalendarSourceUrlError);
    try {
      normalizeCalendarSourceUrl("webcal://calendar.example.com/team.ics");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarSourceUrlError);
      expect((error as CalendarSourceUrlError).code).toBe("unsupported_scheme");
    }
  });

  it("redacts host and last path segment only", () => {
    expect(redactCalendarSourceUrl("https://calendar.example.com/a/b/c.ics?secret=1")).toBe("calendar.example.com/c.ics");
    expect(redactCalendarSourceUrl("https://calendar.example.com/")).toBe("calendar.example.com/calendar");
  });

  it("maps safe user-facing error messages", () => {
    expect(safeCalendarErrorMessage("blocked_network")).toContain("private or proxy network");
    expect(safeCalendarErrorMessage("unknown", "fallback message")).toBe("fallback message");
  });
});
