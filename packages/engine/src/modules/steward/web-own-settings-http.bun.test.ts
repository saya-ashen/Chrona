import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createServerApp } from "../../../../../apps/server/src/app";
import { createStewardRuntime } from "../../../../../apps/server/src/steward-runtime";
import { resetEnvCacheForTests } from "../../../../../apps/server/src/config/env";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";

type Args = Record<string, unknown>;
type PageRef = { module: string; id: string; revision: string };

/** Production auth, HTTP proxy, SDK process and SQLite; no provider, ticking or TCP listener. */
async function fixture() {
  const db = testDb({ injectedAgent: false });
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(item => item.name === "main")?.file;
  if (!database || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) {
    await db.$disconnect();
    throw new Error("Web HTTP regression requires its own OS-temp database");
  }
  const root = await mkdtemp(join(tmpdir(), "chrona-web-settings-"));
  const savedKey = process.env.API_KEY;
  process.env.API_KEY = "web-own-settings-offline";
  resetEnvCacheForTests();
  const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
  const runtime = createStewardRuntime(db, { provider: null, dataDir: root, sandbox: { ...sandbox.health, startModule: sandbox.startModule } });
  async function close() {
    try { await runtime.stop(); } finally {
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      await rm(dirname(database!), { recursive: true, force: true });
      if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
      resetEnvCacheForTests();
    }
  }
  try {
    const workspace = await db.workspace.create({ data: { name: "Web own settings HTTP" } });
    const hash = "web-own-settings", source = join(import.meta.dir, "external/web"), code = join(root, "platform/store", hash);
    await cp(source, code, { recursive: true, filter: path => path !== join(source, "node_modules") });
    // Reuse installed app dependencies without copying them or resolving anything over the network.
    await symlink(join(source, "node_modules"), join(code, "node_modules"), "dir");
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const web = await db.module.create({ data: { workspaceId: workspace.id, name: "web", status: "active", activeHash: hash } });
    await db.moduleVersion.create({ data: { moduleId: web.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const app = await createServerApp({ steward: runtime });
    const request = (target: string, args: unknown = {}, page?: PageRef, key: string | null = "web-own-settings-offline") => app.request("/api/web/call", {
      method: "POST", headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ target, args, ...(page ? { page } : {}) }),
    });
    async function activate() {
      const now = new Date().toISOString();
      await moduleSupervisor(runtime.ports).deliver(web.id, hash, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
    }
    async function page(): Promise<PageRef> {
      const response = await app.request("/api/web/pages/web/settings", { headers: { authorization: "Bearer web-own-settings-offline" } });
      expect(response.status).toBe(200);
      const value = await response.json();
      expect(value).toMatchObject({ module: "web", moduleId: web.id, id: "settings", purpose: "settings" });
      return { module: value.module, id: value.id, revision: value.revision };
    }
    const privateFile = join(root, "platform/data", web.id, "memory-preferences.json");
    const changeManifest = (value: typeof manifest) => db.moduleVersion.update({ where: { moduleId_hash: { moduleId: web.id, hash } }, data: { manifest: value } });
    return { db, web, runtime, manifest, request, activate, page, privateFile, changeManifest, close };
  } catch (error) { await close(); throw error; }
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f?.close(); });
const savedArgs = { provider: "memory-local", "auto-recall": false, "auto-retain": true };
const saved = { provider: "memory-local", autoRecall: false, autoRetain: true };
async function success(response: Response, expected: Args) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toEqual(expected);
}

test("authenticated HTTP reads and saves Web's own settings through the real SDK and private store", async () => {
  for (const key of [null, "wrong-key"]) {
    expect((await f.request("web.ui-settings", savedArgs, undefined, key)).status).toBe(401);
    expect((await f.request("web.ui-preferences", {}, undefined, key)).status).toBe(401);
  }
  expect(await f.db.moduleRun.count()).toBe(0);
  await f.activate();
  const page = await f.page();
  await success(await f.request("web.ui-settings", {}, page), { provider: "", autoRecall: true, autoRetain: true });
  await success(await f.request("web.ui-preferences", {}, page), { items: [] });
  await success(await f.request("web.ui-settings", savedArgs, page), saved);
  expect(JSON.parse(await readFile(f.privateFile, "utf8"))).toEqual(saved);
  expect((await stat(f.privateFile)).mode & 0o777).toBe(0o600);
  await moduleSupervisor(f.runtime.ports).settleModule(f.web.id);
  await success(await f.request("web.ui-settings"), saved);
  await success(await f.request("web.ui-preferences"), { items: [] });
  expect(await f.db.run.count()).toBe(0);
}, 30_000);

test("own-settings HTTP retains page revision and contract pins and input/output validation", async () => {
  await f.activate();
  const page = await f.page();
  for (const args of [[], "bad", { ...savedArgs, extra: true }, { ...savedArgs, "auto-recall": "false" }]) {
    expect((await f.request("web.ui-settings", args, page)).status).toBe(400);
  }
  expect((await f.request("web.ui-preferences", { extra: true }, page)).status).toBe(400);
  await f.activate();
  expect((await f.request("web.ui-settings", savedArgs, page)).status).toBe(409);
  const current = await f.page();
  const changed = structuredClone(f.manifest), settings = changed.tools!.find(tool => tool.name === "ui-settings")!;
  settings.parameters.properties.provider = { type: "string", enum: ["memory-other"] };
  await f.changeManifest(changed);
  expect((await f.request("web.ui-settings", savedArgs, current)).status).toBe(409);
  expect((await f.request("web.ui-settings", savedArgs)).status).toBe(400);
  settings.output = { type: "object", properties: { unexpected: { type: "string" } }, required: ["unexpected"], additionalProperties: false };
  await f.changeManifest(changed);
  const output = await f.request("web.ui-settings");
  expect(output.status).toBe(502);
  expect(await output.json()).toMatchObject({ code: "failed" });
  await expect(readFile(f.privateFile)).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

test("local own-settings dispatch cannot retain revoked approved-owner authority", async () => {
  await success(await f.request("web.ui-settings", savedArgs), saved);
  await f.changeManifest({ ...f.manifest, authority: undefined, uses: [] });
  for (const target of ["web.ui-settings", "web.ui-preferences"]) {
    expect((await f.request(target)).status).toBe(404);
  }
  expect((await f.request("web.ui-settings", { ...savedArgs, "auto-recall": true })).status).toBe(404);
  expect(JSON.parse(await readFile(f.privateFile, "utf8"))).toEqual(saved);
}, 30_000);
