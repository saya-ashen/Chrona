import { expect, spyOn, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardService, CallError, moduleSupervisor, type StewardPorts } from "@chrona/engine";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../../packages/integrations/src/steward/script-sandbox";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";

const moduleTools = ["list", "tools", "reference", "diagnostics", "health", "admit-candidates", "source", "submit", "candidate-check", "rollback", "disable", "enable", "remove"];
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-agent-http-");
  const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, sandbox: { ...sandbox.health, startModule: sandbox.startModule } };
  const workspaceId = (await db.workspace.create({ data: { name: "Agent HTTP" } })).id;
  const service = createStewardService(ports), api = service.forWorkspace(workspaceId), app = createStewardAgentRoutes(ports, service);
  const peer = { server: { requestIP: () => ({ address: "127.0.0.1" }) } };
  const entry = await db.module.create({ data: { workspaceId, name: "execution-test-entry", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "v1", manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["*"] }), source: "user", status: "approved", intent: {}, report: {} } });
  const authorRoot = join(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/external/author");
  const authorManifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(authorRoot, "module.json"), "utf8")));
  const author = await db.module.create({ data: { workspaceId, name: "author", activeHash: "c".repeat(64) } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash: "c".repeat(64), manifest: authorManifest, source: "user", status: "approved", intent: {}, report: {} } });
  await mkdir(join(dataDir, "platform/store"), { recursive: true });
  await cp(authorRoot, join(dataDir, "platform/store", "c".repeat(64)), { recursive: true });
  const session = await db.session.create({ data: { workspaceId, source: "module", key: "module:http-test", moduleId: entry.id } });
  await db.agentContext.create({ data: { sessionId: session.id, workspaceId, moduleId: entry.id, hash: "v1" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Fixture; never launch a model" });
  const run = (await api.runs.claimNext("foreground"))!;
  await db.agentRunAdmission.create({ data: { runId: run.id, moduleId: entry.id, hash: (await db.agentContext.findUniqueOrThrow({ where: { sessionId: (await db.run.findUniqueOrThrow({ where: { id: run.id } })).sessionId! } })).hash, targets: [...moduleTools.map(tool => `modules.${tool}`), "author.prepare"], content: [] } });
  const headers = { authorization: `Bearer ${run.token}`, "content-type": "application/json" };
  const request = (path: string, init?: RequestInit) => app.request(path, init, peer);
  const post = (name: string, body: unknown) => request(`/tools/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { db, ports, workspaceId, api, app, service, entry, author, run, headers, request, post,
    async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("live Agent capability exposes the modern 13 module tools and pure Author material preparation through actual HTTP dispatch", async () => {
  const f = await fixture();
  try {
    expect((await f.request("/catalog")).status).toBe(401);
    expect((await f.request("/catalog", { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await f.app.request("/catalog", { headers: f.headers })).status).toBe(403);
    for (const header of ["forwarded", "x-forwarded-for", "x-real-ip"]) expect((await f.request("/catalog", { headers: { ...f.headers, [header]: "127.0.0.1" } })).status).toBe(403);
    const catalog = await f.request("/catalog", { headers: f.headers });
    expect(catalog.status).toBe(200); expect(catalog.headers.get("cache-control")).toBe("no-store");
    const names: string[] = (await catalog.json()).tools.map((tool: { name: string }) => tool.name);
    expect(names.filter(name => name.startsWith("m_modules_")).sort()).toEqual(moduleTools.map(tool => `m_modules_${tool.replaceAll("-", "_")}`).sort());
    expect(names).toContain("m_author_prepare");
    const reference = await f.post("m_modules_reference", {});
    expect(reference.status).toBe(200);
    const index: { target: string }[] = (await reference.json()).data.result;
    expect(index.filter(tool => tool.target.startsWith("modules.")).map(tool => tool.target).sort()).toEqual(moduleTools.map(tool => `modules.${tool}`).sort());
    const input = { requestKey: "draft", submitter: { moduleId: f.author.id, hash: "c".repeat(64) }, targets: [{ name: "ordinary", moduleId: null, expectedActiveHash: null }], goal: "Prepare supplied material", intent: { changes: ["Fixture"], preserves: [] } };
    const prepare = await f.post("m_author_prepare", { input: JSON.stringify(input) });
    expect(prepare.status).toBe(200);
    const body = await prepare.json(), { result } = body.data;
    expect(Object.keys(result).sort()).toEqual(["admission", "kind", "prompt", "request"]);
    expect(typeof result.prompt).toBe("string");
    for (const guidance of ["current conversation's Agent Run", "prepare itself starts no model", "writes no files", "issues no admission", "author.import", "author.export", "existing tools and budgets", "do not start a nested Agent"]) expect(result.prompt).toContain(guidance);
    expect(body).toMatchObject({ ok: true, data: { result: {
      kind: "material-preparation",
      admission: { requestKey: input.requestKey, submitter: input.submitter, targets: input.targets },
      request: { goal: input.goal, targets: input.targets, intent: input.intent },
      prompt: expect.any(String),
    } } });
    expect(await f.db.run.findMany({ select: { id: true, status: true } })).toEqual([{ id: f.run.id, status: "running" }]);
    expect(await f.db.run.count()).toBe(1);
    expect(await f.db.run.count({ where: { lane: "build" } })).toBe(0);
    expect(await f.db.candidateAdmission.count()).toBe(0);
    expect((await f.request("/tools/m_modules_tools", { method: "POST", headers: f.headers, body: "{" })).status).toBe(400);
    const outside = await f.post("m_activity_runtime", {});
    expect(outside.status).toBe(409);
    expect(await outside.json()).toMatchObject({ error: { code: "forbidden" } });
    const dispatch = spyOn(f.service.tools, "call");
    try {
      for (const code of ["unknown", "failed", "unavailable"] as const) {
        dispatch.mockRejectedValueOnce(new CallError(code, `Delivery ${code}`));
        const response = await f.post("m_modules_list", {});
        expect(response.status).toBe(code === "unavailable" ? 503 : 409);
        expect(await response.json()).toEqual({ ok: false, error: { code, message: `Delivery ${code}` } });
      }
    } finally { dispatch.mockRestore(); }
    await f.db.run.update({ where: { id: f.run.id }, data: { status: "finished" } });
    expect((await f.request("/catalog", { headers: f.headers })).status).toBe(401);
  } finally { await f.close(); }
}, 20_000);

test("retired modules.build/check routes are not_found and never queue a build", async () => {
  const f = await fixture();
  try {
    // A stored internal build session exercises the legacy Provider bridge without creating a build request.
    const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, source: "build", key: "build:retired-route" } });
    const token = "historical-build-token", expires = new Date(Date.now() + 60_000);
    await f.db.run.create({ data: { workspaceId: f.workspaceId, sessionId: session.id, lane: "build", trigger: "build", prompt: "Historical fixture only", provider: "historical-fixture", cwd: "/tmp/unused-historical-build", status: "running", tokenHash: createHash("sha256").update(token).digest("hex"), deadlineAt: expires, leaseUntil: expires } });
    for (const tool of ["build", "check", "propose", "request_group"]) {
      const response = await f.request(`/tools/m_modules_${tool}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect(await f.db.session.count({ where: { source: "build" } })).toBe(1);
    expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
    expect(await f.db.moduleVersion.count({ where: { status: "building" } })).toBe(0);
  } finally { await f.close(); }
});
