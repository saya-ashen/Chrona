import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { createServerApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { createScriptSandbox } from "../../../packages/host/src/runtime/script-sandbox";
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

test("generic listener preserves application authentication and replaces the transport token", async () => {
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
  return Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).search, auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), transportToken: request.headers.get("x-chrona-module-token"), body: await request.text(), apps: Array.isArray(apps.items) }, { headers: { "set-cookie": "module=session" } });
});`);
  const steward = createStewardRuntime(db, { dataDir, sandbox: { ...selected.health, startModule: selected.startModule } });
  stop = () => steward.stop();
  const app = await createServerApp({ steward });
  expect((await app.request("/api/echo/x")).status).toBe(200);
  const response = await app.request("/api/echo/x?y=1", { method: "POST", headers: { authorization: "Bearer listen-test", cookie: "s=1", "x-chrona-module-token": "attacker-supplied" }, body: "hi" });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBe("module=session");
  expect(await response.json()).toEqual({ path: "/api/echo/x", query: "?y=1", auth: "Bearer listen-test", cookie: "s=1", transportToken: null, body: "hi", apps: true });
  expect((await (await app.request("/api/echo", { headers: { authorization: "Bearer listen-test" } })).json()).path).toBe("/api/echo");
  expect((await app.request("/api/nothing/x", { headers: { authorization: "Bearer listen-test" } })).status).toBe(404);
}, 30_000);
