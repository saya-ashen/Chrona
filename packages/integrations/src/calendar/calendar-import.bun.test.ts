import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeImportedEvents } from "@chrona/domain";
import { fetchCalendarFeed } from "./feed-fetcher";
import { parseICalendarFeed } from "./normalizer";
import { CalendarSourceUrlError, normalizeCalendarSourceUrl } from "./source-url";

const fixturesDir = join(import.meta.dir, "fixtures");
const fixture = (name: string) => readFile(join(fixturesDir, name), "utf8");

describe("calendar import helpers", () => {
  it("normalizes and redacts URLs", () => {
    const normalized = normalizeCalendarSourceUrl("https://calendar.example/private/team.ics?token=secret");
    expect(normalized.url).toContain("token=secret");
    expect(normalized.redactedUrlLabel).toBe("calendar.example/team.ics");
  });

  it("rejects unsupported URL schemes", () => {
    expect(() => normalizeCalendarSourceUrl("webcal://calendar.example/team.ics")).toThrow(CalendarSourceUrlError);
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

  it("rejects malformed and oversized fixtures", async () => {
    expect(() => parseICalendarFeed("not calendar")).toThrow("malformed_calendar");
    await expect(fetchCalendarFeed("fixture://oversized", async () => ({
      status: 200,
      text: await fixture("oversized.ics"),
    }))).rejects.toThrow("Calendar feed is too large.");
  });
});
