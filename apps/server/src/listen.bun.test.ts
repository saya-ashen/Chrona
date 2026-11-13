import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { createServerApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { createScriptSandbox } from "../../../packages/integrations/src/steward/script-sandbox";
import { db, resetTestDb, seedWorkspace } from "./__tests__/bun-test-helpers";

let saved: string | undefined, dataDir: string, stop: (() => Promise<void>) | undefined;
beforeEach(async () => {
  saved = process.env.API_KEY;
  process.env.API_KEY = "listen-test";
  resetEnvCacheForTests();
  await resetTestDb();
  dataDir = await mkdtemp("/tmp/chrona-listen-");
});
afterEach(async () => {
  await stop?.(); stop = undefined;
  await db.$disconnect();
  await rm(dataDir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.API_KEY; else process.env.API_KEY = saved;
  resetEnvCacheForTests();
});

test("listen needs keepAlive and a path Chrona does not reserve", () => {
  const base = { name: "web-x", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true };
  expect(moduleManifestSchema.safeParse({ ...base, listen: "/api/echo" }).success).toBe(true);
  expect(moduleManifestSchema.safeParse({ ...base, keepAlive: false, listen: "/api/echo" }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...base, listen: "/" }).success).toBe(true);
  for (const listen of ["/api/steward", "/api/steward-agent", "/api/workspaces", "/api/health", "/api/a/b", "/x"]) expect(moduleManifestSchema.safeParse({ ...base, listen }).success).toBe(false);
  // Several paths (v2-8): each checked; serving "/" makes it an entry module.
  expect(moduleManifestSchema.safeParse({ ...base, listen: ["/", "/api/web"] }).success).toBe(true);
  for (const listen of [["/", "/api/steward"], ["/api/web", "/api/web"], []]) expect(moduleManifestSchema.safeParse({ ...base, listen }).success).toBe(false);
  expect(isEntryModule({ listen: ["/api/x", "/"] })).toBe(true);
  expect(isEntryModule({ listen: ["/api/x"] })).toBe(true);
});

test("authenticated generic listener routes calls and strips credentials (trusted-local)", async () => {
  const selected = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const { workspaceId } = await seedWorkspace("Listen");
  const manifest = moduleManifestSchema.parse({ name: "echo", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["modules.list"], keepAlive: true, listen: "/api/echo" });
  const module = await db.module.create({ data: { workspaceId, name: "echo", activeHash: "v1", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona } from "chrona";
chrona.serve(async request => {
  const apps = await chrona.call("modules.list");
  return Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).search, auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), transportToken: request.headers.get("x-chrona-module-token"), body: await request.text(), apps: Array.isArray(apps.items) }, { headers: { "set-cookie": "module=must-not-escape" } });
});`);
  const steward = createStewardRuntime(db, { provider: null, dataDir, sandbox: { ...selected.health, startModule: selected.startModule } });
  stop = () => steward.stop();
  const app = await createServerApp({ steward });
  expect((await app.request("/api/echo/x")).status).toBe(401);
  const response = await app.request("/api/echo/x?y=1", { method: "POST", headers: { authorization: "Bearer listen-test", cookie: "s=1", "x-chrona-module-token": "attacker-supplied" }, body: "hi" });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.json()).toEqual({ path: "/api/echo/x", query: "?y=1", auth: null, cookie: null, transportToken: null, body: "hi", apps: true });
  expect((await (await app.request("/api/echo", { headers: { authorization: "Bearer listen-test" } })).json()).path).toBe("/api/echo");
  expect((await app.request("/api/nothing/x", { headers: { authorization: "Bearer listen-test" } })).status).toBe(404);
}, 30_000);

test("current MCP JSON-RPC requires the API key and routes current tools through the real SDK", async () => {
  const { workspaceId } = await seedWorkspace("MCP listener");
  const selected = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const source = join(import.meta.dirname, "../../../packages/engine/src/modules/steward/external/mcp");
  const code = join(dataDir, "platform/store/mcp-listener");
  await cp(source, code, { recursive: true });
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
  const module = await db.module.create({ data: { workspaceId, name: "mcp", activeHash: "mcp-listener", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "mcp-listener", manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const targetManifest = moduleManifestSchema.parse({ name: "mcp-target", entry: "index.ts", keepAlive: true, effects: [], tests: ["test.ts"], tools: [{
    name: "echo", description: "Offline routed target", visibility: ["owner", "modules"],
    parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    output: { type: "object", properties: { value: { type: "string" }, caller: { type: "string" }, moduleId: { type: "string" } }, required: ["value", "caller", "moduleId"], additionalProperties: false },
  }] });
  const target = await db.module.create({ data: { workspaceId, name: "mcp-target", activeHash: "mcp-target-listener", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: target.id, hash: "mcp-target-listener", manifest: targetManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const targetCode = join(dataDir, "platform/store/mcp-target-listener");
  await mkdir(targetCode, { recursive: true });
  await writeFile(join(targetCode, "index.ts"), `import { on } from "chrona";
on("tool", event => {
  if (event.caller?.kind !== "module") throw new Error("Expected actual module caller");
  return { result: { value: event.args.value, caller: event.caller.module, moduleId: event.caller.moduleId } };
});`);
  const steward = createStewardRuntime(db, { provider: null, dataDir, sandbox: { ...selected.health, startModule: selected.startModule } });
  stop = () => steward.stop();
  const app = await createServerApp({ steward });
  const cases = [
    { method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "offline-integration", version: "1" } } },
    { method: "tools/list", params: {} },
    { method: "tools/call", params: { name: "chrona_modules", arguments: {} } },
  ];
  for (const [id, request] of cases.entries()) {
    for (const key of [undefined, "wrong-key"]) {
      const response = await app.request("/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, ...request }) });
      expect(response.status).toBe(401);
    }
  }
  expect(await db.moduleRun.count()).toBe(0);
  async function rpc(id: number, method: string, params: Record<string, unknown>) {
    const response = await app.request("/api/mcp", { method: "POST", headers: { authorization: "Bearer listen-test", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id });
    expect(body.error).toBeUndefined();
    return body.result;
  }
  const initialized = await rpc(1, "initialize", cases[0]!.params);
  expect(initialized).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "chrona" } });
  const catalog = await rpc(2, "tools/list", {});
  const names = catalog.tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["chrona_module_tools", "chrona_module_reference", "chrona_module_call", "chrona_modules", "chrona_sessions"]));
  expect(names).not.toContain("chrona_build");
  async function tool(id: number, name: string, args = {}) {
    const result = await rpc(id, "tools/call", { name, arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.content[0].type).toBe("text");
    return JSON.parse(result.content[0].text);
  }
  expect(await tool(3, "chrona_modules")).toEqual(expect.arrayContaining([expect.objectContaining({ id: module.id, name: "mcp", builtin: false })]));
  expect(await tool(4, "chrona_sessions")).toEqual([]);
  const contracts = await tool(5, "chrona_module_tools", { query: "mcp-target.echo" });
  expect(contracts).toEqual(expect.arrayContaining([expect.objectContaining({ target: "mcp-target.echo", moduleId: target.id, hash: "mcp-target-listener" })]));
  for (const contract of contracts) expect(contract).not.toHaveProperty("contractHash");
  expect(await tool(6, "chrona_module_call", { name: "mcp-target.echo", arguments: { value: "SDK round trip" } })).toEqual({ value: "SDK round trip", caller: "mcp", moduleId: module.id });
  expect(await db.run.count()).toBe(0);
  expect(await db.moduleVersion.count({ where: { moduleId: module.id } })).toBe(1);
}, 30_000);
