import { isIP } from "node:net";

/** Supplied by Bun.serve's socket, never headers or the request URL. */
export type ServerBindings = { server?: {
  requestIP?(request: Request): { address: string } | null;
  timeout?(request: Request, seconds: number): void;
} };
export function hasLoopbackPeer(env: ServerBindings | undefined, request: Request) {
  return isLoopbackPeer(env?.server?.requestIP?.(request)?.address);
}
export function isLoopbackPeer(address: string | undefined) {
  if (!address) return false;
  if (isIP(address) === 4) return address.startsWith("127.");
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/.exec(lower)?.[1];
  if (!mapped) return false;
  if (isIP(mapped) === 4) return mapped.startsWith("127.");
  return /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped);
}
