import { seedTestModuleRelease } from "./module-release-test-fixture";
import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, PREINSTALLED_MODULE_NAMES } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createExternalModuleInstaller, externalPackageCatalog, installExternal, installationId, refreshInstallationReceipts } from "./module-install";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { resolveExternalRelease } from "./module-release";
import { moduleContext } from "./module-context";
import { buildPending } from "./module-build";
import { propose } from "./module-proposal";
import { createApprovals } from "./approvals";
import { onApproved } from "./module-activation";
import { testModuleSandbox } from "./module-test-process";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-install-test-"), db = testDb();
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const w = await db.workspace.create({ data: { name: "Install" } });
  let executions = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T12:00:00Z"), publicUrl: null, moduleExternalResources: join(dataDir, "external"), sandbox: testModuleSandbox(async () => { executions++; return { status: "succeeded", exitCode: 0, output: "{}", error: null }; }) };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  async function resource(name: string, extra: Record<string, unknown> = {}) {
    const dir = join(ports.moduleExternalResources!, name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], ...extra })));
    await writeFile(join(dir, "index.ts"), "// synthetic fixture\n");
    await writeFile(join(dir, "test.ts"), "// offline fixture\n");
    await seedTestModuleRelease(ports.moduleExternalResources!, name);
    return dir;
  }
  await resource("remind");
  return { ports, db, workspaceId: w.id, resource, executions: () => executions };
}

test("coding/editor catalog reports missing products unavailable without adding them to preinstallation", async () => {
  const f = await fixture();
  const catalog = await externalPackageCatalog(f.ports, f.workspaceId);
  for (const name of ["coding", "editor"]) expect(catalog.find(item => item.name === name)).toMatchObject({ available: false, releaseHash: null, moduleId: null });
  expect([...PREINSTALLED_MODULE_NAMES]).toEqual(["qq", "remind", "mind"]);
  expect(await f.db.module.count()).toBe(0);
});

test("real adapter copies read-only hardlinked official resources and only queues once", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "remind");
  await link(join(release.codeDir, "index.ts"), join(f.ports.dataDir, "linked.ts"));
  await chmod(join(release.codeDir, "index.ts"), 0o444);
  const request = { package: "remind" as const, mode: "install" as const, requestKey: "one" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  expect(result).toMatchObject({ status: "building", hash: release.hash, error: null });
  expect(f.executions()).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: result.moduleId! } })).toMatchObject({ builtin: false, activeHash: null });
  expect(await installExternal(f.ports, f.workspaceId, request)).toEqual(result);
  expect(await f.db.moduleVersion.count()).toBe(1);
  await expect(installExternal(f.ports, f.workspaceId, { ...request, requestKey: "two" })).rejects.toMatchObject({ code: "conflict" });
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", hash: release.hash });
  expect(f.executions()).toBeGreaterThan(0);
});

test("pending receipt recovers an actual proposal after the adapter response was lost", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "lost-response" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.audit.update({ where: { id }, data: { subjectId: null, details: { request, result: { package: request.package, requestKey: request.requestKey, status: "pending", moduleId: null, hash: null, approvalId: null, error: null } } } });
  // Simulate the earlier crash boundary: submission evidence exists, but its final moduleId write was lost.
  const row = await f.db.audit.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  await f.db.audit.update({ where: { id: row.id }, data: { details: { ...(row.details as object), moduleId: null } } });
  f.ports.moduleExternalInstaller = async () => { throw new Error("must not repeat proposal"); };
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "building", moduleId: expect.any(String), hash: expect.any(String) });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("prepared copy failures are failed with an explicit retry while uncertain proposals remain pending", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "preparation" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  const row = await f.db.audit.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  // Simulate the persisted prepared phase before any propose side effect.
  await f.db.module.delete({ where: { id: result.moduleId! } });
  await f.db.audit.update({ where: { id: row.id }, data: { details: { ...(row.details as object), phase: "prepared", moduleId: null, error: "Copy failed; explicitly retry" } } });
  await f.db.audit.update({ where: { id }, data: { details: { request, result: { ...result, status: "pending", moduleId: null, hash: null } } } });
  const failed = await installExternal(f.ports, f.workspaceId, request);
  expect(failed).toMatchObject({ status: "failed", error: { reason: "submission_not_started", message: "Copy failed; explicitly retry" } });
  expect(await installExternal(f.ports, f.workspaceId, { ...request, requestKey: "preparation-retry" })).toMatchObject({ status: "building" });
});

test("same-hash existing version is reconciled by version id when propose preserves its old intent", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const selected = await resolveExternalRelease(f.ports, "remind");
  const local = await propose(context, { sourceCommit: selected.hash, gitBundle: selected.git!, root: f.ports.moduleExternalResources!, dir: "remind", intent: { changes: ["Original owner intent"] } }, "user");
  const request = { package: "remind" as const, mode: "update" as const, requestKey: "existing-version" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.audit.update({ where: { id }, data: { details: { request, result: { package: "remind", requestKey: request.requestKey, status: "pending", moduleId: null, hash: null, approvalId: null, error: null } } } });
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "building", moduleId: local.moduleId, hash: local.hash });
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ intent: { changes: ["Original owner intent"] } });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("lost receipt cannot bind a same-name reinstall with the same hash", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "removed-old" };
  const old = await installExternal(f.ports, f.workspaceId, request), id = installationId(f.workspaceId, request.requestKey);
  await f.db.module.delete({ where: { id: old.moduleId! } });
  await f.db.audit.create({ data: { workspaceId: f.workspaceId, actorKey: "user", kind: "module_removed", subjectId: old.moduleId, details: { name: "remind", hash: old.hash }, createdAt: f.ports.now() } });
  const selected = await resolveExternalRelease(f.ports, "remind");
  const replacement = await propose(moduleContext(f.ports, f.workspaceId), { sourceCommit: selected.hash, gitBundle: selected.git!, root: f.ports.moduleExternalResources!, dir: "remind", intent: { changes: ["Same name new installation"] } }, "user");
  const submission = await f.db.audit.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  await f.db.audit.update({ where: { id: submission.id }, data: { details: { ...(submission.details as object), moduleId: null } } });
  await f.db.audit.update({ where: { id }, data: { details: { request, result: { package: "remind", requestKey: request.requestKey, status: "pending", moduleId: null, hash: null, approvalId: null, error: null } } } });
  const reconciled = await installExternal(f.ports, f.workspaceId, request);
  expect(reconciled.status).toBe("failed");
  expect(reconciled.moduleId).toBe(old.moduleId);
  expect(reconciled.moduleId).not.toBe(replacement.moduleId);
  expect(reconciled.error?.reason).toBe("module_removed");
});

test("accepted request without submission evidence stays pending without invoking adapter", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "accepted" };
  const result = { package: request.package, requestKey: request.requestKey, status: "pending" as const, moduleId: null, hash: null, approvalId: null, error: null };
  await f.db.audit.create({ data: { id: installationId(f.workspaceId, request.requestKey), workspaceId: f.workspaceId, kind: "module_installation", actorKey: "kernel", details: { request, result } } });
  f.ports.moduleExternalInstaller = async () => { throw new Error("must not run"); };
  expect(await installExternal(f.ports, f.workspaceId, request)).toEqual(result);
  expect(await f.db.moduleVersion.count()).toBe(0);
});

test("receipts reflect actual approval, paused selection, inactive approval and rejection", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "approval" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  const version = await f.db.moduleVersion.findFirstOrThrow();
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "pending_review" } });
  const approval = await f.db.approval.create({ data: { workspaceId: f.workspaceId, moduleId: result.moduleId, action: "activate_module", title: "Credential approval", detail: "", preview: "", payload: { kind: "activate_module", moduleId: result.moduleId, hash: result.hash } } });
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "pending_approval", approvalId: approval.id });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
  await f.db.module.update({ where: { id: result.moduleId! }, data: { activeHash: result.hash, status: "paused" } });
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: result.moduleId! } })).toMatchObject({ status: "paused" });
  const update = { ...request, mode: "update" as const, requestKey: "inactive" };
  await f.db.module.update({ where: { id: result.moduleId! }, data: { activeHash: "a".repeat(64) } });
  expect(await installExternal(f.ports, f.workspaceId, update)).toMatchObject({ status: "failed", error: { reason: "candidate_inactive" } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: { tests: [], errors: ["check failed token=not-for-output"] } } });
  const retry = await installExternal(f.ports, f.workspaceId, { ...update, requestKey: "retry" });
  expect(retry.status).toBe("building");
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: result.moduleId!, hash: result.hash! } }, data: { status: "rejected", report: { tests: [], errors: ["check failed token=not-for-output"] } } });
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  const failed = await installExternal(f.ports, f.workspaceId, { ...update, requestKey: "retry" });
  expect(failed).toMatchObject({ status: "failed", error: { reason: "installation_rejected" } });
  expect(failed.error?.message).not.toContain("not-for-output");
});

test("initialization converges from the existing build queue and never reinstalls removed preinstalls", async () => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(first.status).toBe("pending");
  expect(Object.values(first.packages).map(p => p.status)).toEqual(["building", "building", "building"]);
  expect(await f.db.module.findFirst({ where: { name: "memory-local" } })).toBeNull();
  expect(f.executions()).toBe(0);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).status).toBe("complete");
  await f.db.module.delete({ where: { id: first.packages.remind.moduleId! } });
  await f.resource("remind", { description: "New release is explicit" });
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).status).toBe("complete");
  expect(await f.db.module.findFirst({ where: { name: "remind" } })).toBeNull();
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(p => p.name === "remind")?.installation).toMatchObject({ requestKey: first.packages.remind.requestKey });
});

test("failed preinstall checks need explicit retry and then converge without reinstalling completed apps", async () => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  await f.resource("remind", { packages: ["fixture-missing-program"] });
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  const failed = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(failed.packages.remind.status).toBe("failed");
  expect(failed.packages.qq.status).toBe("installed");
  expect(failed.status).toBe("pending");
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).packages.remind.attempts).toBe(1);
  // The owner repairs the available official resource and explicitly retries; queue uses update for its retained module row.
  await f.resource("remind");
  const retry = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(retry.packages.remind).toMatchObject({ attempts: 2, status: "building" });
  expect(retry.packages.qq.requestKey).toBe(first.packages.qq.requestKey);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).status).toBe("complete");
  expect(await f.db.module.count()).toBe(3);
});

test("a removed submission after a lost receipt is reconciled by its original identity and never resurrected", async () => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  const requestKey = first.packages.remind.requestKey, moduleId = first.packages.remind.moduleId!;
  const id = installationId(f.workspaceId, requestKey);
  const request = { package: "remind" as const, mode: "install" as const, requestKey };
  await f.db.audit.update({ where: { id }, data: { subjectId: null, details: { request, result: { package: "remind", requestKey, status: "pending", moduleId: null, hash: null, approvalId: null, error: null } } } });
  await f.db.module.delete({ where: { id: moduleId } });
  const settings = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as Record<string, unknown>;
  const state = JSON.parse(JSON.stringify(first));
  state.packages.remind = { ...state.packages.remind, status: "pending", moduleId: null, hash: null };
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { ...settings, moduleInitialization: state } } });
  await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  const recovered = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(recovered.packages.remind).toMatchObject({ status: "skipped", moduleId });
  expect(await f.db.module.findFirst({ where: { name: "remind" } })).toBeNull();
  expect(await f.db.audit.count({ where: { kind: "module_installation_submission", id: `${id}:submission` } })).toBe(1);
});

test("an explicit checked external update preserves paused selection", async () => {
  const f = await fixture(), request = { package: "remind" as const, mode: "install" as const, requestKey: "initial" };
  const first = await installExternal(f.ports, f.workspaceId, request);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await f.db.module.update({ where: { id: first.moduleId! }, data: { status: "paused" } });
  await f.resource("remind", { description: "Owner explicitly selected update" });
  const update = { ...request, mode: "update" as const, requestKey: "paused-update" };
  const candidate = await installExternal(f.ports, f.workspaceId, update);
  expect(candidate).toMatchObject({ status: "building" });
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, update)).toMatchObject({ status: "installed" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).toMatchObject({ status: "paused", activeHash: candidate.hash });
});

test("real checks and credential approval refresh the same installation receipt to installed", async () => {
  const f = await fixture(); await f.resource("qq", { secrets: ["fixture_key"] });
  const request = { package: "qq" as const, mode: "install" as const, requestKey: "credential-flow" };
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "building" });
  const context = moduleContext(f.ports, f.workspaceId);
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  const pending = await installExternal(f.ports, f.workspaceId, request);
  expect(pending.status).toBe("pending_approval");
  expect(typeof pending.approvalId).toBe("string");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: pending.moduleId! } })).toMatchObject({ activeHash: null });
  const resolved = await createApprovals(context).resolve(pending.approvalId!, { decision: "approve", scope: "once" }, "cli");
  await onApproved(context, { workspaceId: f.workspaceId, approvalId: pending.approvalId!, payload: resolved.payload! });
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", approvalId: null });
});

test("ordinary local source uses its own real Git commit rather than impersonating a release", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "remind");
  const result = await propose(moduleContext(f.ports, f.workspaceId), { root: f.ports.moduleExternalResources!, dir: "remind", intent: { changes: ["Owner local source"] } }, "user");
  expect(result.hash).toMatch(/^[a-f0-9]{40}$/);
  expect(result.report.git?.commit).toBe(result.hash);
  expect(result.hash).not.toBe(release.hash);
});

test("offline official update preserves a local fork and queues the merged commit", async () => {
  const f = await fixture(), first = await installExternal(f.ports, f.workspaceId, { package: "remind", mode: "install", requestKey: "fork-initial" });
  const context = moduleContext(f.ports, f.workspaceId), dir = join(f.ports.moduleExternalResources!, "remind");
  await writeFile(join(dir, "local.txt"), "owner customization\n");
  await propose(context, { root: f.ports.moduleExternalResources!, dir: "remind", intent: { changes: ["Owner customization"] } }, "user");
  await rm(join(dir, "local.txt"));
  await f.resource("remind", { description: "New upstream release" });
  const release = await resolveExternalRelease(f.ports, "remind");
  const request = { package: "remind" as const, mode: "update" as const, requestKey: "fork-update" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  expect(result).toMatchObject({ status: "building", moduleId: first.moduleId, error: null });
  expect(result.hash).not.toBe(release.hash);
  const { readModuleSource } = await import("./module-git");
  const files = await readModuleSource({ platform: context.platform, moduleId: first.moduleId!, commit: result.hash! });
  expect(files.find(file => file.path === "local.txt")?.bytes.toString()).toBe("owner customization\n");
  expect(JSON.parse(Buffer.from(files.find(file => file.path === "module.json")!.bytes).toString()).description).toBe("New upstream release");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).activeHash).toBeNull();
  expect(await installExternal(f.ports, f.workspaceId, request)).toEqual(result);
});
