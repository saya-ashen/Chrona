import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardService, CallError, type StewardPorts } from "@chrona/engine";
import { CHRONA_TOOLS } from "@chrona/contracts/steward";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";
function trusted(app: ReturnType<typeof createStewardAgentRoutes>) {
  return { request: (input: Parameters<typeof app.request>[0], init?: RequestInit) => app.request(input, init, { server: { requestIP: () => ({ address: "127.0.0.1" }) } }) };
}
test("agent catalog authenticates live capabilities and dispatches v3 tools", async () => {
  const db = testDb();
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-agent-")), now: () => new Date(), publicUrl: null };
    const service = createStewardService(ports), app = trusted(createStewardAgentRoutes(ports, service));
    const session = await db.session.create({ data: { workspaceId: "w", key: "web:test", source: "web" } });
    await service.forWorkspace("w").runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Hi" });
    const run = (await service.forWorkspace("w").runs.claimNext("foreground"))!;
    const headers = { authorization: `Bearer ${run.token}`, "content-type": "application/json" };
    expect((await app.request("http://localhost/catalog")).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { ...headers, forwarded: "for=127.0.0.1" } })).status).toBe(403);
    const catalog = await app.request("http://localhost/catalog", { headers });
    expect(catalog.status).toBe(200); expect((await catalog.json()).tools.map((t: { name: string }) => t.name)).toEqual([...CHRONA_TOOLS, ...["catalog", "list", "diagnostics", "health", "reference", "check", "checkout", "propose", "rollback", "disable", "enable", "remove", "build", "stop_build", "revise_build"].map(name => `m_modules_${name}`)]);
    const diagnostics = await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: "{}" });
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({ ok: true, data: { result: [] } });
    const call = await app.request("http://localhost/tools/chrona_remember", { method: "POST", headers, body: JSON.stringify({ text: "Prefer concise replies" }) });
    expect(call.status).toBe(200); expect((await call.json()).ok).toBe(true);
    expect(await db.preference.count()).toBe(1);
    const invalid = await app.request("http://localhost/tools/chrona_remember", { method: "POST", headers, body: "{}" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: "invalid", message: expect.stringContaining("text:") } });
    const dispatch = spyOn(service.tools, "call");
    for (const code of ["unknown", "failed", "unavailable"] as const) {
      dispatch.mockRejectedValueOnce(new CallError(code, `Delivery ${code}`));
      const response = await app.request("http://localhost/tools/chrona_schedules", { method: "POST", headers, body: "{}" });
      expect(response.status).toBe(code === "unavailable" ? 503 : 409);
      expect(await response.json()).toEqual({ ok: false, error: { code, message: `Delivery ${code}` } });
    }
    dispatch.mockRestore();
    const root = await app.request("http://localhost/tools/chrona_schedules", { method: "POST", headers, body: "{}" });
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ ok: true });
    await db.session.update({ where: { id: session.id }, data: { source: "build" } });
    const buildCatalog = await (await app.request("http://localhost/catalog", { headers })).json();
    // A build has the conversation's app tools; of Chrona's own tools only chrona_reply.
    const buildNames: string[] = buildCatalog.tools.map((t: { name: string }) => t.name);
    expect(buildNames).toEqual(expect.arrayContaining(["chrona_reply", "m_modules_diagnostics", "m_modules_reference", "m_modules_propose", "m_modules_request_group", "m_modules_list"]));
    expect(buildNames.filter(name => name.startsWith("chrona_"))).toEqual(["chrona_reply"]);
    expect((await app.request("http://localhost/tools/chrona_schedules", { method: "POST", headers, body: "{}" })).status).toBe(403);
    const reference = await app.request("http://localhost/tools/m_modules_reference", { method: "POST", headers, body: JSON.stringify({ target: "modules.diagnostics" }) });
    expect(reference.status).toBe(200);
    expect(await reference.json()).toMatchObject({ ok: true, data: { result: { outputSchema: { type: "array" } } } });
    expect((await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: "{}" })).status).toBe(403);
    await db.run.update({ where: { id: run.id }, data: { status: "finished" } });
    expect((await app.request("http://localhost/catalog", { headers })).status).toBe(401);
  } finally { await db.$disconnect(); }
});

test("routed build refusals retain conflict/409 and actionable detail instead of INTERNAL_ERROR", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-build-queue-http-"));
  try {
    const { id: workspaceId } = await db.workspace.create({ data: { name: "queue-http" } });
    const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null };
    const service = createStewardService(ports), api = service.forWorkspace(workspaceId), app = trusted(createStewardAgentRoutes(ports, service));
    const session = await db.session.create({ data: { workspaceId, key: "web:http-queue", source: "web" } });
    await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "fixture" });
    const run = (await api.runs.claimNext("foreground"))!;
    const post = (name: string, body: unknown) => app.request(`http://localhost/tools/${name}`, { method: "POST", headers: { authorization: `Bearer ${run.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const request = { name: "sample", goal: "fixture only", intent: { changes: ["fixture"], preserves: [] } };
    const unconfigured = await post("m_modules_build", request);
    expect(unconfigured.status).toBe(409);
    expect(await unconfigured.json()).toMatchObject({ ok: false, error: { code: "conflict", message: expect.stringContaining("SDK resources") } });
    ports.moduleSdk = "unused: admission must reject before preparation";
    for (let i = 0; i < 10; i++) {
      const build = await db.session.create({ data: { workspaceId, key: `build:fixture-${i}`, source: "build" } });
      await api.runs.enqueue({ sessionId: build.id, lane: "build", trigger: "build", prompt: "fixture" });
    }
    const full = await post("m_modules_build", request);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: { code: "conflict", message: expect.stringContaining("queue is full (10 waiting)") } });
    expect(await db.session.count()).toBe(11);
    expect((await post("m_modules_build", { ...request, name: "../escape" })).status).toBe(400);
    expect((await post("m_modules_check", { module: "missing" })).status).toBe(404);
  } finally { await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});
