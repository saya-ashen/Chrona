import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { type ProviderAdapter, BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, MODULE_OPERATIONS, PREINSTALLED_MODULE_NAMES, moduleManifestSchema, moduleInstallRequestSchema } from "@chrona/contracts/steward";
import { assertExternalName, assertExternalModule, assertModuleOperation, moduleIdentity } from "./module-identity";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { installExternal, recordInstallationResult, externalPackageCatalog } from "./module-install";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { createModules } from "./modules";
import { createApprovals } from "../approvals";
import { createApps } from "../apps";
import { createStewardService } from "../service";
import { modulePermissions } from "./module-overview";
import { moduleInterfaces } from "../system-apps";
import { createSecrets } from "../secrets";
import { callSync, enqueueCall, kernelOrigin, runDueCalls } from "./module-calls";

import { moduleLifecycleFixtures as fixtures } from "./module-lifecycle.fixtures";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { createPiOperations } from "../applications/pi/operations";
import { createBrowsers } from "../applications/pi/browser";
import { currentHostGeneration, hostStopped } from "../applications/pi/host-recovery";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-p0-")), db = testDb({ injectedAgent: false });
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "p0" } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T00:00:00Z"), publicUrl: null, moduleBuiltinResources: join(dataDir, "builtin"), moduleExternalResources: join(dataDir, "external") };
  for (const [root, names] of [[ports.moduleBuiltinResources!, BUILTIN_MODULE_NAMES], [ports.moduleExternalResources!, [...PREINSTALLED_MODULE_NAMES, "qq", "memory-local"]]] as const) {
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
    for (const name of [...KERNEL_MODULE_NAMES, "rescue"]) {
      for (const builtin of [false, true]) expect(() => assertModuleOperation({ name, builtin }, operation)).toThrow("reserved identity");
    }
    expect(() => assertModuleOperation(fixtures.pi.row, operation)).not.toThrow();
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
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "pi");
  expect(release).toMatchObject({ name: "pi", origin: "external", codeDir: join(f.ports.moduleExternalResources!, "pi") });
  await expect(resolveBuiltinRelease(f.ports, "agent")).rejects.toMatchObject({ reason: "release_not_found" });
  expect(release.hash).toMatch(/^[a-f0-9]{40}$/);
  expect(release.git?.commit).toBe(release.hash);
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
  expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, package: "web" }).success).toBe(true);
  for (const name of ["coding", "coding-web"]) expect(moduleInstallRequestSchema.safeParse({ ...fixtures.install, package: name }).success).toBe(false);
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).map(item => item.name)).toEqual(["pi", "web", "notify", "author", "mind", "chat", "qq", "memory-local", "mcp", "files", "events", "remind", "remote-execution"]);
  // Other packages' history cannot push this package out of a global latest-N window.
  await f.db.moduleInstallation.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ id: `noise-${i}`, workspaceId: f.workspaceId, package: "mind", mode: "install", requestKey: `noise-${i}`, status: "failed" })) });
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "qq")?.installation).toMatchObject({ requestKey: fixtures.install.requestKey, status: "failed" });
  const unavailable = await installExternal({ ...f.ports, moduleExternalInstaller: undefined }, f.workspaceId, { package: "notify", mode: "install", requestKey: "no-adapter" });
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
  expect(a).toEqual(b); expect(a.status).toBe("complete"); expect(calls).toBe(6);
  expect((await f.db.module.findMany({ orderBy: { name: "asc" }, select: { name: true } })).map(module => module.name)).toEqual(["author", "chat", "mind", "notify", "pi", "web"]);
  expect(Object.keys(a.packages)).not.toContain("qq");
  await f.db.module.deleteMany({ where: { workspaceId: f.workspaceId, name: "pi" } });
  expect((await ensureWorkspaceInitialized({ ...f.ports }, f.workspaceId)).status).toBe("complete");
  expect(calls).toBe(PREINSTALLED_MODULE_NAMES.length);
  expect(await f.db.module.count({ where: { workspaceId: f.workspaceId, name: "pi" } })).toBe(0);
  expect(await f.db.module.count({ where: { workspaceId: f.workspaceId, name: "memory-local" } })).toBe(0);
});

test("failed initialization requires explicit retry; interrupted requests keep the original identity", async () => {
  const f = await fixture(); let calls = 0;
  f.ports.moduleExternalInstaller = async ({ request, release }) => { calls++; return { ...fixtures.failedInstall, package: request.package, requestKey: request.requestKey, hash: release.hash }; };
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(first.status).toBe("pending"); expect(calls).toBe(PREINSTALLED_MODULE_NAMES.length);
  await ensureWorkspaceInitialized(f.ports, f.workspaceId); expect(calls).toBe(PREINSTALLED_MODULE_NAMES.length);
  const retry = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(calls).toBe(PREINSTALLED_MODULE_NAMES.length * 2); expect(retry.packages.chat.attempts).toBe(2);
  const waiting = await installExternal({ ...f.ports, moduleExternalInstaller: async ({ request }) => { calls++; return { ...fixtures.unknownInstall, package: request.package, requestKey: request.requestKey }; } }, f.workspaceId, { package: "qq", mode: "install", requestKey: "interrupted" });
  expect(waiting.status).toBe("pending");
  await installExternal(f.ports, f.workspaceId, { package: "qq", mode: "install", requestKey: "interrupted" }); expect(calls).toBe(PREINSTALLED_MODULE_NAMES.length * 2 + 1);
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

test("approval creation refuses reserved kernel identities without records and permits ordinary Pi", async () => {
  const f = await fixture(), approvals = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const pi = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "pi", activeHash: fixtures.pi.row.activeHash } });
  await f.db.moduleVersion.create({ data: { moduleId: pi.id, hash: pi.activeHash!, source: "user", status: "approved", manifest: fixtures.pi.manifest, intent: {}, report: {} } });
  const common = { title: "Fixture", detail: "", preview: "" };
  for (const name of ["agent", "modules"]) {
    const invalid = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: "c".repeat(64) } });
    await f.db.moduleVersion.create({ data: { moduleId: invalid.id, hash: invalid.activeHash!, source: "user", status: "approved", manifest: { ...fixtures.external.manifest, name }, intent: {}, report: {} } });
    for (const builtin of [false, true]) {
      await f.db.module.update({ where: { id: invalid.id }, data: { builtin } });
      for (const request of [
        { ...common, action: "delete_data", payload: { kind: "module_remove", moduleId: invalid.id, name, hash: invalid.activeHash } },
        { ...common, action: "activate_module", moduleId: invalid.id, payload: { kind: "activate_module", moduleId: invalid.id, hash: invalid.activeHash } },
        { ...common, action: "activate_module", payload: { kind: "activate_modules", versions: [{ moduleId: pi.id, hash: pi.activeHash }, { moduleId: invalid.id, hash: invalid.activeHash }] } },
      ]) await expect(approvals.create(request)).rejects.toMatchObject({ reason: "module_identity_conflict" });
    }
  }
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "approval_created" } })).toBe(0);
  const allowed = await approvals.create({ ...common, action: "activate_module", moduleId: pi.id, payload: { kind: "activate_module", moduleId: pi.id, hash: pi.activeHash } });
  expect(allowed.status).toBe("open");
  expect((await approvals.create({ ...common, action: "delete_data", payload: { kind: "module_remove", moduleId: pi.id, name: pi.name, hash: pi.activeHash } })).status).toBe("open");
});

test.each(["pi", "web", "notify", "other-entry"])("list and interface projections expose ordinary entry %s removal without overwriting permission descriptions", async name => {
  const f = await fixture(); createStewardService(f.ports);
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, builtin: false, activeHash: "a".repeat(64) } });
  const manifest = moduleManifestSchema.parse({ ...fixtures.external.manifest, name, uses: ["*"],
      authority: "owner"
});
  await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, source: "user", status: "approved", manifest, intent: {}, report: {} } });
  const [list] = await createModules(f.ports, f.workspaceId).list();
  expect(list).toMatchObject({ origin: "external", capabilities: { build: true, rollback: true, remove: true, install: false } });
  expect((await createApps(f.ports, f.workspaceId).list())[0]).toMatchObject({ origin: "external", capabilities: { remove: true } });
  expect(await moduleInterfaces(f.ports, f.workspaceId, name)).toMatchObject({ origin: "external", capabilities: { build: true, remove: true } });
  expect(Array.isArray((await modulePermissions(f.ports, f.workspaceId, name) as { capabilities: unknown }).capabilities)).toBe(true);
  expect(await moduleInterfaces(f.ports, f.workspaceId, "modules")).toMatchObject({ origin: "kernel", capabilities: { build: false } });
  await expect(callSync(f.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, "modules.catalog", {})).rejects.toMatchObject({ code: "not_found" });
  const catalog = await externalPackageCatalog(f.ports, f.workspaceId);
  expect(catalog.map(item => item.name)).toEqual(["pi", "web", "notify", "author", "mind", "chat", "qq", "memory-local", "mcp", "files", "events", "remind", "remote-execution"]);
});

describe("ordinary Pi browser discovery", () => {
  const cleanups: string[] = [];
  afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });
  async function temp() { const dir = await mkdtemp(join(tmpdir(), "chrona-browser-")); cleanups.push(dir); return dir; }
  const program = (name: string) => process.platform === "win32" ? `${name}.exe` : name;
  async function executable(path: string) { await writeFile(path, "browser fixture", { mode: 0o755 }); return realpathSync(path); }

  test("an explicit browser comes first, then host PATH with its native delimiter", async () => {
    const root = await temp(), bin = join(root, "bin"), empty = join(root, "empty");
    await mkdir(bin); await mkdir(empty);
    const onPath = await executable(join(bin, program("google-chrome"))), configured = await executable(join(root, program("my-chrome")));
    const path = [empty, bin].join(delimiter);
    const which = spyOn(Bun, "which");
    try {
      expect(createBrowsers({ configured, path }).find()).toBe(configured);
      expect(which).not.toHaveBeenCalled();
      expect(createBrowsers({ configured: join(root, "missing"), path }).find()).toBe(onPath);
      expect(createBrowsers({ path: empty }).find()).toBeNull();
    } finally { which.mockRestore(); }
  });

  test("missing browsers stay unavailable without acquisition, and an owner installation is found later", async () => {
    const root = await temp(), browsers = createBrowsers({ path: root });
    // Installed acquisition tools must not be invoked when no browser is present.
    await executable(join(root, program("nix")));
    await executable(join(root, program("unzip")));
    const fetcher = spyOn(globalThis, "fetch").mockImplementation((async () => { throw new Error("Unexpected browser download"); }) as unknown as typeof fetch);
    try {
      const before = await readdir(root);
      expect(browsers.ensure()).toBeNull();
      expect(browsers.ensure()).toBeNull();
      await Promise.resolve();
      expect(await readdir(root)).toEqual(before);
      expect(fetcher).not.toHaveBeenCalled();
      const browser = await executable(join(root, program("chromium")));
      expect(browsers.ensure()).toBe(browser);
    } finally { fetcher.mockRestore(); }
  });

  test("directories and non-executables are not browsers", async () => {
    const root = await temp(), bin = join(root, "bin");
    await mkdir(bin);
    expect(createBrowsers({ configured: root, path: bin }).ensure()).toBeNull();
    if (process.platform !== "win32") {
      const file = join(root, "plain-file");
      await writeFile(file, "", { mode: 0o600 });
      expect(createBrowsers({ configured: file, path: bin }).ensure()).toBeNull();
    }
  });
});

describe("ordinary Pi host stop evidence", () => {
  const generation = "a".repeat(64);
  const receipt = { version: 1, generation, state: "stopped", scope: "descendants", treeClean: true };
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "chrona-pi-host-receipt-"));
    await mkdir(join(root, ".host-stops"), { mode: 0o700 });
    return { root, path: join(root, ".host-stops", generation + ".json") };
  }

  test.skipIf(process.platform !== "linux")("Pi accepts only exact descendant stop evidence for the original generation", async () => {
    const { root, path } = await fixture();
    try {
      expect(await hostStopped(root, generation)).toBe(false);
      await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
      expect(await hostStopped(root, generation)).toBe(true);
      for (const invalid of [
        { ...receipt, version: 2 }, { ...receipt, generation: "b".repeat(64) },
        { ...receipt, state: "unknown" }, { ...receipt, scope: "process-group" },
        { ...receipt, treeClean: false }, { ...receipt, treeClean: "true" },
        { version: 1, generation }, null, "malformed JSON",
      ]) {
        await writeFile(path, invalid === "malformed JSON" ? "{" : JSON.stringify(invalid));
        expect(await hostStopped(root, generation)).toBe(false);
      }
      for (const invalid of ["", "../" + generation, "A".repeat(64), "a".repeat(63)]) {
        expect(await hostStopped(root, invalid)).toBe(false);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test.skipIf(process.platform !== "linux")("Pi rejects receipts with untrusted storage", async () => {
    const { root, path } = await fixture();
    try {
      await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
      await chmod(path, 0o644);
      expect(await hostStopped(root, generation)).toBe(false);
      await chmod(path, 0o600);
      const getuid = spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
      try { expect(await hostStopped(root, generation)).toBe(false); } finally { getuid.mockRestore(); }
      await link(path, join(root, "hardlink"));
      expect(await hostStopped(root, generation)).toBe(false);
      await rm(join(root, "hardlink"));
      await writeFile(path, JSON.stringify(receipt) + " ".repeat(512));
      expect(await hostStopped(root, generation)).toBe(false);
      await rm(path);
      await writeFile(join(root, "target"), JSON.stringify(receipt), { mode: 0o600 });
      await symlink(join(root, "target"), path);
      expect(await hostStopped(root, generation)).toBe(false);
      await rm(path);
      await mkdir(path, { mode: 0o700 });
      expect(await hostStopped(root, generation)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test.skipIf(process.platform !== "linux")("a receipt cannot confirm termination of the current Pi host", async () => {
    const { root, path } = await fixture(), previous = process.env.CHRONA_HOST_GENERATION;
    try {
      await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
      process.env.CHRONA_HOST_GENERATION = generation;
      expect(currentHostGeneration()).toBe(generation);
      expect(await hostStopped(root, generation)).toBe(false);
      process.env.CHRONA_HOST_GENERATION = "invalid";
      expect(currentHostGeneration()).toBeUndefined();
      expect(await hostStopped(root, generation)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CHRONA_HOST_GENERATION;
      else process.env.CHRONA_HOST_GENERATION = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ordinary Pi completion durability", () => {
  const args = { commandKey: "completion", prompt: "private prompt", maxOutputTokens: 200, timeoutMs: 5000 };
  async function setup(complete: NonNullable<ProviderAdapter["complete"]>) {
    const data = await mkdtemp(join(tmpdir(), "chrona-p0-pi-completion-"));
    cleanups.push(() => rm(data, { recursive: true, force: true }));
    const provider: ProviderAdapter = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; },
      start() { throw new Error("Unexpected conversational start"); }, complete };
    const prepare = async () => ({ provider, input: { ...args, model: "fixture/model" } });
    const operations = () => createPiOperations(data, async () => { throw new Error("Unexpected conversation preparation"); }, undefined, 64, prepare);
    return { data, operations };
  }
  async function settled(operations: ReturnType<typeof createPiOperations>) {
    const until = Date.now() + 2000;
    for (;;) {
      const status = await operations.control("status", { operationId: args.commandKey }) as { operationId: string; outcome: unknown; failure: boolean; completion?: unknown };
      if (status.outcome || status.failure) return status;
      if (Date.now() >= until) throw new Error("Completion receipt did not settle");
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  test("a bounded long completion is delivered whole and replayed after restart", async () => {
    const text = "ordinary result ".repeat(10_000); let launches = 0;
    const f = await setup(async () => { launches++; return { text, inputTokens: 2, outputTokens: 180 }; });
    const expected = { text, inputTokens: 2, outputTokens: 180 };
    const first = f.operations();
    expect(await first.complete(args)).toEqual({ operationId: args.commandKey });
    expect(await settled(first)).toMatchObject({ outcome: { outcome: "finished" }, completion: expected });
    const restarted = f.operations();
    expect(await restarted.complete(args)).toEqual({ operationId: args.commandKey });
    expect(await settled(restarted)).toMatchObject({ outcome: { outcome: "finished" }, completion: expected });
    expect(launches).toBe(1);
  });

  test("failed outcome persistence never acknowledges a result or repeats the effect after restart", async () => {
    let launches = 0;
    const f = await setup(async () => {
      launches++;
      // The durable claim exists before execution; obstruct only the outcome commit.
      const key = createHash("sha256").update(JSON.stringify(args.commandKey)).digest("hex");
      await mkdir(join(f.data, "operations", key + ".json.pending"));
      return { text: "uncommitted result", inputTokens: 2, outputTokens: 3 };
    });
    const first = f.operations();
    expect(await first.complete(args)).toEqual({ operationId: args.commandKey });
    expect(await settled(first)).toEqual({ operationId: args.commandKey, outcome: null, failure: true });
    await expect(first.complete(args)).rejects.toMatchObject({ code: "unknown" });
    await expect(f.operations().complete(args)).rejects.toMatchObject({ code: "unknown" });
    expect(launches).toBe(1);
  });
});
