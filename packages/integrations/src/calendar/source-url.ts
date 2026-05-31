import type { CalendarValidationErrorCode } from "@chrona/contracts";

export type NormalizedCalendarUrl = {
  url: string;
  redactedUrlLabel: string;
};

export class CalendarSourceUrlError extends Error {
  constructor(public readonly code: CalendarValidationErrorCode, message: string) {
    super(message);
    this.name = "CalendarSourceUrlError";
  }
}

export function normalizeCalendarSourceUrl(input: string): NormalizedCalendarUrl {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new CalendarSourceUrlError("invalid_url", "Enter a valid calendar subscription URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new CalendarSourceUrlError("unsupported_scheme", "Calendar links must use https.");
  }

  if (!parsed.hostname) {
    throw new CalendarSourceUrlError("invalid_url", "Calendar link is missing a host.");
  }

  parsed.hash = "";
  return {
    url: parsed.toString(),
    redactedUrlLabel: redactCalendarSourceUrl(parsed),
  };
}

export function redactCalendarSourceUrl(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const pathName = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "calendar";
  return `${parsed.hostname}/${pathName}`;
}

export function safeCalendarErrorMessage(
  code: CalendarValidationErrorCode,
  fallback = "Calendar source could not be synced.",
) {
  switch (code) {
    case "invalid_url":
      return "Enter a valid calendar subscription URL.";
    case "unsupported_scheme":
      return "Use a supported read-only calendar subscription link.";
    case "unauthorized":
      return "Calendar requires authorization or a different sharing link.";
    case "unreachable":
      return "Calendar could not be reached. Check sharing settings and try again.";
    case "malformed_calendar":
      return "Calendar feed could not be read.";
    case "too_large":
      return "Calendar feed is too large to import.";
    case "unknown":
      return fallback;
    default:
      return fallback;
  }
}
