import { isIP } from "node:net";

/** Exact local endpoint classifier. Do not resolve arbitrary names for credentials. */
export function normalizeNetworkHost(host: string): string {
  return host.trim().replace(/^\[/, "").replace(/\]$/, "").split("%")[0]?.toLowerCase() ?? "";
}

export function isExactLoopbackHost(host: string): boolean {
  const normalized = normalizeNetworkHost(host);
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

export type HermesEndpointValidation = { ok: true; url: URL; local: boolean } | { ok: false; reason: string };

/**
 * Hermes permits cleartext only to explicit loopback hosts. This validation runs
 * before any request headers are constructed, so invalid endpoints receive no bearer token.
 */
export function validateHermesEndpoint(value: string | undefined): HermesEndpointValidation {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    try { return { ok: true, url: new URL("http://127.0.0.1:8642"), local: true }; }
    catch { return { ok: false, reason: "Invalid Hermes endpoint." }; }
  }
  const hasScheme = /^https?:\/\//i.test(trimmed);
  let url: URL;
  try { url = new URL(hasScheme ? trimmed : `http://${trimmed}`); } catch { return { ok: false, reason: "Hermes endpoint is malformed." }; }
  if (!hasScheme && !isExactLoopbackHost(url.hostname)) return { ok: false, reason: "Remote Hermes endpoint must include https://." };
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return { ok: false, reason: "Hermes endpoint must use HTTP or HTTPS with a host." };
  if (url.username || url.password) return { ok: false, reason: "Hermes endpoint must not include URL credentials." };
  if (url.search || url.hash) return { ok: false, reason: "Hermes endpoint must not include URL query or fragment values." };
  const local = isExactLoopbackHost(url.hostname);
  if (!local && url.protocol !== "https:") return { ok: false, reason: "Remote Hermes endpoints must use HTTPS." };
  return { ok: true, url, local };
}
