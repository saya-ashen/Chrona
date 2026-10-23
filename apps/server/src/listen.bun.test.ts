import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
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
  for (const listen of ["/api/steward", "/api/steward-agent", "/api/workspaces", "/api/health", "/api/a/b", "/"]) expect(moduleManifestSchema.safeParse({ ...base, listen }).success).toBe(false);
});

(sandbox.health.available ? test : test.skip)("authenticated requests reach the listening module, which calls the owner API", async () => {
  const { workspaceId } = await seedWorkspace("Listen");
  const manifest = moduleManifestSchema.parse({ name: "echo", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: ["owner"], keepAlive: true, listen: "/api/echo" });
  const module = await db.module.create({ data: { workspaceId, name: "echo", activeHash: "v1", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona } from "/chrona/sdk.ts";
chrona.serve(async request => {
  const today = await chrona.owner({ method: "GET", path: "/today" });
  const denied = await chrona.owner({ method: "GET", path: "/today?workspaceId=other" });
  return Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).search, auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), body: await request.text(), today: today.status, overridden: denied.status, apps: Array.isArray((today.body as { apps?: unknown }).apps) });
});`);
  const steward = createStewardRuntime(db, { provider: null, chatTransport: null, dataDir, sandbox: { available: true, startModule: sandbox.startModule } });
  stop = () => steward.stop();
  const app = await createServerApp({ steward });
  expect((await app.request("/api/echo/x")).status).toBe(401);
  const response = await app.request("/api/echo/x?y=1", { method: "POST", headers: { authorization: "Bearer listen-test", cookie: "s=1" }, body: "hi" });
  expect(await response.json()).toEqual({ path: "/api/echo/x", query: "?y=1", auth: null, cookie: null, body: "hi", today: 200, overridden: 200, apps: true });
  expect((await (await app.request("/api/echo", { headers: { authorization: "Bearer listen-test" } })).json()).path).toBe("/api/echo");
  expect((await app.request("/api/nothing/x", { headers: { authorization: "Bearer listen-test" } })).status).toBe(404);
}, 30_000);
