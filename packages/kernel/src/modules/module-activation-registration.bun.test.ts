import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveExternalRelease } from "./module-release";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await Bun.sleep(10); }
  throw new Error("Activation announcement did not settle");
}

for (const persistent of [false, true]) {
  const name = "files";
  test(`real ${name} SDK activation keeps an unconfirmed delivery without replay (persistent=${persistent})`, async () => {
    const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-registration-"));
    const workspace = await db.workspace.create({ data: { name: "registration" } });
    const externalRoot = join(dataDir, "platform", "external");
    await mkdir(externalRoot, { recursive: true });
    await cp(join(import.meta.dirname, "../../../../.generated/applications", name), join(externalRoot, name), { recursive: true });
    await seedTestModuleRelease(externalRoot, name);
    const sdk = resolve(import.meta.dirname, "../../../app-sdk");
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk });
    let calls = 0, delivered = 0;
    const webCodeDir = join(externalRoot, "web");
    let webRuntimeDir = webCodeDir;
    const peer = testModuleProcess(async () => { calls++; if (persistent || calls === 1) throw new Error("Synthetic Web unavailable"); delivered++; return { result: { id: "main", catalog: "fixture" } }; });
    const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleSdk: sdk,
      moduleExternalResources: externalRoot, sandbox: { available: true, isolated: false,
        startModule: input => input.codeDir === webRuntimeDir ? peer.startModule(input) : sandbox.startModule(input) } };
    const supervisor = moduleSupervisor(ports);
    cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
    const shippedWeb = moduleManifestSchema.parse(await Bun.file(join(import.meta.dirname, "../../../../.generated/applications/web/module.json")).json());
    const webManifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: false, tools: [shippedWeb.tools.find(tool => tool.name === "page-set")!] });
    await mkdir(webCodeDir, { recursive: true });
    await Bun.write(join(webCodeDir, "module.json"), JSON.stringify(webManifest));
    await Bun.write(join(webCodeDir, "index.ts"), "// Synthetic peer; never executed\n");
    await Bun.write(join(webCodeDir, "test.ts"), "// Synthetic author fixture\n");
    await seedTestModuleRelease(externalRoot, "web");
    const webRelease = await resolveExternalRelease(ports, "web");
    webRuntimeDir = join(dataDir, "platform", "store", webRelease.hash);
    await cp(webRelease.codeDir, webRuntimeDir, { recursive: true });
    const web = await db.module.create({ data: { workspaceId: workspace.id, name: "web", builtin: false, activeHash: webRelease.hash } });
    await db.moduleVersion.create({ data: { moduleId: web.id, hash: webRelease.hash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const release = await resolveExternalRelease(ports, name);
    await cp(release.codeDir, join(dataDir, "platform", "store", release.hash), { recursive: true });
    const app = await db.module.create({ data: { workspaceId: workspace.id, name, builtin: false, activeHash: release.hash } });
    await db.moduleVersion.create({ data: { moduleId: app.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
    await supervisor.reconcile();
    await until(async () => !!(await db.moduleRun.findFirst({ where: { moduleId: app.id, triggerId: "activated", error: { not: null } } })));
    for (let i = 0; i < 3; i++) { await supervisor.reconcile(); await Bun.sleep(30); }
    expect(calls).toBe(1);
    expect(delivered).toBe(0);
    expect(await db.moduleRun.count({ where: { moduleId: app.id, triggerId: "activated" } })).toBe(1);
    expect(await db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "active" });
    expect(await db.module.findUniqueOrThrow({ where: { id: web.id } })).toMatchObject({ status: "active" });
  }, 20_000);
}

for (const name of ["remind"] as const) for (const status of ["active", "paused"] as const) {
  test(`retained ${name} source never registers or executes while admission is paused (status=${status})`, async () => {
    const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-registration-paused-"));
    const externalRoot = join(dataDir, "platform", "external"), source = join(externalRoot, name);
    await cp(join(import.meta.dirname, "../../../../.generated/applications", name), source, { recursive: true });
    // Retained manifests belong to the archived app; do not rewrite them into current contracts.
    const manifest = await Bun.file(join(source, "module.json")).json();
    const workspace = await db.workspace.create({ data: { name: "paused-registration" } });
    const app = await db.module.create({ data: { workspaceId: workspace.id, name, status, activeHash: "retained" } });
    await db.moduleVersion.create({ data: { moduleId: app.id, hash: "retained", manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const data = join(dataDir, "platform", "data", app.id);
    await mkdir(data, { recursive: true });
    await Bun.write(join(data, "retained.json"), "[1]");
    let starts = 0;
    const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: externalRoot,
      sandbox: { available: true, isolated: true, startModule() { starts++; throw new Error("Paused app must never execute"); } } };
    const supervisor = moduleSupervisor(ports);
    cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
    await expect(resolveExternalRelease(ports, name)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
    for (let i = 0; i < 3; i++) await supervisor.reconcile();
    const now = ports.now().toISOString();
    await expect(supervisor.deliver(app.id, "retained", { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} })).rejects.toThrow("paused");
    expect(starts).toBe(0);
    expect(await db.moduleRun.count({ where: { moduleId: app.id } })).toBe(0);
    expect(await db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status, activeHash: "retained" });
    expect(await readFile(join(data, "retained.json"), "utf8")).toBe("[1]");
    expect(await Bun.file(join(source, "module.json")).json()).toEqual(manifest);
  });
}
