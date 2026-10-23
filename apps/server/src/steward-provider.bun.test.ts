import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStewardRoutes } from "./routes/steward.routes";
import { resetEnvCacheForTests } from "./config/env";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import type { ProviderAnswer, ProviderRunView } from "@chrona/contracts";
let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>, app: Hono;
let workspaceId: string, sessionId: string, previous: string | undefined;
const owner = { authorization: "Bearer provider-owner-fixture", "content-type": "application/json" };
let answers: ProviderAnswer[], capability: string;
beforeEach(async () => {
  previous = process.env.API_KEY; process.env.API_KEY = "provider-owner-fixture"; resetEnvCacheForTests();
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "owner" } })).id; answers = []; capability = "";
  ports = { db, now: () => new Date(), dataDir: await mkdtemp(join(tmpdir(), "chrona-provider-api-")), deliveries: [], chat: null, publicUrl: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
      const controller = new AbortController(); capability = input.token;
      const done = (async () => {
        await input.events!.progress({ phase: "reading", tool: "read" });
        answers.push(await input.events!.question({ method: "confirm", title: "Fixture permission", message: "Only this attempt", options: [], timeoutMs: 1000 }, controller.signal));
        return { outcome: "finished" as const, sessionId: null, error: null };
      })();
      return { done, inject: async () => {}, abort: async () => { controller.abort(); await done; } };
    } } };
  service = createStewardService(ports); sessionId = (await db.session.create({ data: { workspaceId, key: "web:fixture", source: "web", title: "Fixture" } })).id;
  app = new Hono().route("/api/steward", createStewardRoutes(ports, service));
});
afterEach(async () => {
  for (const run of await db.run.findMany({ where: { status: { in: ["running", "queued"] } } })) await service.forWorkspace(workspaceId).provider.cancel(run.id);
  await db.$disconnect();
  if (previous === undefined) delete process.env.API_KEY; else process.env.API_KEY = previous; resetEnvCacheForTests();
});
const path = (suffix: string, workspace = workspaceId) => `/api/steward${suffix}?workspaceId=${workspace}`;
async function start() {
  await service.forWorkspace(workspaceId).runs.enqueue({ sessionId, lane: "background", trigger: "schedule", prompt: "Fixture only" }); await service.tick();
  for (let i = 0; i < 100; i++) {
    const response = await app.request(path("/provider/runs"), { headers: owner });
    const view = await response.json() as { items: ProviderRunView[] }, run = view.items[0];
    if (run?.interactions.length) return run; await Bun.sleep(5);
  }
  throw new Error("No API request");
}
async function finished(id: string) { for (let i = 0; i < 100; i++) { if ((await db.run.findUniqueOrThrow({ where: { id } })).status !== "running") return; await Bun.sleep(5); } throw new Error("Fixture run did not stop"); }
test("owner-only scoped request roundtrip: no automatic approval, wrong workspace or reusable grant", async () => {
  expect((await app.request(path("/provider/runs"))).status).toBe(401);
  const run = await start(), id = run.interactions[0]!.id;
  expect(answers).toEqual([]); expect(run.progress).toEqual({ phase: "reading", tool: "read" });
  expect((await app.request(path("/provider/runs"), { headers: { authorization: `Bearer ${capability}` } })).status).toBe(401);
  expect((await app.request(path(`/provider/interactions/${id}/answer`), { method: "POST", headers: owner, body: JSON.stringify({ decision: "submit", value: true, scope: "always" }) })).status).toBe(400);
  expect((await app.request(path(`/provider/interactions/${id}/answer`), { method: "POST", headers: owner, body: JSON.stringify({ decision: "submit", value: "yes" }) })).status).toBe(400);
  const other = (await db.workspace.create({ data: { name: "other" } })).id;
  expect((await app.request(path(`/provider/interactions/${id}/answer`, other), { method: "POST", headers: owner, body: JSON.stringify({ decision: "submit", value: true }) })).status).toBe(404);
  const response = await app.request(path(`/provider/interactions/${id}/answer`), { method: "POST", headers: owner, body: JSON.stringify({ decision: "submit", value: false }) });
  expect(response.status).toBe(200); await finished(run.id); expect(answers).toEqual([{ decision: "submit", value: false }]);
  expect(await db.grant.count()).toBe(0); expect(await db.approval.count()).toBe(0);
  expect((await app.request(path(`/provider/interactions/${id}/answer`), { method: "POST", headers: owner, body: JSON.stringify({ decision: "submit", value: true }) })).status).toBe(409);
});
test("owner cancellation stops current work and closes its requests", async () => {
  const run = await start();
  const response = await app.request(path(`/provider/runs/${run.id}/cancel`), { method: "POST", headers: owner });
  expect(response.status).toBe(200); await finished(run.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0); expect(answers).toEqual([{ decision: "cancel" }]);
});
