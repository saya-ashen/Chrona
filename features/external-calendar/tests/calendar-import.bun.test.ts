import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeImportedEvents } from "@chrona/domain";
import { CalendarFeedError, fetchCalendarFeed } from "@chrona/integrations/calendar/feed-fetcher";
import { parseICalendarFeed } from "@chrona/integrations/calendar/normalizer";
import { CalendarSourceUrlError, normalizeCalendarSourceUrl } from "@chrona/integrations/calendar/source-url";

const fixturesDir = join(import.meta.dir, "../../../packages/integrations/src/calendar/fixtures");
const fixture = (name: string) => readFile(join(fixturesDir, name), "utf8");

describe("calendar import helpers", () => {
  it("normalizes and redacts URLs", () => {
    const normalized = normalizeCalendarSourceUrl("https://calendar.example/private/team.ics?token=secret");
    expect(normalized.url).toContain("token=secret");
    expect(normalized.redactedUrlLabel).toBe("calendar.example/team.ics");
  });

  it("rejects unsupported URL schemes", () => {
    expect(() => normalizeCalendarSourceUrl("webcal://calendar.example/team.ics")).toThrow(CalendarSourceUrlError);
    expect(() => normalizeCalendarSourceUrl("http://calendar.example/team.ics")).toThrow(CalendarSourceUrlError);
    expect(() => normalizeCalendarSourceUrl("file:///etc/passwd")).toThrow(CalendarSourceUrlError);
  });

  it("blocks unsafe default feed targets before network access", async () => {
    await expect(fetchCalendarFeed("file:///etc/passwd")).rejects.toThrow(CalendarFeedError);
    await expect(fetchCalendarFeed("http://calendar.example/team.ics")).rejects.toThrow(CalendarFeedError);
    await expect(fetchCalendarFeed("https://127.0.0.1/team.ics")).rejects.toThrow(CalendarFeedError);
    await expect(fetchCalendarFeed("https://169.254.169.254/latest/meta-data")).rejects.toThrow(CalendarFeedError);
    await expect(fetchCalendarFeed("https://[::1]/team.ics")).rejects.toThrow(CalendarFeedError);
  });

  it("allows explicitly confirmed blocked-network calendar targets", async () => {
    await expect(fetchCalendarFeed("https://127.0.0.1/team.ics", async () => ({
      status: 200,
      text: await fixture("valid.ics"),
    }), { allowBlockedNetwork: true })).resolves.toContain("BEGIN:VCALENDAR");
  });

  it("parses valid, all-day, cancelled, timezone, and duplicate fixtures", async () => {
    const validEvents = parseICalendarFeed(await fixture("valid.ics")).events;
    expect(validEvents).toHaveLength(1);
    expect(validEvents[0]?.description).toBe("Discuss sync blockers and handoff notes.");
    expect(normalizeImportedEvents(validEvents)[0]?.description).toBe("Discuss sync blockers and handoff notes.");
    expect(parseICalendarFeed(await fixture("all-day.ics")).events[0]?.isAllDay).toBe(true);
    expect(parseICalendarFeed(await fixture("cancelled.ics")).events[0]?.status).toBe("cancelled");
    expect(parseICalendarFeed(await fixture("timezone.ics")).events[0]?.startsAt.toISOString()).toContain("T13:00:00.000Z");

    const duplicate = normalizeImportedEvents(parseICalendarFeed(await fixture("duplicate.ics")).events);
    expect(duplicate).toHaveLength(1);
  });

  it("expands recurring events within a bounded import range", async () => {
    const recurring = parseICalendarFeed(await fixture("recurring.ics"), {
      from: new Date("2026-05-01T00:00:00.000Z"),
      to: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(recurring.events.map((event) => event.startsAt.toISOString())).toEqual([
      "2026-05-05T14:00:00.000Z",
      "2026-05-12T14:00:00.000Z",
      "2026-05-19T14:00:00.000Z",
    ]);
    expect(new Set(recurring.events.map((event) => event.dedupeKey)).size).toBe(3);
    expect(recurring.events.every((event) => event.recurrenceId)).toBe(true);
  });

  it("limits recurring event expansion to the requested range", async () => {
    const recurring = parseICalendarFeed(await fixture("recurring.ics"), {
      from: new Date("2026-05-10T00:00:00.000Z"),
      to: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(recurring.events).toHaveLength(1);
    expect(recurring.events[0]?.startsAt.toISOString()).toBe("2026-05-12T14:00:00.000Z");
  });

  it("rejects malformed and oversized fixtures", async () => {
    expect(() => parseICalendarFeed("not calendar")).toThrow("malformed_calendar");
    await expect(fetchCalendarFeed("fixture://oversized", async () => ({
      status: 200,
      text: await fixture("oversized.ics"),
    }))).rejects.toThrow("Calendar feed is too large.");
  });
});
