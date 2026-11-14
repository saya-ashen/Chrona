import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
async function fixture() {
  const db = testDb({ injectedAgent: false });
  const rows = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = rows.find(row => row.name === "main")?.file;
  if (!database || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) throw new Error("Mind acceptance needs its own temporary SQLite database");
  const root = await mkdtemp(join(tmpdir(), "chrona-mind-runtime-"));
  const previousKey = process.env.API_KEY;
  process.env.API_KEY = "mind-offline-acceptance";
  resetEnvCacheForTests();
  const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
  const runtime = createStewardRuntime(db, { provider: null, dataDir: root, sandbox: { ...sandbox.health, startModule: sandbox.startModule } });
  async function close() {
    try { await runtime.stop(); } finally {
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      await rm(dirname(database!), { recursive: true, force: true });
      if (previousKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = previousKey;
      resetEnvCacheForTests();
    }
  }
  try {
    await symlink(resolve(import.meta.dir, "../../../../../node_modules"), join(root, "node_modules"), "dir");
    const workspace = await db.workspace.create({ data: { name: "Mind production SDK acceptance" } });
    async function install(name: string, source: string) {
      const hash = `mind-runtime-${name}`, code = join(root, "platform/store", hash);
      await cp(source, code, { recursive: true, filter: path => path !== join(source, "node_modules") });
      await symlink(join(source, "node_modules"), join(code, "node_modules"), "dir");
      if (name === "mind") {
        const build = Bun.spawn([process.execPath, "run", "build.ts"], { cwd: code, stdout: "pipe", stderr: "pipe" });
        const [exitCode, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
        expect(exitCode, stderr).toBe(0);
      }
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
      const app = await db.module.create({ data: { workspaceId: workspace.id, name, status: "active", activeHash: hash } });
      await db.moduleVersion.create({ data: { moduleId: app.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return app;
    }
    const web = await install("web", join(import.meta.dir, "external/web"));
    const mind = await install("mind", join(import.meta.dir, "external/mind"));
    const app = await createServerApp({ steward: runtime });
    const request = (target: string, args: Args = {}, key: string | null = "mind-offline-acceptance", page?: PageRef) => app.request("/api/web/call", {
      method: "POST", headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) }, body: JSON.stringify({ target, args, ...(page ? { page } : {}) }),
    });
    async function activate(module: typeof mind) {
      const now = new Date().toISOString();
      return moduleSupervisor(runtime.ports).deliver(module.id, module.activeHash!, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
    }
    async function page(id: string): Promise<PageRef> {
      let response: Response;
      const deadline = Date.now() + 5_000;
      do {
        response = await app.request(`/api/web/pages/mind/${id}`, { headers: { authorization: "Bearer mind-offline-acceptance" } });
        if (response.status !== 404) break;
        await Bun.sleep(25);
      } while (Date.now() < deadline);
      const value = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(200);
      expect(value).toMatchObject({ module: "mind", moduleId: mind.id, id, ...(id === "settings" ? { purpose: "settings" } : {}) });
      expect(value.revision).toBeString();
      return { module: value.module, id: value.id, revision: value.revision };
    }
    return { db, root, runtime, web, mind, request, activate, page, close };
  } catch (error) { await close(); throw error; }
}
let current: Awaited<ReturnType<typeof fixture>> | undefined;
afterEach(async () => { await current?.close(); current = undefined; });

test("Mind activation registers its main and settings pages with current contract pins", async () => {
  const f = current = await fixture();
  await f.activate(f.web);
  await f.activate(f.mind);
  const main = await f.page("main"), settings = await f.page("settings");
  const read = await f.request("mind.overview", {}, "mind-offline-acceptance", main);
  expect(read.status, await read.clone().text()).toBe(200);
  const overview = JSON.parse((await read.json()).json);
  expect(overview.items).toEqual([]);
  const initial = await f.request("mind.settings", {}, "mind-offline-acceptance", settings);
  expect(initial.status, await initial.clone().text()).toBe(200);
  const state = JSON.parse((await initial.json()).json);
  const save = await f.request("mind.settings", { patch: JSON.stringify({ notifyEnabled: true }), revision: state.revision }, "mind-offline-acceptance", settings);
  expect(save.status, await save.clone().text()).toBe(200);
  await f.activate(f.mind);
  const stale = await f.request("mind.settings", {}, "mind-offline-acceptance", settings);
  expect(stale.status, await stale.text()).toBe(409);
  const refreshed = await f.page("settings");
  expect(refreshed.revision).not.toBe(settings.revision);
  const currentSettings = await f.request("mind.settings", {}, "mind-offline-acceptance", refreshed);
  expect(currentSettings.status, await currentSettings.clone().text()).toBe(200);
  expect(JSON.parse((await currentSettings.json()).json)).toMatchObject({ notifyEnabled: true });
  expect(await f.db.run.count()).toBe(0);
}, 30_000);
