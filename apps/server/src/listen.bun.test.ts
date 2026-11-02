import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleSupervisor } from "@chrona/engine";
import { createServerApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { createScriptSandbox } from "../../../packages/integrations/src/steward/script-sandbox";
import { db, resetTestDb, seedWorkspace } from "./__tests__/bun-test-helpers";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
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
  const base = { name: "web-x", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], keepAlive: true };
  expect(moduleManifestSchema.safeParse({ ...base, listen: "/api/echo" }).success).toBe(true);
  expect(moduleManifestSchema.safeParse({ ...base, keepAlive: false, listen: "/api/echo" }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...base, listen: "/" }).success).toBe(true);
  for (const listen of ["/api/steward", "/api/steward-agent", "/api/workspaces", "/api/health", "/api/a/b", "/x"]) expect(moduleManifestSchema.safeParse({ ...base, listen }).success).toBe(false);
  // Several paths (v2-8): each checked; serving "/" makes it an entry module.
  expect(moduleManifestSchema.safeParse({ ...base, listen: ["/", "/api/web"] }).success).toBe(true);
  for (const listen of [["/", "/api/steward"], ["/api/web", "/api/web"], []]) expect(moduleManifestSchema.safeParse({ ...base, listen }).success).toBe(false);
  expect(isEntryModule({ effects: [], listen: ["/api/x", "/"] })).toBe(true);
  expect(isEntryModule({ effects: [], listen: ["/api/x"] })).toBe(false);
});

(sandbox.health.isolated ? test : test.skip)("authenticated requests reach the listening module, which makes routed calls", async () => {
  const { workspaceId } = await seedWorkspace("Listen");
  const manifest = moduleManifestSchema.parse({ name: "echo", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], uses: ["chat.today"], keepAlive: true, listen: "/api/echo" });
  const module = await db.module.create({ data: { workspaceId, name: "echo", activeHash: "v1", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona } from "chrona";
chrona.serve(async request => {
  const today = await chrona.call("chat.today") as { apps?: unknown };
  return Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).search, auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), body: await request.text(), apps: Array.isArray(today.apps) });
});`);
  const steward = createStewardRuntime(db, { provider: null, dataDir, sandbox: { available: true, isolated: true, startModule: sandbox.startModule } });
  stop = () => steward.stop();
  const app = await createServerApp({ steward });
  expect((await app.request("/api/echo/x")).status).toBe(401);
  const response = await app.request("/api/echo/x?y=1", { method: "POST", headers: { authorization: "Bearer listen-test", cookie: "s=1" }, body: "hi" });
  expect(await response.json()).toEqual({ path: "/api/echo/x", query: "?y=1", auth: null, cookie: null, body: "hi", apps: true });
  expect((await (await app.request("/api/echo", { headers: { authorization: "Bearer listen-test" } })).json()).path).toBe("/api/echo");
  expect((await app.request("/api/nothing/x", { headers: { authorization: "Bearer listen-test" } })).status).toBe(404);
}, 30_000);

for (const isolated of [true, false]) (isolated && !sandbox.health.isolated ? test.skip : test)(`the built-in mcp module serves owner tools at /api/mcp (${isolated ? "bwrap" : "no sandbox"})`, async () => {
  await seedWorkspace("Mcp");
  const bwrap = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  if (isolated) process.env.CHRONA_STEWARD_SANDBOX_BWRAP = Bun.which("bwrap")!; else delete process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  const steward = createStewardRuntime(db, { provider: null, dataDir });
  if (bwrap === undefined) delete process.env.CHRONA_STEWARD_SANDBOX_BWRAP; else process.env.CHRONA_STEWARD_SANDBOX_BWRAP = bwrap;
  stop = () => steward.stop();
  expect(steward.ports.sandbox?.isolated).toBe(isolated);
  await moduleSupervisor(steward.ports).start();
  // Every built-in, including qq (unconfigured here), builds, passes its author tests and activates.
  const unfinished = await db.moduleVersion.findMany({ where: { module: { builtin: true, activeHash: null } }, select: { manifest: true, status: true, report: true } });
  expect((await db.module.findMany({ where: { builtin: true }, orderBy: { name: "asc" } })).map(row => [row.name, row.status, Boolean(row.activeHash)]), JSON.stringify(unfinished)).toEqual(["events", "files", "mcp", "mind", "notify", "qq", "remind", "web"].map(name => [name, "active", true]));
  const app = await createServerApp({ steward });
  // The web module serves the page at / (no key needed), while the API it calls stays protected.
  const page = await app.request("/apps/a1?path=README.md");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<script src="/app.js" type="module">');
  expect((await app.request("/app.js")).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  expect((await app.request("/", { method: "POST" })).status).toBe(404);
  // The page's data API is the web module's own, behind the user's key, answered by routed calls (v2-8).
  expect((await app.request("/api/web/today")).status).toBe(401);
  const view = await app.request("/api/web/today", { headers: { authorization: "Bearer listen-test" } });
  expect(view.status).toBe(200);
  expect(await view.json()).toMatchObject({ approvals: [], apps: expect.arrayContaining([expect.objectContaining({ name: "files" })]) });
  const apps = await (await app.request("/api/web/modules", { headers: { authorization: "Bearer listen-test" } })).json() as { name: string; versions: unknown[] }[];
  expect(apps.find(row => row.name === "web")?.versions.length).toBeGreaterThan(0);
  expect(await db.moduleInvocation.findMany({ where: { target: { in: ["chat", "modules"] } }, select: { target: true, tool: true, status: true }, orderBy: { createdAt: "asc" } }))
    .toEqual([{ target: "chat", tool: "today", status: "succeeded" }, { target: "modules", tool: "list", status: "succeeded" }]);
  let id = 0;
  const rpc = async (method: string, params: unknown = {}, headers: Record<string, string> = { authorization: "Bearer listen-test" }) => {
    const response = await app.request("/api/mcp", { method: "POST", headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  };
  expect((await rpc("tools/list", {}, {})).status).toBe(401);
  expect((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).body.result.instructions).toMatch(/Apps with tools: .*files/);
  const names = (await rpc("tools/list")).body.result.tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["chrona_today", "chrona_chat", "chrona_approval_resolve", "chrona_module_tools", "chrona_module_call"]));
  expect(JSON.parse((await rpc("tools/call", { name: "chrona_module_tools", arguments: { query: "files" } })).body.result.content[0].text).map((tool: { target: string }) => tool.target)).toContain("files.list");
  expect((await rpc("tools/call", { name: "chrona_today", arguments: {} })).body.result.content[0].text).toContain("approvals");
  expect(JSON.parse((await rpc("tools/call", { name: "chrona_module_call", arguments: { name: "files.list", arguments: {} } })).body.result.content[0].text)).toHaveProperty("entries");
}, 120_000);
