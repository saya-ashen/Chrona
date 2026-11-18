import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { testDb } from "../__testing__/test-db";
import { createApprovals } from "../approvals";
import { createStewardService } from "../runtime/service";
import { moduleContext } from "./module-context";
import { createExternalModuleInstaller, installExternal, refreshInstallationReceipts } from "./module-install";
import { resolveExternalRelease } from "./module-release";
import { seedTestModuleRelease, testReleaseRuntimeChecks } from "../__testing__/module-release-test-fixture";
import { propose } from "./module-proposal";
import { buildPending } from "./module-build";
import { createRuns } from "../execution/runs";
import { onApproved } from "./module-activation";
import { prepareExactReleaseUpdate, readExactReleaseBaselineIn } from "./module-exact-release";
import { moduleSupervisor } from "./module-supervisor";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { testModuleSandbox } from "../__testing__/module-test-process";
import { assertExplicitRetryIssuesFreshAttempt, assertInterleavedSettlementConverges, assertPoisonedHeadDoesNotStarveTail } from "../__testing__/state-machine-invariants";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const owner = { kind: "owner", via: null } as const;
async function fixture(name = "pi") {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-exact-release-");
  const workspace = await db.workspace.create({ data: { name: "exact release" } });
  let tests = 0, fail = false;
  const sandbox = testModuleSandbox(async () => ({ status: "succeeded", exitCode: 0, output: "{}", error: null }));
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: join(dataDir, "external"), ...testReleaseRuntimeChecks(),
    sandbox: { ...sandbox, startModule: input => { tests++; if (fail) throw new Error("synthetic startup failure"); return sandbox.startModule(input); } }, moduleExternalInstaller: undefined as ReturnType<typeof createExternalModuleInstaller> | undefined };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  cleanup.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const code = join(ports.moduleExternalResources!, name); await mkdir(code, { recursive: true });
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], tools: [{ name: "health", description: "Offline provider health", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { available: { type: "boolean" } }, required: ["available"], additionalProperties: false } }] });
  await writeFile(join(code, "module.json"), JSON.stringify(manifest));
  await writeFile(join(code, "index.ts"), 'import { on } from "chrona";\non("tool", async () => ({ result: { available: true } }));\n');
  await writeFile(join(code, "test.ts"), "export {};\n");
  await seedTestModuleRelease(ports.moduleExternalResources!, name);
  const context = moduleContext(ports, workspace.id);
  const local = await propose(context, { root: ports.moduleExternalResources!, dir: name, intent: { changes: ["Owner source submission"] } }, "user");
  await buildPending(context);
  expect(await db.module.findUniqueOrThrow({ where: { id: local.moduleId! } })).toMatchObject({ activeHash: local.hash });
  const active = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: local.moduleId!, hash: local.hash } } });
  await installExternal(ports, workspace.id, { package: name, mode: "update", requestKey: "initial-receipt" });
  await writeFile(join(code, "index.ts"), 'import { on } from "chrona";\n// next release\non("tool", async () => ({ result: { available: true } }));\n');
  const release = await resolveExternalRelease(ports, name);
  const request = (key: string) => ({ package: name as "pi", mode: "update" as const, requestKey: key });
  return { db, ports, context, release, code, local, active, request, tests: () => tests, failTests: (value: boolean) => { fail = value; }, select: (key: string) => installExternal(ports, workspace.id, request(key)) };
}

test("changed release selects exact SHA256 material through checks; ordinary SDK health executes through sandbox", async () => {
  const f = await fixture();
  expect(f.local.hash).not.toBe(f.release.hash);
  const before = await f.db.moduleActivation.findMany();
  const result = await f.select("select");
  expect(result).toMatchObject({ status: "building", hash: f.release.hash });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
  const checksBefore = f.tests();
  await buildPending(f.context); await refreshInstallationReceipts(f.ports, f.context.workspaceId);
  expect(await f.select("select")).toMatchObject({ status: "installed", hash: f.release.hash });
  const selected = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.local.moduleId!, hash: f.release.hash } } });
  expect(selected).toMatchObject({ status: "approved", source: "user", report: { tests: [], continuity: { migrated: false } } });
  expect(f.tests()).toBeGreaterThan(checksBefore);
  expect(await f.db.moduleActivation.findMany()).toEqual(expect.arrayContaining(before));
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { id: f.active.id } })).toEqual(f.active);
  const sandbox = createScriptSandbox({ dataDir: f.ports.dataDir, moduleSdk: f.ports.moduleSdk!, executionMode: "trusted-local" });
  f.ports.sandbox = { ...sandbox.health, startModule: sandbox.startModule, runModule: sandbox.runModule };
  const now = f.ports.now().toISOString();
  const health = await moduleSupervisor(f.ports).deliver(f.local.moduleId!, f.release.hash, { trigger: { kind: "tool", id: "health", caller: owner, args: {}, firedAt: now }, params: {}, now });
  expect(health).toMatchObject({ result: { result: { available: true } } });
}, 30_000);

test("active application customization requires resolution in the application repository", async () => {
  const f = await fixture();
  const custom = join(f.ports.dataDir, "custom"); await cp(f.code, join(custom, "pi"), { recursive: true });
  await writeFile(join(custom, "pi/index.ts"), "// owner customization\nexport {};\n");
  const local = await propose(f.context, { root: custom, dir: "pi", intent: { changes: ["Customization"] } }, "user");
  await buildPending(f.context);
  expect(await f.select("active-custom")).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Local application changes conflict") } });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(local.hash);
});

test.each(["hash", "activation", "approval"] as const)("approved identity drift before background checks rejects (%s)", async kind => {
  const f = await fixture(); await f.select("drift");
  if (kind === "approval") await f.db.moduleVersion.update({ where: { id: f.active.id }, data: { status: "rejected" } });
  else await f.db.module.update({ where: { id: f.local.moduleId! }, data: kind === "hash" ? { activeHash: "b".repeat(64) } : { activationId: "another-activation" } });
  await buildPending(f.context); await refreshInstallationReceipts(f.ports, f.context.workspaceId);
  expect(await f.select("drift")).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Approved active identity changed") } });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).not.toBe(f.release.hash);
});

test("owner baseline is bound before asynchronous release resolution", async () => {
  const f = await fixture(), installer = f.ports.moduleExternalInstaller!;
  f.ports.moduleExternalInstaller = async input => {
    await f.db.module.update({ where: { id: f.local.moduleId! }, data: { activationId: "changed-before-copy" } });
    return installer(input);
  };
  expect(await f.select("early-drift")).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Approved active identity changed") } });
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("approval resolution rechecks the exact baseline and does not create a standing approval", async () => {
  const f = await fixture(); await f.select("review");
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.local.moduleId!, hash: f.release.hash } } });
  // Exercise the delayed manual decision boundary with a real approval and retained candidate source.
  await cp(f.code, join(f.context.store, f.release.hash), { recursive: true });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "pending_review" } });
  const approvals = createApprovals(f.context, action => onApproved(f.context, action));
  const approval = await approvals.create({ moduleId: f.local.moduleId!, action: "activate_module", title: "Exact candidate", detail: "", preview: "Exact source", payload: { kind: "activate_module", moduleId: f.local.moduleId!, hash: f.release.hash } });
  await f.db.module.update({ where: { id: f.local.moduleId! }, data: { activationId: "new-identity" } });
  await expect(approvals.resolve(approval.id, { decision: "approve", scope: "once" }, "cli")).rejects.toThrow("Approved active identity changed");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).executionFenceAt).toBeNull();
  await buildPending(f.context); await refreshInstallationReceipts(f.ports, f.context.workspaceId);
  expect(await f.select("review")).toMatchObject({ status: "failed" });
});

test("identity drift during startup is rejected before activation", async () => {
  const f = await fixture(); await f.select("during-tests");
  const sandbox = f.ports.sandbox!, start = sandbox.startModule!;
  const process = start;
  f.ports.sandbox = { ...sandbox, startModule: input => {
    const result = process(input);
    result.exited = result.exited.then(async exit => {
      await f.db.module.update({ where: { id: f.local.moduleId! }, data: { activationId: "changed-during-startup" } });
      return exit;
    });
    return result;
  } };
  await buildPending(f.context);
  expect(await f.select("during-tests")).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Approved active identity changed") } });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
});

test("an old approved release cannot be reused as a new exact update approval", async () => {
  const f = await fixture(); await f.select("first"); await buildPending(f.context);
  const api = createStewardService(f.ports).forWorkspace(f.context.workspaceId);
  await api.modules.rollback(f.local.moduleId!, f.local.hash);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
  expect(await f.select("after-rollback")).toMatchObject({ status: "failed" });
  await buildPending(f.context);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
});

test("installation rejects source/hash/caller overrides and removed exact mode", async () => {
  const f = await fixture();
  for (const extra of [{ sourceCommit: f.local.hash }, { hash: "a".repeat(64) }, { caller: owner }, { exactRelease: true }]) {
    await expect(installExternal(f.ports, f.context.workspaceId, { ...f.request("forged"), ...extra })).rejects.toMatchObject({ code: "invalid" });
  }
  await expect(installExternal(f.ports, f.context.workspaceId, { ...f.request("public"), mode: "exact-release" } as never)).rejects.toMatchObject({ code: "invalid" });
});

test("selected material stays queued until its installation checks complete", async () => {
  const f = await fixture();
  expect(await installExternal(f.ports, f.context.workspaceId, f.request("pinned"))).toMatchObject({ status: "building", hash: f.release.hash });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash).toBe(f.local.hash);
});

async function alternateApproved(f: Awaited<ReturnType<typeof fixture>>) {
  const root = join(f.ports.dataDir, "alternate");
  await cp(f.code, join(root, "pi"), { recursive: true });
  await writeFile(join(root, "pi/index.ts"), "// intermediate source\nexport {};\n");
  const alternate = await propose(f.context, { root, dir: "pi", intent: { changes: ["Intermediate"] } }, "user");
  await buildPending(f.context);
  const api = createStewardService(f.ports).forWorkspace(f.context.workspaceId);
  await api.modules.rollback(f.local.moduleId!, f.local.hash);
  return { alternate, api };
}

test.each([false, true])("exact drain preserves unknown stop; changed lifecycle identity rejects old key and permits fresh selection (returnToA=%s)", async returnToA => {
  const f = await fixture(), { alternate, api } = await alternateApproved(f);
  const initial = await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } });
  const session = await f.db.agentContext.create({ data: { workspaceId: f.context.workspaceId, ownerId: "owner", moduleId: f.local.moduleId!, hash: f.local.hash } });

  const run = await f.db.run.create({ data: { workspaceId: f.context.workspaceId, sessionId: session.id, lane: "background", trigger: "module", provider: "fixture", tokenHash: crypto.randomUUID(), prompt: "offline", cwd: f.ports.dataDir, status: "running", startedAt: f.ports.now() } });
  const runs = createRuns(f.ports, f.context.workspaceId);
  await f.db.providerLaunch.create({ data: { runId: run.id, digest: "lost-observer-launch" } });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: null });
  await f.select("draining"); await buildPending(f.context);
  expect(await f.select("draining")).toMatchObject({ status: "pending_approval", approvalId: null });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.local.moduleId!, hash: f.release.hash } } })).toMatchObject({ status: "pending_review", report: { activationWait: { activeHash: f.local.hash, activationId: initial.activationId } } });
  await buildPending(f.context);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ stopStatus: "unknown" });
  await expect(api.modules.rollback(f.local.moduleId!, alternate.hash)).rejects.toMatchObject({ code: "conflict" });
  await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  await api.modules.rollback(f.local.moduleId!, alternate.hash);
  if (returnToA) await api.modules.rollback(f.local.moduleId!, f.local.hash);
  const changed = await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } });
  expect(changed.activationId).not.toBe(initial.activationId);
  expect(changed.activeHash).toBe(returnToA ? f.local.hash : alternate.hash);
  await buildPending(f.context);
  expect(await f.select("draining")).toMatchObject({ status: "failed", error: { message: expect.stringContaining("Approved active identity changed") } });
  if (!returnToA) await api.modules.rollback(f.local.moduleId!, f.local.hash);
  expect(await f.select("fresh-after-drain")).toMatchObject({ status: "building" });
  await buildPending(f.context);
  expect(await f.select("fresh-after-drain")).toMatchObject({ status: "installed", hash: f.release.hash });
  expect(await f.select("draining")).toMatchObject({ status: "failed" });
}, 30_000);

test("baseline changed after async material retention is rejected inside the queue write transaction", async () => {
  const f = await fixture(), { alternate, api } = await alternateApproved(f);
  const module = await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } });
  const { baseline } = await prepareExactReleaseUpdate(f.context, f.local.moduleId!, f.release, await readExactReleaseBaselineIn(f.db, module));
  let transactions = 0;
  const db = new Proxy(f.db, { get(target, property, receiver) {
    if (property !== "$transaction") return Reflect.get(target, property, receiver);
    return async (...args: Parameters<typeof target.$transaction>) => {
      if (++transactions === 2) {
        await api.modules.rollback(f.local.moduleId!, alternate.hash);
      }
      return target.$transaction(...args);
    };
  } });
  await expect(propose({ ...f.context, db }, { root: f.ports.moduleExternalResources!, dir: "pi", expectedHash: f.release.hash, expectedModuleId: f.local.moduleId!, exactReleaseUpdate: baseline, intent: { changes: ["Exact release"] } }, "user")).rejects.toThrow("Approved active identity changed");
  expect(transactions).toBe(2);
  expect(await f.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: f.local.moduleId!, hash: f.release.hash } } })).toBeNull();
}, 30_000);

test("stale candidates do not starve a healthy tail and explicit retry with a fresh key runs checks again", async () => {
  const f = await fixture();
  await assertPoisonedHeadDoesNotStarveTail({ windowSize: 3,
    seedBlockedHead: async count => {
      for (let i = 0; i < count; i++) {
        const name = `stale-${i}`, bad = await f.db.module.create({ data: { workspaceId: f.context.workspaceId, name, activeHash: "changed" } });
        await f.db.moduleVersion.create({ data: { moduleId: bad.id, hash: String(i).repeat(64), source: "user", status: "building", manifest: { name }, intent: {}, report: { tests: [], exactReleaseUpdate: { activeHash: "old", versionId: "gone", activationId: null } } } });
      }
    }, seedHealthyTail: async () => { await f.select("healthy-tail"); }, tick: async () => { await buildPending(f.context); },
    isTailProcessed: async () => (await f.db.module.findUniqueOrThrow({ where: { id: f.local.moduleId! } })).activeHash === f.release.hash });
  const g = await fixture("files");
  await assertExplicitRetryIssuesFreshAttempt({ runFailingAttempt: async () => { g.failTests(true); await g.select("first-fails"); await buildPending(g.context); return g.select("first-fails"); },
    retry: async () => { g.failTests(false); await g.select("fresh-retry"); await buildPending(g.context); }, observedDownstreamAttempts: g.tests });
  expect(await g.select("first-fails")).toMatchObject({ status: "failed" });
  expect(await g.select("fresh-retry")).toMatchObject({ status: "installed" });
}, 30_000);

test("build completion before or after receipt refresh converges; repeated and concurrent keys queue once", async () => {
  await assertInterleavedSettlementConverges({ beginRequest: async () => { const f = await fixture(); await f.select("interleaved"); return f; },
    resolveExternally: async f => { await buildPending(f.context); }, enterWaiting: async f => { await refreshInstallationReceipts(f.ports, f.context.workspaceId); },
    readFinalState: async f => ({ status: (await f.select("interleaved")).status }), isStuckWaiting: state => state.status !== "installed" });
  const f = await fixture();
  const results = await Promise.all([f.select("same"), f.select("same")]);
  expect(results.every(result => ["pending", "building"].includes(result.status))).toBe(true);
  expect(await f.db.moduleVersion.count({ where: { moduleId: f.local.moduleId!, hash: f.release.hash } })).toBe(1);
  await buildPending(f.context);
  expect(await f.select("same")).toMatchObject({ status: "installed" });
}, 30_000);
