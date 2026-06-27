import { describe, expect, it } from "bun:test";

import {
  calendarSourceSummarySchema,
  importedCalendarEventSummarySchema,
  validateCalendarSourceResponseSchema,
} from "../contract";

describe("external calendar contracts", () => {
  it("accepts redacted source summaries", () => {
    const parsed = calendarSourceSummarySchema.parse({
      id: "src_1",
      name: "Work",
      sourceType: "subscription",
      redactedUrlLabel: "calendar.example/work.ics",
      color: "#2563eb",
      syncPolicy: "keep_active",
      automationPolicy: "auto_plan",
      lifecycleState: "active",
      lastSuccessfulRefreshAt: "2026-05-30T00:00:00.000Z",
    });

    expect(parsed).not.toHaveProperty("sourceUrl");
  });

  it("accepts validation failures", () => {
    expect(validateCalendarSourceResponseSchema.parse({
      valid: false,
      errorCode: "unsupported_scheme",
      message: "Use a supported read-only calendar subscription link.",
    }).valid).toBe(false);
  });

  it("accepts imported event summaries as read-only", () => {
    expect(importedCalendarEventSummarySchema.parse({
      id: "evt_1",
      calendarSourceId: "src_1",
      sourceName: "Work",
      sourceColor: "#2563eb",
      title: "Planning",
      startsAt: "2026-05-30T10:00:00.000Z",
      endsAt: "2026-05-30T11:00:00.000Z",
      isAllDay: false,
      status: "confirmed",
      readOnly: true,
    }).readOnly).toBe(true);
  });
});
