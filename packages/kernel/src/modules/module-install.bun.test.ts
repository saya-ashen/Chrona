import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "../__testing__/test-db";
import { createExternalModuleInstaller, externalPackageCatalog, installExternal, installationId, recordInstallationResult, refreshInstallationReceipts, rejectionSummary } from "./module-install";
import { readKernelFacts, selectFactConsumer } from "../notification-facts";
import { requestRemove, removeApproved } from "./module-remove";
import { resolveExternalRelease } from "./module-release";
import { moduleContext } from "./module-context";
import { buildPending } from "./module-build";
import { propose } from "./module-proposal";
import { createApprovals } from "../approvals";
import { onApproved } from "./module-activation";
import { testModuleSandbox } from "../__testing__/module-test-process";
import type { StewardPorts } from "../ports";

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

test("catalog lists only explicitly configured application sources", async () => {
  const f = await fixture();
  await f.resource("custom-entry");
  const catalog = await externalPackageCatalog(f.ports, f.workspaceId);
  expect(new Set(catalog.map(item => item.name))).toEqual(new Set(["files", "custom-entry"]));
  expect(catalog.every(item => item.available)).toBe(true);
  expect(await f.db.module.count()).toBe(0);
});

test.each(["custom-entry", "custom-backend"])("offline %s installation keeps an unspecified upstream unset", async name => {
  const f = await fixture(); await f.resource(name);
  const result = await installExternal(f.ports, f.workspaceId, { package: name, mode: "install", requestKey: "offline-upstream" });
  expect(result.status).toBe("building");
  expect((await resolveExternalRelease(f.ports, name)).hash).toMatch(/^[a-f0-9]{64}$/);
  expect(f.executions()).toBe(0);
});

test.each(["qq", "files", "events"] as const)("optional %s installs, stays removed on restart and explicitly reinstalls through checks", async name => {
  const f = await fixture(); await f.resource(name, name === "files" ? { uses: ["*"] } : {});
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
    const session = await f.db.agentContext.create({ data: { workspaceId: f.workspaceId, ownerId: "owner", moduleId: first.moduleId!, hash: first.hash! } });

    const run = await f.db.run.create({ data: { workspaceId: f.workspaceId, sessionId: session.id, lane: "foreground", trigger: "module", provider: "fixture", tokenHash: `files-${session.id}`, prompt: "fixture", cwd: f.ports.dataDir } });
    await expect(requestRemove(context, first.moduleId!, "queued context")).resolves.toMatchObject({ status: "pending_approval" });
    await f.db.providerLaunch.create({ data: { runId: run.id, digest: "launched-fixture" } });
    await f.db.run.update({ where: { id: run.id }, data: { status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" } });
    await expect(requestRemove(context, first.moduleId!, "unknown context stop")).rejects.toMatchObject({ code: "conflict" });
    await f.db.run.update({ where: { id: run.id }, data: { status: "succeeded", stopStatus: "confirmed", error: null, endedAt: f.ports.now() } });
    expect((await f.db.agentContext.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("active");
  }
  const removal = await requestRemove(context, first.moduleId!, "remove optional app");
  const approval = await f.db.approval.update({ where: { id: removal.approvalId }, data: { status: "approved" } });
  await removeApproved(context, { workspaceId: f.workspaceId, approvalId: approval.id, payload: approval.payload! });
  expect(await f.db.module.findUnique({ where: { workspaceId_name: { workspaceId: f.workspaceId, name } } })).toBeNull();
  const executions = f.executions();
  const second = await installExternal(f.ports, f.workspaceId, { ...request, requestKey: `reinstall-${name}` });
  expect(second).toMatchObject({ status: "building" });
  expect(second.moduleId).not.toBe(first.moduleId);
  expect(f.executions()).toBe(executions);
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, { ...request, requestKey: `reinstall-${name}` })).toMatchObject({ status: "installed", moduleId: second.moduleId });
  expect(f.executions()).toBe(executions);
});

test("changed pinned release can be explicitly retried after startup rejection", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  await installExternal(f.ports, f.workspaceId, { package: "files", mode: "install", requestKey: "before-retry" });
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  await f.resource("files", { description: "Changed pinned release" });
  const request = { package: "files", mode: "update" as const, requestKey: "failed-startup" };
  const candidate = await installExternal(f.ports, f.workspaceId, request), sandbox = f.ports.sandbox!;
  f.ports.sandbox = { ...sandbox, startModule: () => { throw new Error("synthetic startup rejection"); } };
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "failed", hash: candidate.hash });
  f.ports.sandbox = sandbox;
  const retry = { ...request, requestKey: "retry-startup" };
  expect(await installExternal(f.ports, f.workspaceId, retry)).toMatchObject({ status: "building", hash: candidate.hash });
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, retry)).toMatchObject({ status: "installed", hash: candidate.hash });
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "failed" });
});

test("real adapter copies read-only official resources and only queues once", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "files");
  await chmod(join(release.codeDir, "index.ts"), 0o444);
  const request = { package: "files" as const, mode: "install" as const, requestKey: "one" };
  const result = await installExternal(f.ports, f.workspaceId, request);
  expect(result).toMatchObject({ status: "building", hash: release.hash, error: null });
  expect(f.executions()).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: result.moduleId! } })).toMatchObject({ activeHash: null });
  expect(await installExternal(f.ports, f.workspaceId, request)).toEqual(result);
  expect(await f.db.moduleVersion.count()).toBe(1);
  await expect(installExternal(f.ports, f.workspaceId, { ...request, requestKey: "two" })).rejects.toMatchObject({ code: "conflict" });
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", hash: release.hash });
  expect(f.executions()).toBe(0);
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
  const local = await propose(context, { expectedHash: selected.hash, root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Original owner intent"] } }, "user");
  await buildPending(context);
  const request = { package: "files" as const, mode: "update" as const, requestKey: "existing-version" };
  await installExternal(f.ports, f.workspaceId, request);
  const id = installationId(f.workspaceId, request.requestKey);
  await f.db.moduleInstallation.update({ where: { id }, data: { status: "pending", moduleId: null, hash: null, approvalId: null, errorCode: null, errorReason: null, errorMessage: null } });
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "installed", moduleId: local.moduleId, hash: local.hash });
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ intent: { changes: ["Original owner intent"] } });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("lost receipt cannot bind a same-name reinstall with the same hash", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "removed-old" };
  const old = await installExternal(f.ports, f.workspaceId, request), id = installationId(f.workspaceId, request.requestKey);
  await f.db.module.delete({ where: { id: old.moduleId! } });
  await f.db.moduleRemoval.create({ data: { workspaceId: f.workspaceId, moduleId: old.moduleId!, name: "files", hash: old.hash, createdAt: f.ports.now() } });
  const selected = await resolveExternalRelease(f.ports, "files");
  const replacement = await propose(moduleContext(f.ports, f.workspaceId), { expectedHash: selected.hash, root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Same name new installation"] } }, "user");
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
  await expect(installExternal(f.ports, f.workspaceId, update)).rejects.toMatchObject({ code: "conflict" });

});

test.each([
  { report: { errors: ["First build error", "Second build error"] }, summary: "First build error" },
  { report: { tests: [{ exitCode: 0, stderr: "harmless" }, { exitCode: 1, stderr: "Test failed token=secret-value" }] }, summary: "Test failed credential=[Redacted]" },
])("rejection summary uses the first useful error: $summary", ({ report, summary }) => {
  expect(rejectionSummary(report)).toBe(summary);
});

test("rejected official update emits one lifecycle notice with its cause and retained version", async () => {
  const f = await fixture(), context = moduleContext(f.ports, f.workspaceId);
  const first = await installExternal(f.ports, f.workspaceId, { package: "files", mode: "install", requestKey: "before-rejection" });
  await buildPending(context);
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  await f.resource("files", { description: "Update that fails startup checks" });
  const request = { package: "files" as const, mode: "update" as const, requestKey: "rejected-update" };
  const candidate = await installExternal(f.ports, f.workspaceId, request);
  const error = `index.ts:1 TS2322: Type string is not assignable to number ${"x".repeat(400)}`;
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: candidate.moduleId!, hash: candidate.hash! } }, data: { status: "rejected", report: { tests: [], errors: [error] } } });
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

test("an explicit checked external update preserves paused selection", async () => {
  const f = await fixture(), request = { package: "files" as const, mode: "install" as const, requestKey: "initial" };
  const first = await installExternal(f.ports, f.workspaceId, request);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
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

test("identical local source and an external release share the same material hash", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "files");
  const result = await propose(moduleContext(f.ports, f.workspaceId), { root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Owner local source"] } }, "user");
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.hash).toBe(release.hash);
});

test("offline update refuses local changes and preserves the selected application", async () => {
  const f = await fixture();
  const first = await installExternal(f.ports, f.workspaceId, { package: "files", mode: "install", requestKey: "initial" });
  const context = moduleContext(f.ports, f.workspaceId);
  await buildPending(context); await refreshInstallationReceipts(f.ports, f.workspaceId);
  const dir = join(f.ports.moduleExternalResources!, "files");
  await writeFile(join(dir, "local.txt"), "owner customization");
  await rm(join(dir, "chrona-material.json"));
  await seedTestModuleRelease(f.ports.moduleExternalResources!, "files");
  const custom = await propose(context, { root: f.ports.moduleExternalResources!, dir: "files", intent: { changes: ["Owner customization"] } }, "user");
  await buildPending(context);
  await rm(join(dir, "local.txt"));
  await rm(join(dir, "chrona-material.json"));
  await f.resource("files", { description: "New release" });
  const request = { package: "files", mode: "update" as const, requestKey: "conflicting-update" };
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Local application changes conflict") } });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).activeHash).toBe(custom.hash);
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

test.each(["web", "chat", "qq"] as const)("an initializer-shaped request key alone cannot approve an owner %s install", async name => {
  const f = await fixture();
  await f.resource(name, { authority: "owner" });
  const request = { package: name, mode: "install" as const, requestKey: `initialize:v1:${name}:1` };
  const candidate = await installExternal(f.ports, f.workspaceId, request);
  await buildPending(moduleContext(f.ports, f.workspaceId));
  await refreshInstallationReceipts(f.ports, f.workspaceId);
  expect(await installExternal(f.ports, f.workspaceId, request)).toMatchObject({ status: "pending_approval", approvalId: expect.any(String) });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: candidate.moduleId! } })).toMatchObject({ activeHash: null });
});

test.each(["user", "provider", "build"] as const)("a same-name %s candidate cannot acquire bootstrap authority from the bundled commit or intent", async source => {
  const f = await fixture();
  await f.resource("web", { authority: "owner" });
  const release = await resolveExternalRelease(f.ports, "web");
  const context = moduleContext(f.ports, f.workspaceId);
  const candidate = await propose(context, { root: f.ports.moduleExternalResources!, dir: "web", expectedHash: release.hash, intent: { changes: [`Official installation ${installationId(f.workspaceId, "initialize:v1:web:1")}`] } }, source);
  await buildPending(context);
  expect(await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: candidate.moduleId! } })).toMatchObject({ hash: release.hash, status: "pending_review" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: candidate.moduleId! } })).toMatchObject({ activeHash: null });
  expect(await f.db.approval.findFirstOrThrow({ where: { moduleId: candidate.moduleId! } })).toMatchObject({ status: "open" });
});
