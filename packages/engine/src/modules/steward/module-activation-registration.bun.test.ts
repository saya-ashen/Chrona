import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await Bun.sleep(10); }
  throw new Error("Activation announcement did not settle");
}

for (const name of ["files", "remind", "mind"] as const) for (const persistent of [false, true]) {
  test(`real ${name} SDK activation retries via reconcile and stays bounded (persistent=${persistent})`, async () => {
    const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-registration-"));
    const workspace = await db.workspace.create({ data: { name: "registration" } });
    const builtinRoot = join(dataDir, "platform", "builtin");
    await mkdir(builtinRoot, { recursive: true });
    if (name === "files") {
      await cp(join(import.meta.dirname, "builtin/files"), join(builtinRoot, "files"), { recursive: true });
      await seedTestModuleRelease(builtinRoot, "files");
    }
    const externalRoot = join(dataDir, "platform", "external");
    if (name !== "files") {
      await mkdir(externalRoot, { recursive: true });
      await cp(join(import.meta.dirname, "external", name), join(externalRoot, name), { recursive: true });
      await seedTestModuleRelease(externalRoot, name);
    }
    const sdk = resolve(import.meta.dirname, "../../../../integrations/src/steward/module-sdk");
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk });
    let calls = 0, delivered = 0;
    const webCodeDir = join(builtinRoot, "web");
    let webRuntimeDir = webCodeDir;
    const peer = testModuleProcess(async () => { calls++; if (persistent || calls === 1) throw new Error("Synthetic Web unavailable"); delivered++; return { result: { id: "main", catalog: "fixture" } }; });
    const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleSdk: sdk, moduleBuiltinResources: builtinRoot,
      moduleExternalResources: externalRoot, sandbox: { available: true, isolated: false,
        startModule: input => input.codeDir === webRuntimeDir ? peer.startModule(input) : sandbox.startModule(input) } };
    const supervisor = moduleSupervisor(ports);
    cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
    const shippedWeb = moduleManifestSchema.parse(await Bun.file(join(import.meta.dirname, "builtin/web/module.json")).json());
    const webManifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], keepAlive: false, tools: [shippedWeb.tools.find(tool => tool.name === "page-set")!] });
    await mkdir(webCodeDir, { recursive: true });
    await Bun.write(join(webCodeDir, "module.json"), JSON.stringify(webManifest));
    await Bun.write(join(webCodeDir, "index.ts"), "// Synthetic peer; never executed\n");
    await Bun.write(join(webCodeDir, "test.ts"), "// Synthetic author fixture\n");
    await seedTestModuleRelease(builtinRoot, "web");
    const webRelease = await resolveBuiltinRelease(ports, "web");
    webRuntimeDir = join(dataDir, "platform", "store", webRelease.hash);
    await cp(webRelease.codeDir, webRuntimeDir, { recursive: true });
    const web = await db.module.create({ data: { workspaceId: workspace.id, name: "web", builtin: true, activeHash: webRelease.hash } });
    await db.moduleVersion.create({ data: { moduleId: web.id, hash: webRelease.hash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const release = name === "files" ? await resolveBuiltinRelease(ports, name) : await resolveExternalRelease(ports, name);
    await cp(release.codeDir, join(dataDir, "platform", "store", release.hash), { recursive: true });
    const app = await db.module.create({ data: { workspaceId: workspace.id, name, builtin: name === "files", activeHash: release.hash } });
    await db.moduleVersion.create({ data: { moduleId: app.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const announced = async () => JSON.parse(await readFile(join(dataDir, "platform", "activated.json"), "utf8").catch(() => "{}")) as Record<string, string>;
    for (let attempt = 1; attempt <= (persistent ? 3 : 2); attempt++) {
      await supervisor.reconcile();
      await until(async () => await db.moduleRun.count({ where: { moduleId: app.id, triggerId: "activated", OR: [{ exitCode: 0 }, { error: { not: null } }] } }) >= attempt);
      // announce persists only after delivery settles; a later pass must actually be free to retry.
      await until(async () => persistent || attempt === 1 ? (await db.moduleRun.findFirst({ where: { moduleId: app.id, triggerId: "activated" }, orderBy: { createdAt: "desc" } }))?.error !== null : !!(await announced())[app.id]);
      await Bun.sleep(30);
      if (attempt === 1) { expect((await announced())[app.id]).toBeUndefined(); expect(await db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "active" }); }
    }
    for (let i = 0; i < 2; i++) { await supervisor.reconcile(); await Bun.sleep(30); }
    expect(calls).toBe(persistent ? 3 : 2);
    expect(delivered).toBe(persistent ? 0 : 1);
    expect(await db.moduleRun.count({ where: { moduleId: app.id, triggerId: "activated" } })).toBe(persistent ? 3 : 2);
    expect(await db.module.findUniqueOrThrow({ where: { id: web.id } })).toMatchObject({ status: "active" });
    expect((await announced())[app.id]).toBeDefined();
  }, 20_000);
}
