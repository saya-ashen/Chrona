import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { CHRONA_TOOLS } from "@chrona/contracts/steward";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";
test("agent catalog authenticates live capabilities and dispatches v3 tools", async () => {
  const db = testDb();
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-agent-")), now: () => new Date(), publicUrl: null, deliveries: [], chat: null };
    const service = createStewardService(ports), app = createStewardAgentRoutes(ports, service);
    await service.forWorkspace("w").runs.enqueue({ lane: "foreground", trigger: "message", prompt: "Hi" });
    const run = (await service.forWorkspace("w").runs.claimNext("foreground"))!;
    const headers = { authorization: `Bearer ${run.token}`, "content-type": "application/json" };
    expect((await app.request("http://localhost/catalog")).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { ...headers, forwarded: "for=127.0.0.1" } })).status).toBe(403);
    const catalog = await app.request("http://localhost/catalog", { headers });
    expect(catalog.status).toBe(200); expect((await catalog.json()).tools.map((t: { name: string }) => t.name)).toEqual(CHRONA_TOOLS);
    const call = await app.request("http://localhost/tools/chrona_remember", { method: "POST", headers, body: JSON.stringify({ text: "Prefer concise replies" }) });
    expect(call.status).toBe(200); expect((await call.json()).ok).toBe(true);
    expect(await db.preference.count()).toBe(1);
    expect((await app.request("http://localhost/tools/chrona_remember", { method: "POST", headers, body: "{}" })).status).toBe(400);
    await db.run.update({ where: { id: run.id }, data: { status: "finished" } });
    expect((await app.request("http://localhost/catalog", { headers })).status).toBe(401);
  } finally { await db.$disconnect(); }
});
