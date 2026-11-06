import { randomBytes } from "node:crypto";

/** Per-run, loopback-only extension catalog. PiEvents owns all RPC event/question boundaries. */
export function createExecutorBridge() {
  const token = randomBytes(32).toString("hex");
  let active = true;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request, host) {
    const peer = host.requestIP(request)?.address;
    if (!active || peer !== "127.0.0.1" || request.headers.has("forwarded") || [...request.headers.keys()].some(key => key.startsWith("x-forwarded-")) || request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: { code: "forbidden", message: "Local run capability required" } }, { status: 403 });
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/steward-agent/catalog") return Response.json({ tools: [] }, { headers: { "cache-control": "no-store" } });
    return Response.json({ error: { code: "forbidden", message: "Executor module calls are forbidden" } }, { status: 403 });
  } });
  return {
    agentUrl: `http://127.0.0.1:${server.port}/api/steward-agent`,
    /** Only give this to the existing Provider start input; never persist it. */
    token,
    close() { active = false; return server.stop(true); },
  };
}
