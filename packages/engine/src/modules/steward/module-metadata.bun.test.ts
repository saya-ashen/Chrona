import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createApps } from "./apps";
import { createModules } from "./modules";
import { moduleInterfaces, moduleInterfacesOutputSchema } from "./system-apps";
import { MODULE_DIAGNOSTICS_DOCUMENTATION, MODULE_HEALTH_DOCUMENTATION } from "./module-diagnostics";
import { modulesListOutput } from "./system-outputs";
import { registerSystemModules } from "./system-modules";
import { callSync } from "./module-calls";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "metadata" } });
  const ports: StewardPorts = { db, dataDir: "/unused-metadata-observation", publicUrl: null, now: () => new Date("2026-11-09T00:00:00Z") };
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "active", dataSchema: 77 } });
  const manifest = moduleManifestSchema.parse({ name: "example", description: "Active application description", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [],
    tools: [{ name: "settings", description: "Change this application's preferences", parameters: { type: "object" }, visibility: ["owner"],
        output: {}
    }] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "active", manifest, source: "user", status: "approved", intent: {}, report: {}, createdAt: new Date(0) } });
  return { db, ports, workspaceId: workspace.id, module, manifest };
}

test("app and internal interface metadata use strict manifests without central configuration or host claims", async () => {
  const f = await fixture(); registerSystemModules();
  const app = (await createApps(f.ports, f.workspaceId).list())[0]!;
  expect(app).toMatchObject({ id: f.module.id, name: "example", description: f.manifest.description, status: "active", activeHash: "active", origin: "external", capabilities: { configure: false } });
  const entry = moduleInterfacesOutputSchema.parse(await moduleInterfaces(f.ports, f.workspaceId, "example"));
  expect(entry).toMatchObject({ origin: "external", capabilities: { configure: false }, tools: [{ name: "settings", visibility: ["owner"] }] });
  expect(entry).not.toHaveProperty("runtime");
  const internal = await moduleInterfaces(f.ports, f.workspaceId);
  expect(Array.isArray(internal)).toBe(true);
  if (!Array.isArray(internal)) throw new Error("Expected the internal interface list");
  for (const host of ["runtime-callback", "workspace-local", "content-local"]) expect(internal.map(item => item.name)).not.toContain(host);
  expect(internal.every(item => !("runtime" in item))).toBe(true);
  for (const removed of ["settings", "contributes", "healthCheck", "triggers"]) {
    expect(moduleManifestSchema.safeParse({ ...f.manifest, [removed]: removed === "healthCheck" ? true : {} }).success).toBe(false);
  }
});

test("modules list bounds history, retains the older active description and projects only observed metadata", async () => {
  const f = await fixture();
  const key = "CHRONA_METADATA_TEST_TOKEN", previous = process.env[key], secret = "synthetic-metadata-credential";
  process.env[key] = secret;
  try {
    const git = { commit: "a".repeat(40), tree: "b".repeat(40) };
    for (let i = 1; i <= 7; i++) {
      await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: `candidate-${i}`, manifest: { ...f.manifest, description: "Unactivated description" }, source: "build", status: "rejected",
        intent: { storePaths: ["private-intent-path"] }, report: { errors: Array.from({ length: 9 }, () => "x".repeat(290) + secret + " token=private-candidate " + "x".repeat(1000)), git, storePaths: ["private-report-path"], tests: [{ stderr: "private-build-stderr" }] }, createdAt: new Date(i * 1000) } });
      await f.db.moduleRun.create({ data: { moduleId: f.module.id, hash: "active", triggerId: "tool:read", firedAt: new Date(i * 1000), exitCode: 1,
        error: `${secret} password=private-run ` + "x".repeat(3000), output: { private: "private-run-output" }, createdAt: new Date(i * 1000) } });
    }
    const other = await f.db.workspace.create({ data: { name: "other-metadata" } });
    await f.db.module.create({ data: { workspaceId: other.id, name: "foreign" } });
    const before = [await f.db.moduleVersion.count(), await f.db.moduleRun.count(), await f.db.audit.count()];
    const list = await createModules(f.ports, f.workspaceId).list();
    expect(list).toHaveLength(1);
    const app = list[0]!;
    expect(Object.keys(app).sort()).toEqual(["id", "name", "builtin", "status", "activeHash", "origin", "capabilities", "description", "health", "versions", "runs"].sort());
    expect(app).toMatchObject({ description: f.manifest.description, capabilities: { configure: false }, health: { runtime: { state: "unobserved", pid: null }, incident: null, open: false } });
    expect(app.health).not.toHaveProperty("readiness"); expect(app.health).not.toHaveProperty("healthCheck");
    expect(app.versions.map(version => version.hash)).toEqual([7, 6, 5, 4, 3].map(i => `candidate-${i}`));
    expect(app.runs.map(run => run.createdAt.getTime())).toEqual([7000, 6000, 5000, 4000, 3000]);
    for (const version of app.versions) {
      expect(Object.keys(version).sort()).toEqual(["hash", "status", "createdAt", "errors", "git"].sort());
      expect(version.git).toEqual(git); expect(version.errors).toHaveLength(5);
      expect(version.errors!.every(error => error.length <= 300)).toBe(true);
    }
    expect(app.runs.every(run => run.error!.length <= 1000)).toBe(true);
    const serialized = JSON.stringify(app);
    for (const hidden of [secret, "private-candidate", "private-run", "private-build-stderr", "storePaths", "workspaceId", "dataSchema", "manifest", "intent", "report", "output"]) expect(serialized).not.toContain(hidden);
    expect([await f.db.moduleVersion.count(), await f.db.moduleRun.count(), await f.db.audit.count()]).toEqual(before);
    for (const docs of [MODULE_DIAGNOSTICS_DOCUMENTATION, MODULE_HEALTH_DOCUMENTATION]) {
      expect(docs).not.toContain("healthCheck"); expect(docs).not.toContain("module-reported readiness");
    }
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test("unversioned and invalid active manifests remain visible without configuration or readiness inference", async () => {
  const f = await fixture();
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.module.id, hash: "active" } }, data: { manifest: { ...f.manifest, settings: { secret: "private" } }, report: { errors: [42], git: { commit: "invalid", tree: "invalid" } } } });
  await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "draft", status: "paused" } });
  const apps = await createApps(f.ports, f.workspaceId).list();
  expect(apps.every(app => app.description === null && app.capabilities.configure === false)).toBe(true);
  const list = await createModules(f.ports, f.workspaceId).list();
  expect(list.find(app => app.name === "example")).toMatchObject({ description: null, versions: [{ errors: null, git: null }] });
  expect(list.find(app => app.name === "draft")).toMatchObject({ activeHash: null, description: null, health: { runtime: { state: "paused", pid: null } }, versions: [], runs: [] });
});

test("modules.list metadata integrates with its declared routed output schema", async () => {
  const f = await fixture(); registerSystemModules();
  const expected = JSON.parse(JSON.stringify(await createModules(f.ports, f.workspaceId).list()));
  expect(modulesListOutput.parse(expected)).toEqual(expected);
  const result = await callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.list", {});
  expect(result.output).toEqual({ items: expected, nextCursor: null });
});
