import { seedTestModuleRelease } from "./module-release-test-fixture";
import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, PREINSTALLED_MODULE_NAMES } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { isModulePaused } from "./module-availability";
import { createExternalModuleInstaller, externalPackageCatalog, installExternal, installationId, recordInstallationResult, refreshInstallationReceipts, rejectionSummary } from "./module-install";
import { factConsumer, readKernelFacts, selectFactConsumer } from "./notification-facts";
import { ensureWorkspaceInitialized } from "./module-initialization";
import { registerBuiltins } from "./module-builtin";
import { requestRemove, removeApproved } from "./module-remove";
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
  const dataDir = await mkdtemp("/tmp/chrona-install-test-"), db = testDb({ injectedAgent: false });
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const w = await db.workspace.create({ data: { name: "Install" } });
  let executions = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T12:00:00Z"), publicUrl: null, moduleExternalResources: join(dataDir, "external"), sandbox: testModuleSandbox(async () => { executions++; return { status: "succeeded", exitCode: 0, output: "{}", error: null }; }) };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  async function resource(name: string, extra: Record<string, unknown> = {}) {
    const dir = join(ports.moduleExternalResources!, name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], ...extra })));
    await writeFile(join(dir, "index.ts"), "// synthetic fixture\n");
    await writeFile(join(dir, "test.ts"), "// offline fixture\n");
    await seedTestModuleRelease(ports.moduleExternalResources!, name);
    return dir;
  }
  await resource("files");
  return { ports, db, workspaceId: w.id, resource, executions: () => executions };
}

test("catalog reports missing releases and paused products unavailable and keeps Author in the current preinstalls", async () => {
  const f = await fixture();
  const catalog = await externalPackageCatalog(f.ports, f.workspaceId);
  for (const name of ["coding", "mind", "remind"]) expect(catalog.find(item => item.name === name)).toMatchObject({ available: false, releaseHash: null, moduleId: null });
  expect(new Set(PREINSTALLED_MODULE_NAMES.filter(name => !isModulePaused(name)))).toEqual(new Set(["pi", "web", "notify", "qq", "author", "mind"]));
  expect(await f.db.module.count()).toBe(0);
});

test.each(["files", "events", "remote-execution"] as const)("optional %s installs, stays removed on restart and explicitly reinstalls through checks", async name => {
  const f = await fixture(); await f.resource(name, name === "files" ? { uses: ["*"] } : {});
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.map(name => ({ workspaceId: f.workspaceId, name })) });
  await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(await f.db.module.findUnique({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } } })).toBeNull();
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === name)).toMatchObject({ available: true, moduleId: null });
  const request = { package: name, mode: "install" as const, requestKey: `first-${name}` };
  const first = await installExternal(f.ports, f.workspaceId, request);
  expect(first.status).toBe("building");
  expect(typeof first.moduleId).toBe("string");
  expect(f.executions()).toBe(0);
  const context = moduleContext(f.ports, f.workspaceId);
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", moduleId: first.moduleId });
  if (name === "files") {
    const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, moduleId: first.moduleId, source: "module", key: "retained-context", title: "Ended private Files conversation" } });
    await expect(requestRemove(context, first.moduleId!, "unmarked active session")).rejects.toMatchObject({ code: "conflict" });
    await f.db.agentContext.create({ data: { workspaceId: f.workspaceId, moduleId: first.moduleId!, sessionId: session.id, hash: "" } });
    const run = await f.db.run.create({ data: { workspaceId: f.workspaceId, sessionId: session.id, lane: "foreground", trigger: "module", provider: "fixture", tokenHash: `files-${session.id}`, prompt: "fixture", cwd: f.ports.dataDir } });
    await expect(requestRemove(context, first.moduleId!, "queued context")).rejects.toMatchObject({ code: "conflict" });
    await f.db.run.update({ where: { id: run.id }, data: { status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" } });
    await expect(requestRemove(context, first.moduleId!, "unknown context stop")).rejects.toMatchObject({ code: "conflict" });
    await f.db.run.update({ where: { id: run.id }, data: { status: "succeeded", stopStatus: "confirmed", error: null, endedAt: f.ports.now() } });
    expect((await f.db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("active");
  }
  const removal = await requestRemove(context, first.moduleId!, "remove optional app");
  const approval = await f.db.approval.update({ where: { id: removal.approvalId }, data: { status: "approved" } });
  await removeApproved(context, { workspaceId: f.workspaceId, approvalId: approval.id, payload: approval.payload! });
  await registerBuiltins(f.ports, f.workspaceId);
  await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(await f.db.module.findUnique({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } } })).toBeNull();
  const executions = f.executions();
  const second = await installExternal(f.ports, f.workspaceId, { ...request, requestKey: `reinstall-${name}` });
  expect(second).toMatchObject({ status: "building" });
  expect(second.moduleId).not.toBe(first.moduleId);
  expect(f.executions()).toBe(executions);
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, { ...request, requestKey: `reinstall-${name}` })).toMatchObject({ status: "installed", moduleId: second.moduleId });
  expect(f.executions()).toBeGreaterThan(executions);
});

test("real adapter copies read-only hardlinked official resources and only queues once", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "files");
  await link(join(release.codeDir, "index.ts"), join(f.ports.dataDir, "linked.ts"));
  await chmod(join(release.codeDir, "index.ts"), 0o444);
  const request = { package: "files" as const, mode: "install" as const, requestKey: "one" };
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
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "lost-response" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  // Simulate the earlier crash boundary: submission evidence exists, but its final moduleId write was lost.
  const row = await f.db.moduleInstallationSubmission.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  await f.db.moduleInstallationSubmission.update({ where: { id: row.id }, data: { moduleId: null } });
  await f.db.audit.deleteMany();
  f.ports.moduleExternalInstaller = async () => { throw new Error("must not repeat proposal"); };
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "building", moduleId: expect.any(String), hash: expect.any(String) });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("prepared copy failures are failed with an explicit retry while uncertain proposals remain pending", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "preparation" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  const row = await f.db.moduleInstallationSubmission.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  // Simulate the persisted prepared phase before any propose side effect.
  await f.db.module.delete({ where: { id: result.moduleId! } });
  await f.db.moduleInstallationSubmission.update({ where: { id: row.id }, data: { phase: "prepared", moduleId: null, error: "Copy failed; explicitly retry" } });
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  const failed = await installExternal(f.ports, f.workspaceId, request);
  expect(failed).toMatchObject({ status: "failed", error: { reason: "submission_not_started", message: "Copy failed; explicitly retry" } });
  expect(await installExternal(f.ports, f.workspaceId, { ...request, requestKey: "preparation-retry" })).toMatchObject({ status: "building" });
});

test("same-hash existing version is reconciled by version id when propose preserves its old intent", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const selected = await resolveExternalRelease(f.ports, "files");
  const local = await propose(context, { sourceCommit: selected.hash, gitBundle: selected.git!, root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Original owner intent"] } }, "user");
  const request = { package: "files" as const, mode: "update" as const, requestKey: "existing-version" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "building", moduleId: local.moduleId, hash: local.hash });
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ intent: { changes: ["Original owner intent"] } });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("lost receipt cannot bind a same-name reinstall with the same hash", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "removed-old" };
  const old = await installExternal(f.ports, f.workspaceId, request), id = installationId(f.workspaceId, request.requestKey);
  await f.db.module.delete({ where: { id: old.moduleId! } });
  await f.db.moduleRemoval.create({ data: { workspaceId: f.workspaceId, moduleId: old.moduleId!, name: "files", hash: old.hash, createdAt: f.ports.now() } });
  const selected = await resolveExternalRelease(f.ports, "files");
  const replacement = await propose(moduleContext(f.ports, f.workspaceId), { sourceCommit: selected.hash, gitBundle: selected.git!, root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Same name new installation"] } }, "user");
  const submission = await f.db.moduleInstallationSubmission.findUniqueOrThrow({ where: { id: `${id}:submission` } });
  await f.db.moduleInstallationSubmission.update({ where: { id: submission.id }, data: { moduleId: null } });
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  await f.db.audit.deleteMany();
  const reconciled = await installExternal(f.ports, f.workspaceId, request);
  expect(reconciled.status).toBe("failed");
  expect(reconciled.moduleId).toBe(old.moduleId);
  expect(reconciled.moduleId).not.toBe(replacement.moduleId);
  expect(reconciled.error?.reason).toBe("module_removed");
});

test("accepted request without submission evidence stays pending without invoking adapter", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "accepted" };
  const result = { package: request.package, requestKey: request.requestKey, status: "pending" as const, moduleId: null, hash: null, approvalId: null, error: null };
  await f.db.moduleInstallation.create({ data: { id: installationId(f.workspaceId, request.requestKey), workspaceId: f.workspaceId, ...request, status: result.status, moduleId: result.moduleId, hash: result.hash, approvalId: result.approvalId } });
  f.ports.moduleExternalInstaller = async () => { throw new Error("must not run"); };
  expect(await installExternal(f.ports, f.workspaceId, request)).toEqual(result);
  expect(await f.db.moduleVersion.count()).toBe(0);
});

test("receipts reflect actual approval, paused selection, inactive approval and rejection", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "approval" };
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

test.each([
  { report: { errors: ["First build error", "Second build error"] }, summary: "First build error" },
  { report: { typecheck: { errors: [{ message: "First type error" }, { message: "Second type error" }] } }, summary: "First type error" },
  { report: { tests: [{ exitCode: 0, stderr: "harmless" }, { exitCode: 1, stderr: "Test failed token=secret-value" }] }, summary: "Test failed credential=[Redacted]" },
])("rejection summary uses the first useful error: $summary", ({ report, summary }) => {
  expect(rejectionSummary(report)).toBe(summary);
});

test("rejected official update emits one lifecycle notice with its cause and retained version", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const first = await installExternal(f.ports, f.workspaceId, { package: "files", mode: "install", requestKey: "before-rejection" });
  await buildPending(context);
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  await f.resource("files", { description: "Update that fails type checking" });
  const request = { package: "files" as const, mode: "update" as const, requestKey: "rejected-update" };
  const candidate = await installExternal(f.ports, f.workspaceId, request);
  const error = `index.ts:1 TS2322: Type string is not assignable to number ${"x".repeat(400)}`;
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: candidate.moduleId!, hash: candidate.hash! } }, data: { status: "rejected", report: { tests: [], typecheck: { status: "failed", errors: [{ file: "index.ts", line: 1, code: 2322, message: error }] } } } });
  const rejection = { status: "failed", hash: candidate.hash, error: { reason: "installation_rejected", message: error.slice(0, 300) } };
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "files")?.installation).toMatchObject(rejection);
  // Catalog observation stays read-only; the tick persists the receipt and notice together.
  expect(await f.db.moduleInstallation.findUniqueOrThrow({ where: { id: installationId(f.workspaceId, request.requestKey) } })).toMatchObject({ status: "building" });
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  await refreshInstallationReceipts({ ...f.ports }, f.workspaceId);
  const failed = await installExternal(f.ports, f.workspaceId, request);
  expect(failed).toMatchObject(rejection);
  await recordInstallationResult({ ...f.ports }, f.workspaceId, failed);
  const consumer = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "fact-reader", status: "active", activeHash: "reader" } });
  await selectFactConsumer(f.db, f.workspaceId, consumer.id, f.ports.now());
  const facts = await readKernelFacts(f.db, f.workspaceId, { kind: "module", module: consumer.name, moduleId: consumer.id, hash: "reader" });
  const notices = facts.facts.filter(fact => fact.type === "lifecycle" && fact.data.fact.kind === "module-update-rejected");
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ type: "lifecycle", data: { fact: { kind: "module-update-rejected", app: "files", hash: candidate.hash, activeHash: first.hash, error: error.slice(0, 300) } } });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).toMatchObject({ activeHash: first.hash });
});

test("initialization converges from the existing build queue and never reinstalls removed preinstalls", async () => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(first.status).toBe("pending");
  expect(await factConsumer(f.db, f.workspaceId)).toMatchObject({ moduleId: null, revision: "unselected" });
  expect(new Set(Object.keys(first.packages))).toEqual(new Set([...PREINSTALLED_MODULE_NAMES, "remind"]));
  for (const name of PREINSTALLED_MODULE_NAMES) expect(first.packages[name].status).toBe("building");
  expect(first.packages.mind).toMatchObject({ status: "building", error: null });
  expect(first.packages.remind).toMatchObject({ status: "skipped", moduleId: null, hash: null, error: { reason: "module_paused" } });
  const authorRelease = await resolveExternalRelease(f.ports, "author");
  expect(first.packages.author).toMatchObject({ requestKey: "initialize:v1:author:1", attempts: 1, hash: authorRelease.hash });
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "author")).toMatchObject({ available: true, releaseHash: authorRelease.hash, moduleId: first.packages.author.moduleId, git: { commit: authorRelease.hash }, installation: { package: "author", status: "building", requestKey: first.packages.author.requestKey } });
  expect(await f.db.module.findFirst({ where: { name: "memory-local" } })).toBeNull();
  expect(f.executions()).toBe(0);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await buildPending(moduleContext(f.ports, f.workspaceId));
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).status).toBe("complete");
  const selected = await factConsumer(f.db, f.workspaceId);
  expect(selected.moduleId).toBe(first.packages.notify.moduleId);
  await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(await factConsumer(f.db, f.workspaceId)).toEqual(selected);
  await f.db.module.delete({ where: { id: first.packages.qq.moduleId! } });
  await f.resource("qq", { description: "New release is explicit" });
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).status).toBe("complete");
  expect(await f.db.module.findFirst({ where: { name: "qq" } })).toBeNull();
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(p => p.name === "qq")?.installation).toMatchObject({ requestKey: first.packages.qq.requestKey });
});

test.each(["pi", "web", "notify", "author"] as const)("failed %s preinstall checks need explicit retry without reinstalling completed apps", async name => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  await f.resource(name, { packages: ["fixture-missing-program"] });
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await buildPending(moduleContext(f.ports, f.workspaceId));
  const failed = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(failed.packages[name].status).toBe("failed");
  expect(failed.packages.qq.status).toBe("installed");
  expect(failed.status).toBe("pending");
  if (name === "notify") expect(await factConsumer(f.db, f.workspaceId)).toEqual({ moduleId: null, revision: "unselected" });
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).packages[name].attempts).toBe(1);
  // The owner repairs the available official resource and explicitly retries; queue uses update for its retained module row.
  await f.resource(name);
  const retry = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(retry.packages[name]).toMatchObject({ attempts: 2, status: "building" });
  expect(retry.packages.qq.requestKey).toBe(first.packages.qq.requestKey);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await buildPending(moduleContext(f.ports, f.workspaceId));
  const complete = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(complete.status).toBe("complete");
  expect((await factConsumer(f.db, f.workspaceId)).moduleId).toBe(complete.packages.notify.moduleId);
  expect(await f.db.module.count()).toBe(PREINSTALLED_MODULE_NAMES.filter(name => !isModulePaused(name)).length);
});

test("missing Author release fails closed until resources are repaired and bootstrap is explicitly retried", async () => {
  const f = await fixture();
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.filter(name => name !== "author").map(name => ({ workspaceId: f.workspaceId, name })) });
  const initial = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(initial.status).toBe("pending");
  expect(initial.packages.author).toMatchObject({ status: "failed", attempts: 1, moduleId: null, hash: null, error: { code: "not_found", reason: "release_not_found" } });
  expect((await externalPackageCatalog(f.ports, f.workspaceId)).find(item => item.name === "author")).toMatchObject({ available: false, releaseHash: null, moduleId: null });
  await f.resource("author");
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).packages.author).toEqual(initial.packages.author);
  expect(f.executions()).toBe(0);
  const retry = await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(retry.packages.author).toMatchObject({ status: "building", attempts: 2, requestKey: "initialize:v1:author:2" });
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await buildPending(moduleContext(f.ports, f.workspaceId));
  const complete = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(complete.packages.author).toMatchObject({ status: "installed", error: null });
  expect(complete.status).toBe("complete");
  expect(complete.packages.author).toMatchObject({ status: "installed", moduleId: retry.packages.author.moduleId });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: complete.packages.author.moduleId! } })).toMatchObject({ builtin: false, activeHash: complete.packages.author.hash });
});

test("a removed submission after a lost receipt is reconciled by its original identity and never resurrected", async () => {
  const f = await fixture();
  for (const name of PREINSTALLED_MODULE_NAMES) await f.resource(name);
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  const requestKey = first.packages.qq.requestKey, moduleId = first.packages.qq.moduleId!;
  const id = installationId(f.workspaceId, requestKey);
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  await f.db.module.delete({ where: { id: moduleId } });
  const settings = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as Record<string, unknown>;
  const state = JSON.parse(JSON.stringify(first));
  state.packages.qq = { ...state.packages.qq, status: "pending", moduleId: null, hash: null };
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { ...settings, moduleInitialization: state } } });
  await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  const recovered = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(recovered.packages.qq).toMatchObject({ status: "skipped", moduleId });
  expect(await f.db.module.findFirst({ where: { name: "qq" } })).toBeNull();
  expect(await f.db.moduleInstallationSubmission.count({ where: { id: `${id}:submission` } })).toBe(1);
});

test("an explicit checked external update preserves paused selection", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "initial" };
  const first = await installExternal(f.ports, f.workspaceId, request);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await f.db.module.update({ where: { id: first.moduleId! }, data: { status: "paused" } });
  await f.resource("files", { description: "Owner explicitly selected update" });
  const update = { ...request, mode: "update" as const, requestKey: "paused-update" };
  const candidate = await installExternal(f.ports, f.workspaceId, update);
  expect(candidate).toMatchObject({ status: "building" });
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, update)).toMatchObject({ status: "installed" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).toMatchObject({ status: "paused", activeHash: candidate.hash });
});

test.each(["pi", "qq"] as const)("%s checks and credential approval refresh the same installation receipt to installed", async name => {
  const f = await fixture(); await f.resource(name, { secrets: ["fixture_key"] });
  const request = { package: name, mode: "install" as const, requestKey: "credential-flow" };
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
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "files");
  const result = await propose(moduleContext(f.ports, f.workspaceId), { root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Owner local source"] } }, "user");
  expect(result.hash).toMatch(/^[a-f0-9]{40}$/);
  expect(result.report.git?.commit).toBe(result.hash);
  expect(result.hash).not.toBe(release.hash);
});

test("offline official update preserves a local fork and queues the merged commit", async () => {
  const f = await fixture(), first = await installExternal(f.ports, f.workspaceId, { package: "files", mode: "install", requestKey: "fork-initial" });
  const context = moduleContext(f.ports, f.workspaceId), dir = join(f.ports.moduleExternalResources!, "files");
  await writeFile(join(dir, "local.txt"), "owner customization\n");
  await propose(context, { root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Owner customization"] } }, "user");
  await rm(join(dir, "local.txt"));
  await f.resource("files", { description: "New upstream release" });
  const release = await resolveExternalRelease(f.ports, "files");
  const request = { package: "files" as const, mode: "update" as const, requestKey: "fork-update" };
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

test.each(["pi", "web", "notify", "author"] as const)("preinstalled %s uses checks, stays removed after restart and explicitly reinstalls with a new identity", async name => {
  const f = await fixture();
  await f.resource(name, { uses: ["*"] });
  await f.db.module.createMany({ data: PREINSTALLED_MODULE_NAMES.filter(other => other !== name).map(other => ({ workspaceId: f.workspaceId, name: other })) });
  const first = await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  const installed = first.packages[name], context = moduleContext(f.ports, f.workspaceId);
  expect(installed.status).toBe("building");
  expect(f.executions()).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: installed.moduleId! } })).toMatchObject({ builtin: false, activeHash: null });
  await buildPending(context);
  expect((await ensureWorkspaceInitialized(f.ports, f.workspaceId)).packages[name].status).toBe("installed");
  expect(f.executions()).toBeGreaterThan(0);
  const selected = await factConsumer(f.db, f.workspaceId);
  if (name === "notify") expect(selected.moduleId).toBe(installed.moduleId);
  const removal = await requestRemove(context, installed.moduleId!, "owner removes preinstalled app");
  const approval = await f.db.approval.update({ where: { id: removal.approvalId }, data: { status: "approved" } });
  await removeApproved(context, { workspaceId: f.workspaceId, approvalId: approval.id, payload: approval.payload! });
  await registerBuiltins(f.ports, f.workspaceId);
  await ensureWorkspaceInitialized(f.ports, f.workspaceId, { retryFailed: true });
  expect(await f.db.module.findFirst({ where: { workspaceId: f.workspaceId, name } })).toBeNull();
  const count = f.executions();
  const request = { package: name, mode: "install" as const, requestKey: `explicit-reinstall-${name}` };
  const next = await installExternal(f.ports, f.workspaceId, request);
  expect(next.status).toBe("building");
  expect(next.moduleId).not.toBe(installed.moduleId);
  expect(f.executions()).toBe(count);
  await buildPending(context);
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", moduleId: next.moduleId });
  await ensureWorkspaceInitialized(f.ports, f.workspaceId);
  expect(await factConsumer(f.db, f.workspaceId)).toEqual(selected);
});

test("corrupt persisted submission phase fails closed instead of inferring a successful proposal", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "corrupt-phase" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending" } });
  await f.db.moduleInstallationSubmission.update({ where: { id: `${id}:submission` }, data: { phase: "corrupt" } });
  await expect(installExternal(f.ports, f.workspaceId, request)).rejects.toThrow();
  expect(await f.db.moduleVersion.count()).toBe(1);
  expect((await f.db.moduleInstallation.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
});
