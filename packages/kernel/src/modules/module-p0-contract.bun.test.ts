import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";


import { tmpdir } from "node:os";
import { join } from "node:path";
import { KERNEL_MODULE_NAMES, MODULE_OPERATIONS, moduleManifestSchema, moduleInstallRequestSchema } from "@chrona/contracts/steward";
import { assertExternalName, assertExternalModule, assertModuleOperation, moduleIdentity } from "./module-identity";
import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { resolveExternalRelease } from "./module-release";
import { installExternal, recordInstallationResult, externalPackageCatalog } from "./module-install";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import { createModules } from "./modules";
import { createApprovals } from "../approvals";
import { createStewardService } from "../runtime/service";
import { secrets } from "../system/secrets";
import { createSecrets } from "../secrets/secrets";
import { callSync, enqueueCall, kernelOrigin, runDueCalls } from "./module-calls";

import { moduleLifecycleFixtures as fixtures } from "./module-lifecycle.fixtures";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "../__testing__/module-test-process";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-p0-")), db = testDb({ injectedAgent: false });
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "p0" } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T00:00:00Z"), publicUrl: null, moduleExternalResources: join(dataDir, "external") };
  for (const [root, names] of [[ports.moduleExternalResources!, ["fixture-backend", "fixture-entry", "fixture-notifier", "pi", "qq"]]] as const) {
    for (const name of names) {
      const dir = join(root, name); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] })));
      await writeFile(join(dir, "index.ts"), "// synthetic, never executed\n");
      await writeFile(join(dir, "test.ts"), "// synthetic author test\n");
      await seedTestModuleRelease(root, name);
    }
  }
  return { ports, db, workspaceId: workspace.id, dataDir };
}

test("kernel Agent rejects persisted impostors; Pi retains ordinary lifecycle rights", async () => {
  const f = await fixture();
  for (const operation of MODULE_OPERATIONS) {
    for (const name of [...KERNEL_MODULE_NAMES]) {
      expect(() => assertModuleOperation({ name }, operation)).toThrow("reserved identity");
    }
    expect(() => assertModuleOperation(fixtures.pi.row, operation)).not.toThrow();
    expect(() => assertModuleOperation(fixtures.external.row, operation)).not.toThrow();
    expect(() => assertModuleOperation(fixtures.forgedRow, operation)).toThrow("reserved identity");
  }
  for (const name of [...KERNEL_MODULE_NAMES]) {
    await expect(assertExternalName(f.db, f.workspaceId, name, "propose")).rejects.toMatchObject({ code: "forbidden", reason: "reserved_module_name" });
  }
  expect(moduleManifestSchema.safeParse(fixtures.forgedManifest).success).toBe(false);
  expect(moduleIdentity({ name: "qq" }).origin).toBe("external");
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha" } });
  await f.db.module.update({ where: { id: row.id }, data: { name: "agent" } });
  await expect(f.db.$transaction(tx => assertExternalModule(tx, f.workspaceId, row.id, "activate"))).rejects.toMatchObject({ reason: "module_identity_conflict" });
});

test("trusted release binds manifest and exact code hash; missing, drift, mismatches and symlinks fail closed", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "pi");
  expect(release).toMatchObject({ name: "pi", origin: "external", codeDir: join(f.ports.moduleExternalResources!, "pi") });
  expect(release.hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await resolveExternalRelease(f.ports, "qq")).origin).toBe("external");
  await expect(resolveExternalRelease(f.ports, "../pi")).rejects.toMatchObject({ reason: "release_not_found" });
  await expect(resolveExternalRelease({ moduleExternalResources: join(f.dataDir, "missing") }, "pi")).rejects.toMatchObject({ reason: "release_not_found" });
  await writeFile(join(release.codeDir, "index.ts"), "changed\n");
  await expect(resolveExternalRelease(f.ports, "pi", release.hash)).rejects.toMatchObject({ reason: "release_drift" });
  await symlink(join(release.codeDir, "index.ts"), join(release.codeDir, "leak.ts"));
  await expect(resolveExternalRelease(f.ports, "pi")).rejects.toMatchObject({ code: "forbidden" });
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
  await expect(installExternal(f.ports, f.workspaceId, { ...fixtures.install, package: "notify" })).rejects.toMatchObject({ code: "conflict" });
  await recordInstallationResult(f.ports, f.workspaceId, { ...first, status: "failed", error: fixtures.failedInstall.error });
  expect((await installExternal(f.ports, f.workspaceId, fixtures.install)).status).toBe("failed");
  expect(calls).toBe(1);
  expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, dir: "/private" }).success).toBe(false);
  expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, package: "custom-entry" }).success).toBe(true);
  for (const name of ["../escape", "Uppercase"]) expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, package: name }).success).toBe(false);
  expect(new Set((await externalPackageCatalog(f.ports, f.workspaceId)).map(item => item.name))).toEqual(new Set(["fixture-backend", "fixture-entry", "fixture-notifier", "pi", "qq"]));
  // Other packages' history cannot push this package out of a global latest-N window.
  await f.db.moduleInstallation.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ id: `noise-${i}`, workspaceId: f.workspaceId, package: "mind", mode: "install", requestKey: `noise-${i}`, status: "failed" })) });
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "qq")?.installation).toMatchObject({ requestKey: fixtures.install.requestKey, status: "failed" });
  const unavailable = await installExternal({ ...f.ports, moduleExternalInstaller: undefined }, f.workspaceId, { package: "fixture-notifier", mode: "install", requestKey: "no-adapter" });
  expect(unavailable).toMatchObject({ status: "unavailable", error: { reason: "installer_unavailable" } });
});

test("queued callbacks reject same-name reinstalls and invalid arguments but survive tool contract changes", async () => {
  for (const change of ["reinstall", "contract", "arguments"] as const) {
    const f = await fixture(); let starts = 0;
    const peer = testModuleProcess(async event => { if (event.trigger.kind !== "tool") return {}; starts++; return { result: 42 }; });
    f.ports.sandbox = { available: true, isolated: false, startModule: peer.startModule };
    const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, tools: [{ name: "receive", description: "Fixture", parameters: { type: "object", properties: {}, required: [] }, visibility: ["kernel"], idempotent: true,
        output: {}
    }] });
    const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: "a".repeat(64) } });
    await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, status: "approved", source: "user", manifest, intent: {}, report: {} } });
    const call = await enqueueCall({ tx: f.db, ports: f.ports, origin: kernelOrigin(f.workspaceId), target: "alpha.receive", raw: {} }, { key: "callback-one" });
    expect(await f.db.moduleInvocation.findUnique({ where: { id: call.callId } })).toMatchObject({ targetModuleId: row.id, targetContractHash: null });
    if (change === "reinstall") {
      await f.db.module.delete({ where: { id: row.id } });
      const replacement = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: row.activeHash } });
      await f.db.moduleVersion.create({ data: { moduleId: replacement.id, hash: row.activeHash!, status: "approved", source: "user", manifest, intent: {}, report: {} } });
    } else {
      manifest.tools[0]!.description = "Updated callback description";
      manifest.tools[0]!.output = { type: "number" };
      if (change === "arguments") manifest.tools[0]!.parameters = { type: "object", properties: { value: { type: "string" } }, required: ["value"] };
      await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: row.activeHash! } }, data: { manifest } });
    }
    await runDueCalls(f.ports, f.workspaceId);
    const result = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: call.callId } });
    if (change === "contract") expect(result).toMatchObject({ status: "succeeded", output: 42, error: null, targetModuleId: row.id, targetContractHash: null });
    else expect(result).toMatchObject({ status: "failed", error: expect.stringContaining(change === "reinstall" ? "conflict: queued callback target identity" : "Invalid tool arguments:") });
    if (change === "arguments") await expect(callSync(f.ports, kernelOrigin(f.workspaceId), "alpha.receive", {})).rejects.toMatchObject({ code: "invalid" });
    expect(starts).toBe(change === "contract" ? 1 : 0);
  }
});

test("credential list exposes saved and adapter metadata without values or readiness claims", async () => {
  const f = await fixture();
  const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, secrets: [{ name: "test_credential", label: "Fixture", fields: [{ name: "token", label: "Token" }] }] });
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "alpha", activeHash: "a".repeat(64) } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, status: "approved", source: "user", intent: {}, report: {} } });
  const credentials = () => secrets.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: { kind: "owner", via: null } }, "list", {}) as Promise<{ items: { name: string; configured: boolean; updatedAt: string | null }[] }>;
  expect((await credentials()).items[0]).toMatchObject({ name: "test_credential", configured: false, updatedAt: null });
  f.ports.secretConfigured = async name => name === "test_credential";
  expect((await credentials()).items[0]).toMatchObject({ configured: true, updatedAt: null });
  f.ports.secretConfigured = async () => false;
  await createSecrets(f.dataDir).write("test_credential", { token: "synthetic-test-only" });
  const projected = await credentials();
  expect(projected.items[0]).toMatchObject({ configured: true, updatedAt: expect.any(String) });
  expect(projected.items[0]).not.toHaveProperty("readiness");
  expect(JSON.stringify(projected)).not.toContain("synthetic-test-only");
});

test("approval creation refuses reserved kernel identities without records and permits ordinary Pi", async () => {
  const f = await fixture(), approvals = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const pi = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "pi", activeHash: fixtures.pi.row.activeHash } });
  await f.db.moduleVersion.create({ data: { moduleId: pi.id, hash: pi.activeHash!, source: "user", status: "approved", manifest: fixtures.pi.manifest, intent: {}, report: {} } });
  const common = { title: "Fixture", detail: "", preview: "" };
  for (const name of ["agent", "modules"]) {
    const invalid = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: "c".repeat(64) } });
    await f.db.moduleVersion.create({ data: { moduleId: invalid.id, hash: invalid.activeHash!, source: "user", status: "approved", manifest: { ...fixtures.external.manifest, name }, intent: {}, report: {} } });
    for (const request of [
        { ...common, action: "delete_data", payload: { kind: "module_remove", moduleId: invalid.id, name, hash: invalid.activeHash } },
        { ...common, action: "activate_module", moduleId: invalid.id, payload: { kind: "activate_module", moduleId: invalid.id, hash: invalid.activeHash } },
    ]) await expect(approvals.create(request)).rejects.toMatchObject({ reason: "module_identity_conflict" });
  }
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "approval_created" } })).toBe(0);
  const allowed = await approvals.create({ ...common, action: "activate_module", moduleId: pi.id, payload: { kind: "activate_module", moduleId: pi.id, hash: pi.activeHash } });
  expect(allowed.status).toBe("open");
  expect((await approvals.create({ ...common, action: "delete_data", payload: { kind: "module_remove", moduleId: pi.id, name: pi.name, hash: pi.activeHash } })).status).toBe("open");
});

test.each(["pi", "web", "notify", "other-entry"])("list exposes ordinary entry %s lifecycle rights", async name => {
  const f = await fixture(); createStewardService(f.ports);
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: "a".repeat(64) } });
  const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, name, uses: ["*"],
      authority: "owner"
});
  await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, source: "user", status: "approved", manifest, intent: {}, report: {} } });
  const [list] = await createModules(f.ports, f.workspaceId).list();
  expect(list).toMatchObject({ origin: "external", capabilities: { build: true, rollback: true, remove: true, install: false } });
  await expect(callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.catalog", {})).rejects.toMatchObject({ code: "not_found" });
  const catalog = await externalPackageCatalog(f.ports, f.workspaceId);
  expect(new Set(catalog.map(item => item.name))).toEqual(new Set(["fixture-backend", "fixture-entry", "fixture-notifier", "pi", "qq"]));
});
