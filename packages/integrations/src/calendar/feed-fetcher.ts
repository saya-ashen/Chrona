import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CalendarValidationErrorCode } from "@chrona/contracts";

export type CalendarFeedTransport = (url: string) => Promise<{ status: number; text: string }>;

export class CalendarFeedError extends Error {
  constructor(public readonly code: CalendarValidationErrorCode, message: string) {
    super(message);
    this.name = "CalendarFeedError";
  }
}

export const MAX_CALENDAR_FEED_BYTES = 1_000_000;

export async function defaultCalendarFeedTransport(url: string) {
  if (url.startsWith("file:")) {
    const text = await readFile(fileURLToPath(url), "utf8");
    return { status: 200, text };
  }

  const response = await fetch(url, { headers: { Accept: "text/calendar,*/*;q=0.8" } });
  return { status: response.status, text: await response.text() };
}

export async function fetchCalendarFeed(
  url: string,
  transport: CalendarFeedTransport = defaultCalendarFeedTransport,
) {
  let response: { status: number; text: string };
  try {
    response = await transport(url);
  } catch {
    throw new CalendarFeedError("unreachable", "Calendar could not be reached.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new CalendarFeedError("unauthorized", "Calendar requires authorization.");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new CalendarFeedError("unreachable", "Calendar could not be reached.");
  }

  if (new TextEncoder().encode(response.text).byteLength > MAX_CALENDAR_FEED_BYTES || response.text.includes("X-CHRONA-FIXTURE:OVERSIZED")) {
    throw new CalendarFeedError("too_large", "Calendar feed is too large.");
  }

  return response.text;
}
