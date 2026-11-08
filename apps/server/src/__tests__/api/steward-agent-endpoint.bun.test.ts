import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardService, CallError, type StewardPorts } from "@chrona/engine";
import { CHRONA_TOOLS, moduleManifestSchema } from "@chrona/contracts/steward";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";
import { queueBuild } from "../../../../../packages/engine/src/modules/steward/module-build-session";
function trusted(app: ReturnType<typeof createStewardAgentRoutes>) {
  return { request: (input: Parameters<typeof app.request>[0], init?: RequestInit) => app.request(input, init, { server: { requestIP: () => ({ address: "127.0.0.1" }) } }) };
}
test("agent catalog authenticates live capabilities and dispatches v3 tools", async () => {
  const db = testDb();
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-agent-")), now: () => new Date(), publicUrl: null };
    const service = createStewardService(ports), app = trusted(createStewardAgentRoutes(ports, service));
    let session = await db.session.create({ data: { workspaceId: "w", key: "web:test", source: "web" } });
    await service.forWorkspace("w").runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Hi" });
    let run = (await service.forWorkspace("w").runs.claimNext("foreground"))!;
    let headers = { authorization: `Bearer ${run.token}`, "content-type": "application/json" };
    expect((await app.request("http://localhost/catalog")).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await app.request("http://localhost/catalog", { headers: { ...headers, forwarded: "for=127.0.0.1" } })).status).toBe(403);
    const catalog = await app.request("http://localhost/catalog", { headers });
    expect(catalog.status).toBe(200); expect((await catalog.json()).tools).toEqual([]);
    expect((await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: "{}" })).status).toBe(403);
    await service.forWorkspace("w").runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "never_started" });
    await db.module.create({ data: { workspaceId: "w", name: "sample", status: "paused" } });
    ports.moduleSdk = join(import.meta.dirname, "../../../../../packages/integrations/src/steward/module-sdk");
    const build = await queueBuild(ports, "w", { key: "endpoint-fixture", actorKey: "owner", originSessionId: session.id,
      request: { name: "sample", goal: "Fixture only", examples: [], files: [], intent: { changes: ["Fixture"], preserves: [] } } });
    session = await db.session.findUniqueOrThrow({ where: { id: build.sessionId } });
    run = (await service.forWorkspace("w").runs.claimNext("build"))!;
    headers = { authorization: `Bearer ${run.token}`, "content-type": "application/json" };
    const diagnostics = await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: "{}" });
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({ ok: true, data: { result: [expect.objectContaining({ module: "sample", configuredStatus: "paused" })] } });
    await db.module.create({ data: { workspaceId: "w", name: "unrelated", status: "paused" } });
    const outside = await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: JSON.stringify({ module: "unrelated" }) });
    expect(outside.status).toBe(403);
    expect(await outside.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const call = await app.request("http://localhost/tools/chrona_reply", { method: "POST", headers, body: JSON.stringify({ text: "Build result", files: [] }) });
    expect(call.status).toBe(200); expect((await call.json()).ok).toBe(true);
    expect(await db.message.findFirst({ where: { sessionId: session.id, direction: "out" } })).toMatchObject({ text: "Build result" });
    expect(await db.preference.count()).toBe(0);
    const invalid = await app.request("http://localhost/tools/chrona_reply", { method: "POST", headers, body: "{}" });
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
    expect(root.status).toBe(400);
    const buildCatalog = await (await app.request("http://localhost/catalog", { headers })).json();
    // A build has the conversation's app tools; of Chrona's own tools only chrona_reply.
    const buildNames: string[] = buildCatalog.tools.map((t: { name: string }) => t.name);
    expect(buildNames).toEqual(expect.arrayContaining(["chrona_reply", "m_modules_diagnostics", "m_modules_reference", "m_modules_propose", "m_modules_request_group", "m_modules_list"]));
    expect(buildNames.filter(name => name.startsWith("chrona_"))).toEqual(["chrona_reply"]);
    expect((await app.request("http://localhost/tools/chrona_schedules", { method: "POST", headers, body: "{}" })).status).toBe(400);
    const reference = await app.request("http://localhost/tools/m_modules_reference", { method: "POST", headers, body: JSON.stringify({ target: "modules.diagnostics" }) });
    expect(reference.status).toBe(200);
    expect(await reference.json()).toMatchObject({ ok: true, data: { result: { outputSchema: { type: "array" } } } });
    expect((await app.request("http://localhost/tools/m_modules_diagnostics", { method: "POST", headers, body: "{}" })).status).toBe(200);
    expect(buildNames.filter(name => name.startsWith("chrona_"))).toEqual([...CHRONA_TOOLS]);
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
    const manifest = moduleManifestSchema.parse({ name: "consumer", entry: "index.ts", tests: ["test.ts"], keepAlive: true, triggers: [], effects: [], uses: ["modules.build", "modules.check"] });
    const module = await db.module.create({ data: { workspaceId, name: "consumer", status: "active", activeHash: "v1" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const session = await db.session.create({ data: { workspaceId, key: "module:http-queue", source: "module", moduleId: module.id } });
    await db.audit.create({ data: { id: `agent-context:${session.id}`, workspaceId, actorKey: module.id, kind: "agent_context", subjectId: session.id, details: { hash: "v1" } } });
    await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "fixture" });
    const run = (await api.runs.claimNext("foreground"))!;
    await db.audit.create({ data: { id: `agent-tools:${run.id}`, workspaceId, actorKey: module.id, kind: "agent_tools", subjectId: run.id, details: { targets: ["modules.build", "modules.check"] } } });
    const post = (name: string, body: unknown) => app.request(`http://localhost/tools/${name}`, { method: "POST", headers: { authorization: `Bearer ${run.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const request = { name: "sample", goal: "fixture only", intent: { changes: ["fixture"], preserves: [] } };
    const outside = await post("m_modules_list", {});
    expect(await outside.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
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
    const invalid = await post("m_modules_build", { ...request, name: "../escape" });
    expect(invalid.status).toBe(409); // Routed CallError responses retain their semantic code.
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: "invalid" } });
    const missing = await post("m_modules_check", { module: "missing" });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  } finally { await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});
