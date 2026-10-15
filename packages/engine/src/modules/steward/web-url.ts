import { isIP } from "node:net";

/** Lexical public-URL gate. Fetchers must also validate DNS answers and every redirect. */
export function isPublicWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (isIP(host) === 4) {
      const [a, b] = host.split(".").map(Number) as [number, number];
      return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224);
    }
    // Only global-unicast IPv6; excludes loopback, ULA, link-local, mapped IPv4.
    if (isIP(host) === 6) return /^[23][0-9a-f]{3}:/.test(host);
    return host.includes(".");
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
