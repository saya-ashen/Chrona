import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, MODULE_OPERATIONS, PREINSTALLED_MODULE_NAMES, moduleManifestSchema, moduleInstallRequestSchema, modulePackageCatalogSchema } from "@chrona/contracts/steward";
import { assertExternalName, assertExternalModule, assertModuleOperation, moduleIdentity } from "./module-identity";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { installExternal, recordInstallationResult, externalPackageCatalog } from "./module-install";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { moduleLifecycleFixtures as fixtures } from "./module-lifecycle.fixtures";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createModules } from "./modules";
import { createApprovals } from "./approvals";
import { createRuns, createRunSession } from "./runs";
import { createTick } from "./tick";
import { createApps } from "./apps";
import { createStewardService } from "./service";
import { moduleOverview, modulePermissions } from "./module-overview";
import { createSecrets } from "./secrets";
import { callSync, enqueueCall, kernelOrigin, moduleCallbackContractHash, runDueCalls } from "./module-calls";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-p0-")), db = testDb();
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "p0" } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T00:00:00Z"), publicUrl: null, moduleBuiltinResources: join(dataDir, "builtin"), moduleExternalResources: join(dataDir, "external") };
  for (const [root, names] of [[ports.moduleBuiltinResources!, BUILTIN_MODULE_NAMES], [ports.moduleExternalResources!, [...PREINSTALLED_MODULE_NAMES, "memory-local"]]] as const) {
    for (const name of names) {
      const dir = join(root, name); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], triggers: [] })));
      await writeFile(join(dir, "index.ts"), "// synthetic, never executed\n");
      await writeFile(join(dir, "test.ts"), "// synthetic author test\n");
    }
  }
  return { ports, db, workspaceId: workspace.id, dataDir };
}

test("identity is a database fact; operation matrix rejects immutable and forged identities", async () => {
  const f = await fixture();
  for (const operation of MODULE_OPERATIONS) {
    if (["enable", "disable", "configure", "diagnose"].includes(operation)) expect(() => assertModuleOperation(fixtures.builtin.row, operation)).not.toThrow();
    else expect(() => assertModuleOperation(fixtures.builtin.row, operation)).toThrow("Built-in");
    expect(() => assertModuleOperation(fixtures.external.row, operation)).not.toThrow();
    expect(() => assertModuleOperation(fixtures.forgedRow, operation)).toThrow("reserved identity");
  }
  for (const name of [...KERNEL_MODULE_NAMES, ...BUILTIN_MODULE_NAMES, "rescue"]) {
    await expect(assertExternalName(f.db, f.workspaceId, name, "propose")).rejects.toMatchObject({ code: "forbidden", reason: "reserved_module_name" });
  }
  expect(moduleManifestSchema.safeParse(fixtures.forgedManifest).success).toBe(false);
  expect(moduleIdentity({ name: "qq", builtin: false }).origin).toBe("external");
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha" } });
  await f.db.module.update({ where: { id: row.id }, data: { builtin: true } });
  await expect(f.db.$transaction(tx => assertExternalModule(tx, f.workspaceId, row.id, "activate"))).rejects.toMatchObject({ reason: "immutable_module" });
});

test("trusted release binds manifest and exact code hash; missing, drift, mismatches and symlinks fail closed", async () => {
  const f = await fixture(), release = await resolveBuiltinRelease(f.ports, "web");
  expect(release).toMatchObject({ name: "web", origin: "builtin", codeDir: join(f.ports.moduleBuiltinResources!, "web") });
  expect(release.hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await resolveExternalRelease(f.ports, "qq")).origin).toBe("external");
  await expect(resolveBuiltinRelease(f.ports, "../qq")).rejects.toMatchObject({ reason: "release_not_found" });
  await expect(resolveBuiltinRelease({}, "web")).rejects.toMatchObject({ reason: "release_not_found" });
  await writeFile(join(release.codeDir, "index.ts"), "changed\n");
  await expect(resolveBuiltinRelease(f.ports, "web", release.hash)).rejects.toMatchObject({ reason: "release_drift" });
  await symlink(join(release.codeDir, "index.ts"), join(release.codeDir, "leak.ts"));
  await expect(resolveBuiltinRelease(f.ports, "web")).rejects.toMatchObject({ code: "forbidden" });
  await writeFile(join(f.ports.moduleExternalResources!, "qq/module.json"), JSON.stringify(fixtures.external.manifest));
  await expect(resolveExternalRelease(f.ports, "qq")).rejects.toMatchObject({ reason: "invalid_release" });
});

test("install is bounded, idempotent and explicit; uncertain receipts do not execute twice", async () => {
  const f = await fixture(); let calls = 0;
  f.ports.moduleExternalInstaller = async ({ request, release }) => {
    calls++;
    return { package: request.package, requestKey: request.requestKey, status: "building", moduleId: null, hash: release.hash, approvalId: null, error: null };
  };
  const first = await installExternal(f.ports, f.workspaceId, fixtures.install);
  expect(first.status).toBe("building");
  expect(await installExternal(f.ports, f.workspaceId, fixtures.install)).toEqual(first);
  expect(calls).toBe(1);
  await expect(installExternal(f.ports, f.workspaceId, { ...fixtures.install, package: "mind" })).rejects.toMatchObject({ code: "conflict" });
  await recordInstallationResult(f.ports, f.workspaceId, { ...first, status: "failed", error: fixtures.failedInstall.error });
  expect((await installExternal(f.ports, f.workspaceId, fixtures.install)).status).toBe("failed");
  expect(calls).toBe(1);
  expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, dir: "/private" }).success).toBe(false);
  expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, package: "web" }).success).toBe(false);
  expect(modulePackageCatalogSchema.parse(await externalPackageCatalog(f.ports, f.workspaceId)).map(item => item.name)).toEqual(["qq", "remind", "mind", "memory-local", "coding", "editor"]);
  // Other packages' history cannot push this package out of a global latest-N window.
  for (let i = 0; i < 205; i++) await f.db.audit.create({ data: { workspaceId: f.workspaceId, actorKey: "kernel", kind: "module_installation", details: { request: { package: "mind", mode: "install", requestKey: `noise-${i}` }, result: { ...fixtures.failedInstall, package: "mind", requestKey: `noise-${i}` } } } });
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "qq")?.installation).toMatchObject({ requestKey: fixtures.install.requestKey, status: "failed" });
  const unavailable = await installExternal({ ...f.ports, moduleExternalInstaller: undefined }, f.workspaceId, { package: "mind", mode: "install", requestKey: "no-adapter" });
  expect(unavailable).toMatchObject({ status: "unavailable", error: { reason: "installer_unavailable" } });
});

test("initialization persists once, serializes concurrent starts and never resurrects a deleted preinstall", async () => {
  const f = await fixture(); let calls = 0;
  f.ports.moduleExternalInstaller = async ({ request, release }) => {
    calls++;
    const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: request.package } });
    return { package: request.package, requestKey: request.requestKey, status: "installed", moduleId: row.id, hash: release.hash, approvalId: null, error: null };
  };
  const [a, b] = await Promise.all([ensureWorkspaceInitialized(f.ports, f.workspaceId), ensureWorkspaceInitialized(f.ports, f.workspaceId)]);
  expect(a).toEqual(b); expect(a.status).toBe("complete"); expect(calls).toBe(3);
  await f.db.module.deleteMany({ where: { workspaceId: f.workspaceId, name: "qq" } });
  expect((await ensureWorkspaceInitialized({ ...f.ports }, f.workspaceId)).status).toBe("complete");
  expect(calls).toBe(3);
  expect(await f.db.module.count({ where: { workspaceId: f.workspaceId, name: "qq" } })).toBe(0);
  expect(await f.db.module.count({ where: { workspaceId: f.workspaceId, name: "memory-local" } })).toBe(0);
});

test("failed initialization requires explicit retry; interrupted requests keep the original identity", async () => {
  const f = await fixture(); let calls = 0;
  f.ports.moduleExternalInstaller = async ({ request, release }) => { calls++; return { ...fixtures.failedInstall, package: request.package, requestKey: request.requestKey, hash: release.hash }; };
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(first.status).toBe("pending"); expect(calls).toBe(3);
  await ensureWorkspaceInitialized(f.ports, f.workspaceId); expect(calls).toBe(3);
  const retry = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(calls).toBe(6); expect(retry.packages.qq.attempts).toBe(2);
  const waiting = await installExternal({ ...f.ports, moduleExternalInstaller: async ({ request }) => { calls++; return { ...fixtures.unknownInstall, package: request.package, requestKey: request.requestKey }; } }, f.workspaceId, { package: "qq", mode: "install", requestKey: "interrupted" });
  expect(waiting.status).toBe("pending");
  await installExternal(f.ports, f.workspaceId, { package: "qq", mode: "install", requestKey: "interrupted" }); expect(calls).toBe(7);
});

test("queued callbacks cannot switch to a same-name reinstall or a changed tool contract", async () => {
  for (const change of ["reinstall", "contract"] as const) {
    const f = await fixture(); let starts = 0;
    f.ports.sandbox = { available: true, isolated: false, startModule() { starts++; throw new Error("Callback must be refused before execution"); } };
    const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, tools: [{ name: "receive", description: "Fixture", parameters: { type: "object", properties: {}, required: [] }, visibility: ["kernel"], idempotent: true }] });
    const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: "a".repeat(64) } });
    await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, status: "approved", source: "user", manifest, intent: {}, report: {} } });
    const call = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspaceId), target: "alpha.receive", raw: {} }, { key: "callback-one" });
    expect(await f.db.audit.findUnique({ where: { id: `module-invocation-target:${call.callId}` } })).toMatchObject({ details: { moduleId: row.id, contractHash: moduleCallbackContractHash(manifest.tools[0]!) } });
    if (change === "reinstall") {
      await f.db.module.delete({ where: { id: row.id } });
      const replacement = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: row.activeHash } });
      await f.db.moduleVersion.create({ data: { moduleId: replacement.id, hash: row.activeHash!, status: "approved", source: "user", manifest, intent: {}, report: {} } });
    } else {
      manifest.tools[0]!.output = { type: "number" };
      await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: row.activeHash! } }, data: { manifest } });
    }
    await runDueCalls(f.ports, f.workspaceId);
    expect(await f.db.moduleInvocation.findUnique({ where: { id: call.callId } })).toMatchObject({ status: "failed", error: expect.stringContaining("target identity or contract changed") });
    expect(starts).toBe(0);
  }
});

test("credential readiness projects generic adapter and saved metadata without treating installation as readiness", async () => {
  const f = await fixture();
  const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, secrets: [{ name: "test_credential", label: "Fixture", fields: [{ name: "token", label: "Token" }] }] });
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: "a".repeat(64) } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, status: "approved", source: "user", intent: {}, report: {} } });
  const permissions = () => modulePermissions(f.ports, f.workspaceId, "alpha") as Promise<{ secrets: { name: string; configured: boolean; fields: { saved: boolean }[] }[] }>;
  expect((await permissions()).secrets[0]).toMatchObject({ name: "test_credential", configured: false });
  f.ports.secretConfigured = async name => name === "test_credential";
  expect((await permissions()).secrets[0]).toMatchObject({ configured: true, fields: [{ saved: false }] });
  f.ports.secretConfigured = async () => false;
  await createSecrets(f.dataDir).write("test_credential", { token: "synthetic-test-only" });
  const projected = await permissions();
  expect(projected.secrets[0]).toMatchObject({ configured: true, fields: [{ saved: true }] });
  expect(JSON.stringify(projected)).not.toContain("synthetic-test-only");
});

test("build claim refuses changed identities and continues to a valid queued build before Provider start", async () => {
  const f = await fixture(), starts: string[] = [];
  f.ports.provider = { name: "fake", async health() { return { available: true, sandboxed: false, error: null }; }, start(input) {
    starts.push(input.runId);
    return { async inject() {}, async abort() {}, done: Promise.resolve({ outcome: "finished" as const, sessionId: null, error: null }) };
  } };
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", builtin: false } });
  const runs = createRuns(f.ports, f.workspaceId), queued: string[] = [];
  for (const name of ["alpha", "beta"]) {
    const session = await createRunSession(f.db, f.workspaceId, "build", f.ports.now());
    queued.push((await runs.enqueue({ sessionId: session.id, lane: "build", trigger: "source", prompt: "Synthetic build", label: name })).id);
    await f.db.audit.create({ data: { workspaceId: f.workspaceId, actorKey: "kernel", kind: "build_request", subjectId: session.id, details: { name } } });
  }
  await f.db.module.update({ where: { id: module.id }, data: { builtin: true } });
  const tick = createTick(f.ports);
  await tick(); await tick.settled({ includeRuns: true });
  expect(starts).toEqual([queued[1]!]);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: queued[0]! } })).toMatchObject({ status: "failed", startedAt: null, error: expect.stringContaining("Built-in") });
  await tick(); await tick.settled({ includeRuns: true });
  expect(starts).toEqual([queued[1]!]);
});

test("approval creation transaction refuses immutable single, grouped and removal requests without records", async () => {
  const f = await fixture();
  const approvals = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const builtin = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "web", builtin: true, activeHash: "a".repeat(64) } });
  const external = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: "b".repeat(64) } });
  for (const module of [builtin, external]) await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, source: "user", status: "approved", manifest: module.builtin ? fixtures.builtin.manifest : fixtures.external.manifest, intent: {}, report: {} } });
  const common = { title: "Fixture", detail: "", preview: "" };
  for (const request of [
    { ...common, action: "activate_module", moduleId: builtin.id, payload: { kind: "activate_module", moduleId: builtin.id, hash: builtin.activeHash } },
    { ...common, action: "activate_module", payload: { kind: "activate_modules", versions: [{ moduleId: external.id, hash: external.activeHash }, { moduleId: builtin.id, hash: builtin.activeHash }] } },
    { ...common, action: "delete_data", payload: { kind: "module_remove", moduleId: builtin.id, name: builtin.name, hash: builtin.activeHash } },
  ]) await expect(approvals.create(request)).rejects.toMatchObject({ reason: "immutable_module" });
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "approval_created" } })).toBe(0);
  const allowed = await approvals.create({ ...common, action: "activate_module", moduleId: external.id, payload: { kind: "activate_module", moduleId: external.id, hash: external.activeHash } });
  expect(allowed.status).toBe("open");
});

test("list, overview and kernel projections share lifecycle identity without overwriting permission descriptions", async () => {
  const f = await fixture(); createStewardService(f.ports);
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "web", builtin: true, activeHash: "a".repeat(64) } });
  await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, source: "user", status: "approved", manifest: fixtures.builtin.manifest, intent: {}, report: {} } });
  const [list] = await createModules(f.ports, f.workspaceId).list();
  expect(list).toMatchObject({ origin: "builtin", capabilities: { build: false, rollback: false, remove: false } });
  expect((await createApps(f.ports, f.workspaceId).list())[0]!.origin).toBe("builtin");
  const overview = await moduleOverview(f.ports, f.workspaceId, "web") as { app: { origin: string }; permissions: { capabilities: unknown } };
  expect(overview.app.origin).toBe("builtin"); expect(Array.isArray(overview.permissions.capabilities)).toBe(true);
  expect(await moduleOverview(f.ports, f.workspaceId, "modules")).toMatchObject({ origin: "kernel", capabilities: { build: false } });
  const catalog = modulePackageCatalogSchema.parse((await callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.catalog", {})).output);
  expect(catalog.map(item => item.name)).toEqual(["qq", "remind", "mind", "memory-local", "coding", "editor"]);
});
