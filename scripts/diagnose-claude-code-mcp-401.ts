#!/usr/bin/env bun
/**
 * diagnose-claude-code-mcp-401.ts — one-shot preflight for the dev 401 loop.
 *
 * Reads `CHRONA_API_KEY` and `CHRONA_MCP_BASE_URL` (default
 * http://localhost:3000) from the environment, issues the same
 * `initialize` + `tools/list` handshake the SDK would, and prints the
 * server's response status + tool list. If the agent model keeps
 * stopping without calling `mcp__chrona__chrona_plan_generate`, run
 * this script first:
 *
 *   CHRONA_API_KEY=$(grep '^API_KEY=' apps/server/.env | cut -d= -f2-) \
 *     bun run scripts/diagnose-claude-code-mcp-401.ts
 *
 * Expected:
 *   - HTTP 200 on initialize
 *   - tools/list returns ≥1 tool (chrona_plan_generate, etc.)
 *
 * If the script reports 401, the operator has the wrong CHRONA_API_KEY
 * (or the server's apps/server/.env `API_KEY` has changed). The Claude
 * Code provider's `SdkRunner.start` will now fail-fast with the same
 * diagnostic the next time a run is attempted.
 */
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = (process.env["CHRONA_MCP_BASE_URL"] ?? "http://localhost:3000").replace(/\/+$/, "");
const token = process.env["CHRONA_API_KEY"] ?? process.env["CHRONA_MCP_BEARER_TOKEN"];

if (!token) {
  // Not fatal: a server without API_KEY accepts unauthenticated requests.
  // Probe without an Authorization header; a 401 below means the server DOES
  // require auth and CHRONA_API_KEY must be set to match apps/server/.env.
  console.warn("No CHRONA_API_KEY set — probing without Authorization (local no-auth server).");
  console.warn("If the server requires auth, set CHRONA_API_KEY to match apps/server/.env API_KEY.");
}

const url = `${baseUrl}/api/mcp`;

const initRes = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "chrona-diagnose", version: "0.0.0" },
    },
  }),
  signal: AbortSignal.timeout(5_000),
}).catch((err) => {
  console.error(`initialize fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  return null;
});

if (!initRes) process.exit(1);
console.log(`initialize → HTTP ${initRes.status}`);
if (initRes.status === 401 || initRes.status === 403) {
  const body = await initRes.text().catch(() => "");
  console.error(`Authorization rejected. Server says: ${body.slice(0, 200)}`);
  console.error("Fix: set CHRONA_API_KEY to match apps/server/.env API_KEY.");
  process.exit(1);
}
if (!initRes.ok) {
  console.error(await initRes.text());
  process.exit(1);
}

const sessionId = initRes.headers.get("mcp-session-id");
console.log(`mcp-session-id: ${sessionId ?? "(none)"}`);

const toolsRes = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  signal: AbortSignal.timeout(5_000),
});
const toolsText = await toolsRes.text();
const toolsMatch = toolsText.match(/"name"\s*:\s*"([^"]+)"/g) ?? [];
const toolNames = toolsMatch.map((m) => m.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? "").filter(Boolean);
console.log(`tools/list → HTTP ${toolsRes.status}, ${toolNames.length} tool(s):`);
for (const name of toolNames) console.log(`  - ${name}`);

if (!toolNames.includes("chrona_plan_generate")) {
  console.error("\nchrona_plan_generate is missing from the tool list. The agent will be");
  console.error("unable to call it. Check apps/server/src/routes/mcp/mcp.routes.ts and");
  console.error("packages/engine/src/modules/agent-tools/registry.ts for the registration.");
  process.exit(1);
}

console.log("\nOK: MCP transport is healthy and chrona_plan_generate is registered.");
console.log("Next step: trigger a real plan generation run in the UI and watch");
console.log("  /tmp/chrona-claude-*.log for the SDK session log.");
await sleep(50);
