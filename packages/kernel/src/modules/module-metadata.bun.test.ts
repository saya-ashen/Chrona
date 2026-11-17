import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createModules } from "./modules";
import { listSystemModules } from "./module-calls";
import { modulesListOutput } from "../system/system-outputs";
import { registerSystemModules } from "../system/system-modules";
import { callSync } from "./module-calls";
import type { StewardPorts } from "../ports";
import { testDb } from "../__testing__/test-db";

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
  const app = (await createModules(f.ports, f.workspaceId).list())[0]!;
  expect(app).toMatchObject({ id: f.module.id, name: "example", description: f.manifest.description, status: "active", activeHash: "active", origin: "external", capabilities: { configure: false } });
  const described = await callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.describe", { target: { moduleId: f.module.id, tool: "settings" } });
  expect(described.output).toMatchObject({ target: { moduleId: f.module.id, tool: "settings" }, label: "example.settings", admission: { visibility: ["owner"] } });
  const internal = listSystemModules();
  for (const host of ["runtime-callback", "workspace-local", "content-local"]) expect(internal.map(item => item.name)).not.toContain(host);
  for (const removed of ["settings", "contributes", "healthCheck", "triggers"]) {
    expect(moduleManifestSchema.safeParse({ ...f.manifest, [removed]: removed === "healthCheck" ? true : {} }).success).toBe(false);
  }
});

test("modules list bounds history, retains the older active description and projects only observed metadata", async () => {
  const f = await fixture();
  const key = "CHRONA_METADATA_TEST_TOKEN", previous = process.env[key], secret = "synthetic-metadata-credential";
  process.env[key] = secret;
  try {
    for (let i = 1; i <= 7; i++) {
      await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: `candidate-${i}`, manifest: { ...f.manifest, description: "Unactivated description" }, source: "build", status: "rejected",
        intent: { storePaths: ["private-intent-path"] }, report: { errors: Array.from({ length: 9 }, () => "x".repeat(290) + secret + " token=private-candidate " + "x".repeat(1000)), storePaths: ["private-report-path"], tests: [{ stderr: "private-build-stderr" }] }, createdAt: new Date(i * 1000) } });
      await f.db.moduleRun.create({ data: { moduleId: f.module.id, hash: "active", triggerId: "tool:read", firedAt: new Date(i * 1000), exitCode: 1,
        error: `${secret} password=private-run ` + "x".repeat(3000), output: { private: "private-run-output" }, createdAt: new Date(i * 1000) } });
    }
    const other = await f.db.workspace.create({ data: { name: "other-metadata" } });
    await f.db.module.create({ data: { workspaceId: other.id, name: "foreign" } });
    const before = [await f.db.moduleVersion.count(), await f.db.moduleRun.count(), await f.db.audit.count()];
    const list = await createModules(f.ports, f.workspaceId).list();
    expect(list).toHaveLength(1);
    const app = list[0]!;
    expect(Object.keys(app).sort()).toEqual(["id", "name", "status", "activeHash", "origin", "capabilities", "description", "health", "versions", "runs"].sort());
    expect(app).toMatchObject({ description: f.manifest.description, capabilities: { configure: false }, health: { runtime: { state: "unobserved", pid: null }, incident: null, open: false } });
    expect(app.health).not.toHaveProperty("readiness"); expect(app.health).not.toHaveProperty("healthCheck");
    expect(app.versions.map(version => version.hash)).toEqual([7, 6, 5, 4, 3].map(i => `candidate-${i}`));
    expect(app.runs.map(run => run.createdAt.getTime())).toEqual([7000, 6000, 5000, 4000, 3000]);
    for (const version of app.versions) {
      expect(Object.keys(version).sort()).toEqual(["hash", "status", "createdAt", "errors"].sort());
      expect(version.errors).toHaveLength(5);
      expect(version.errors!.every(error => error.length <= 300)).toBe(true);
    }
    expect(app.runs.every(run => run.error!.length <= 1000)).toBe(true);
    const serialized = JSON.stringify(app);
    for (const hidden of [secret, "private-candidate", "private-run", "private-build-stderr", "storePaths", "workspaceId", "dataSchema", "manifest", "intent", "report", "output"]) expect(serialized).not.toContain(hidden);
    expect([await f.db.moduleVersion.count(), await f.db.moduleRun.count(), await f.db.audit.count()]).toEqual(before);
    for (const docs of listSystemModules().find(module => module.name === "modules")!.tools.map(tool => tool.description)) {
      expect(docs).not.toContain("healthCheck"); expect(docs).not.toContain("module-reported readiness");
    }
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test.each(["check", "migration"] as const)("modules.list exposes bounded rejected %s failure without raw reports", async phase => {
  const f = await fixture(), key = "CHRONA_BUILD_DIAGNOSTIC_TOKEN", previous = process.env[key], secret = "synthetic-build-diagnostic-secret";
  process.env[key] = secret;
  try {
    const message = `Cannot use test outside of the test runner. token=${secret}`;
    const output = {stdout: "", stderr: "source preview ".repeat(100) + message, exitCode: 1};
    const report = phase === "migration" ? { tests: [], migration: output } : { tests: [], errors: [message] };
    await f.db.moduleVersion.create({data: {moduleId: f.module.id, hash: "rejected-check", manifest: f.manifest, source: "build", status: "rejected", intent: {}, report, createdAt: new Date(1000)}});
    const app = (await createModules(f.ports, f.workspaceId).list())[0]!;
    expect(app.versions[0]!.errors?.[0]).toContain("Cannot use test outside of the test runner");
    expect(app.versions[0]!.errors!.every(error => error.length <= 300 && !error.includes(secret))).toBe(true);
    expect(app.versions[1]!.errors).toBeNull();
    expect(app.versions[0]).not.toHaveProperty("report");
    expect(modulesListOutput.parse(JSON.parse(JSON.stringify([app])))).toHaveLength(1);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test("unversioned and invalid active manifests remain visible without configuration or readiness inference", async () => {
  const f = await fixture();
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.module.id, hash: "active" } }, data: { manifest: { ...f.manifest, settings: { secret: "private" } }, report: { errors: [42] } } });
  await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "draft", status: "paused" } });
  const apps = await createModules(f.ports, f.workspaceId).list();
  expect(apps.every(app => app.description === null && app.capabilities.configure === false)).toBe(true);
  const list = await createModules(f.ports, f.workspaceId).list();
  expect(list.find(app => app.name === "example")).toMatchObject({ description: null, versions: [{ errors: null }] });
  expect(list.find(app => app.name === "draft")).toMatchObject({ activeHash: null, description: null, health: { runtime: { state: "paused", pid: null } }, versions: [], runs: [] });
});

test("modules.list metadata integrates with its declared routed output schema", async () => {
  const f = await fixture(); registerSystemModules();
  const expected = JSON.parse(JSON.stringify(await createModules(f.ports, f.workspaceId).list()));
  expect(modulesListOutput.parse(expected)).toEqual(expected);
  const result = await callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.list", {});
  expect(result.output).toEqual({ items: expected, nextCursor: null });
});
