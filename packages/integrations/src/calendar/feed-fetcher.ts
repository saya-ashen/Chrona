import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { CalendarValidationErrorCode } from "@chrona/contracts";

export type CalendarFeedTransport = (url: string) => Promise<{ status: number; text: string }>;

export type CalendarFeedOptions = {
  allowBlockedNetwork?: boolean;
};

export class CalendarFeedError extends Error {
  constructor(public readonly code: CalendarValidationErrorCode, message: string) {
    super(message);
    this.name = "CalendarFeedError";
  }
}

export const MAX_CALENDAR_FEED_BYTES = 1_000_000;
const MAX_CALENDAR_REDIRECTS = 5;
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6120000, 0xc613ffff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xe0000000, 0xffffffff],
];

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  const value = parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
  return BLOCKED_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("64:ff9b:1:")
  );
}

function assertAllowedAddress(address: string, options: CalendarFeedOptions = {}) {
  const version = isIP(address);
  if (version === 4 && isBlockedIpv4(address) && !options.allowBlockedNetwork) {
    throw new CalendarFeedError("blocked_network", "Calendar host resolves to a blocked network.");
  }
  if (version === 6 && isBlockedIpv6(address) && !options.allowBlockedNetwork) {
    throw new CalendarFeedError("blocked_network", "Calendar host resolves to a blocked network.");
  }
  if (version === 0) {
    throw new CalendarFeedError("invalid_url", "Calendar host is invalid.");
  }
}

async function resolveAllowedAddress(hostname: string, options: CalendarFeedOptions = {}) {
  if (isIP(hostname)) {
    assertAllowedAddress(hostname, options);
    return hostname;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new CalendarFeedError("unreachable", "Calendar could not be reached.");
  }

  for (const { address } of addresses) assertAllowedAddress(address, options);
  return addresses[0]?.address ?? hostname;
}

function requestCalendarFeed(url: URL, address: string): Promise<{ status: number; text: string; location?: string }> {
  const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;

  return new Promise((resolve, reject) => {
    const req = request({
      protocol: url.protocol,
      hostname: address,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.hostname,
      headers: {
        Accept: "text/calendar,*/*;q=0.8",
        Host: hostHeader,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_CALENDAR_FEED_BYTES) {
          req.destroy(new CalendarFeedError("too_large", "Calendar feed is too large."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          text: Buffer.concat(chunks).toString("utf8"),
          location: res.headers.location,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function defaultCalendarFeedTransport(url: string, options: CalendarFeedOptions = {}) {
  let current = new URL(url);

  for (let redirectCount = 0; redirectCount <= MAX_CALENDAR_REDIRECTS; redirectCount += 1) {
    if (current.protocol !== "https:") {
      throw new CalendarFeedError("unsupported_scheme", "Calendar links must use https.");
    }

    const address = await resolveAllowedAddress(current.hostname, options);
    const response = await requestCalendarFeed(current, address);
    if (response.status < 300 || response.status >= 400) return { status: response.status, text: response.text };

    if (!response.location) {
      throw new CalendarFeedError("unreachable", "Calendar redirect is missing a target.");
    }

    current = new URL(response.location, current);
  }

  throw new CalendarFeedError("unreachable", "Calendar redirects too many times.");
}

export async function fetchCalendarFeed(
  url: string,
  transport: CalendarFeedTransport = defaultCalendarFeedTransport,
  options: CalendarFeedOptions = {},
) {
  let response: { status: number; text: string };
  try {
    response = transport === defaultCalendarFeedTransport
      ? await defaultCalendarFeedTransport(url, options)
      : await transport(url);
  } catch (cause) {
    if (cause instanceof CalendarFeedError) throw cause;
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
