import { isIP } from "node:net";

function isPublicIpv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number) as [number, number];
  if ([0, 10, 127].includes(a) || a >= 224) return false;
  const privateRanges: Partial<Record<number, readonly [number, number]>> = {
    169: [254, 254], 172: [16, 31], 192: [168, 168], 100: [64, 127],
  };
  const range = privateRanges[a];
  return !range || b < range[0] || b > range[1];
}

function isPublicHost(host: string): boolean {
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (isIP(host) === 4) return isPublicIpv4(host);
  // Only global-unicast IPv6; excludes loopback, ULA, link-local, mapped IPv4.
  if (isIP(host) === 6) return /^[23][0-9a-f]{3}:/.test(host);
  return host.includes(".");
}

/** Lexical public-URL gate. Fetchers must also validate DNS answers and every redirect. */
export function isPublicWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    return isPublicHost(host);
  } catch { return false; }
}

/** fetch_content supports a single url or a nonempty urls batch. Never pass unchecked targets. */
export function publicWebInput(tool: "web_search" | "fetch_content", input: Record<string, unknown>): boolean {
  if (tool === "web_search") return true;
  const targets = [
    ...(Object.hasOwn(input, "url") ? [input.url] : []),
    ...(Object.hasOwn(input, "urls") ? Array.isArray(input.urls) ? input.urls : [null] : []),
  ];
  return targets.length > 0 && targets.every(isPublicWebUrl);
}
