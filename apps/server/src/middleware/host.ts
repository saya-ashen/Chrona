import type { MiddlewareHandler } from "hono";
import { isIP } from "node:net";
import { isLoopbackPeer } from "../request-peer";

/** DNS rebinding: on a loopback bind, a page from any site can reach us under its own Host. Accept only names that are ours. */
export function loopbackHostGuard(extraHosts: string[]): MiddlewareHandler {
  const allowed = new Set(["localhost", ...extraHosts.map(h => h.toLowerCase())]);
  return async (c, next) => {
    const hostname = new URL(c.req.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (allowed.has(hostname) || (isIP(hostname) && isLoopbackPeer(hostname))) return next();
    console.error(JSON.stringify({ component: "server", event: "host_rejected", host: hostname.slice(0, 200) }));
    return c.json({ error: "Unknown Host" }, 421);
  };
}
