import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOTIFICATION_SETTINGS, type ModuleManifest } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testModuleSandbox } from "./module-test-process";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(scope: "once" | "always" = "always", network = false) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-auto-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "test", settings: { notifications: DEFAULT_NOTIFICATION_SETTINGS } } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-20T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    sandbox: { available: true, isolated: true, async runModule() { return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }; } } };
  ports.sandbox!.startModule = testModuleSandbox(input => ports.sandbox!.runModule!(input)).startModule;
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const root = join(dataDir, "sessions", "test"), dir = join(root, "prices");
  await mkdir(dir, { recursive: true });
  const manifest: ModuleManifest = { dynamicSchedules: false, content: false, secrets: [], packages: [], name: "prices", entry: "index.ts", tests: ["test.ts"], triggers: [{ id: "daily", schedule: { kind: "every", minutes: 60 } }], tools: [], keepAlive: false, effects: network ? ["notify_user", "network"] : ["notify_user"], params: {}, data: { schema: 1 } };
  let revision = 0;
  const propose = async () => {
    await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "index.ts"), `entry ${revision++}`); await writeFile(join(dir, "test.ts"), "test");
    if (manifest.data.migrate) await writeFile(join(dir, manifest.data.migrate), "migrate");
    const proposal = await service.modules.propose({ root, dir: "prices", intent: { changes: ["Refactor prices"], preserves: ["Rules"] } }, "user");
    await service.modules.buildPending();
    return db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } });
  };
  const first = await propose(), card = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(first.status).toBe("pending_review");
  const resolved = await service.approvals.resolve(card.id, { decision: "approve", scope });
  return { db, dataDir, ports, service, workspace, manifest, propose, first, grantId: resolved.grantId! };
}

test.each(["no data", "live data", "empty schema upgrade", "changed triggers", "changed behavior", "existing network"])("tested update auto-activates with module grant: %s", async kind => {
  const f = await fixture("always", kind === "existing network");
  if (kind === "live data") {
    const live = join(f.dataDir, "platform/data", f.first.moduleId);
    await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "state");
  }
  if (kind === "empty schema upgrade") f.manifest.data.schema = 2;
  if (kind === "changed triggers") f.manifest.triggers[0]!.id = "changed";
  if (kind === "changed behavior") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: input.entry === "test.ts" ? [] : [{ type: "notify_user", key: `price:${JSON.stringify(input.input)}`, level: "digest", title: "Price", body: "Changed" }] }) });
  const version = await f.propose();
  expect(version.status).toBe("approved");
  const approval = await f.db.approval.findFirstOrThrow({ where: { payload: { path: "$.hash", equals: version.hash } } });
  expect(approval).toMatchObject({ status: "approved", grantId: f.grantId });
  expect(approval.preview).toContain("代码差异：");
  expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: version.moduleId } })).toMatchObject({ activeHash: version.hash, status: "active" });
  expect(await f.db.generation.findFirstOrThrow({ orderBy: { seq: "desc" } })).toMatchObject({ reason: "activate", seq: 2 });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_auto_activated" } })).toMatchObject({ details: { versionId: version.id, hash: version.hash, grantId: f.grantId } });
  expect(await f.db.notification.findFirstOrThrow()).toMatchObject({ level: "digest", title: "模块 prices 已自动更新" });
  const notification = await f.db.notification.findFirstOrThrow();
  expect(notification.body).toContain("Refactor prices"); expect(notification.body).toContain("Rules");
  expect(notification.body).toContain(`版本 hash: ${version.hash}`); expect(notification.body).toContain("可在模块历史中回滚");
});

async function assertManual(f: Awaited<ReturnType<typeof fixture>>) {
  const version = await f.propose();
  expect(version.status).toBe("pending_review");
  const cards = await f.db.approval.findMany({ where: { status: "open" } });
  expect(cards).toHaveLength(1); expect(cards[0]!.payload).toMatchObject({ hash: version.hash });
  expect(await f.db.generation.count()).toBe(1);
  expect(await f.db.approval.count({ where: { status: "approved" } })).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "module_auto_activated" } })).toBe(0);
  expect(await f.db.notification.count()).toBe(0);
  return version;
}

test.each(["no grant", "once grant", "new effect", "migration", "network", "repeated key", "probe failure", "activation failure"])("requires ordinary approval: %s", async kind => {
  const f = await fixture();
  await configureManualCase(f, kind);
  const version = await assertManual(f);
  if (kind === "repeated key") expect(version.report).toMatchObject({ keyProbe: { status: "repeated", keys: ["notify_user:price"] } });
  if (kind === "probe failure") expect(version.report).toMatchObject({ keyProbe: { status: "skipped", reason: "entry failed or invalid output" } });
  if (kind === "once grant") expect(await f.db.grant.findUniqueOrThrow({ where: { id: f.grantId } })).toMatchObject({ once: true, consumedAt: null });
});
async function configureManualCase(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  if (kind === "no grant" || kind === "once grant") await f.service.grants.revoke(f.grantId);
  if (kind === "once grant") await f.db.grant.update({ where: { id: f.grantId }, data: { revokedAt: null, once: true } });
  if (kind === "new effect") f.manifest.effects.push("wake_provider");
  if (kind === "network") f.manifest.effects.push("network");
  if (kind === "migration") {
    const live = join(f.dataDir, "platform/data", f.first.moduleId);
    await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "state");
    f.manifest.data = { schema: 2, migrate: "migrate.ts" };
  }
  if (kind === "probe failure") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: input.dataDir.includes("chrona-module-probe-") ? "invalid" : '{"effects":[]}' });
  // A repeated key blocks automatic activation even when smoke checks pass.
  if (kind === "repeated key") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: input.dataDir.includes("chrona-module-probe-") ? [{ type: "notify_user", key: "price", level: "digest", title: "Price", body: "Same" }] : [] }) });
  if (kind === "activation failure") {
    const run = f.ports.sandbox!.runModule!;
    let entries = 0;
    f.ports.sandbox!.runModule = async input => {
      if (input.entry === "index.ts" && ++entries === 3) await f.service.grants.create({ action: "notify_user", mode: "never", scope: { kind: "module", moduleId: f.first.moduleId } });
      return run(input);
    };
  }
}

test.each(["tests", "smoke"])("failed %s rejects the update despite a module grant", async kind => {
  const f = await fixture();
  f.ports.sandbox!.runModule = async input => {
    const failed = kind === "tests" ? input.entry === "test.ts" : input.dataDir.includes("chrona-module-smoke-");
    return { status: failed ? "failed" : "succeeded", exitCode: failed ? 1 : 0, output: '{"effects":[]}', error: failed ? "failed check" : null };
  };
  const version = await f.propose();
  expect(version.status).toBe("rejected");
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ activeHash: f.first.hash });
  expect(await f.db.audit.count({ where: { kind: "module_auto_activated" } })).toBe(0);
  expect(await f.db.notification.count()).toBe(0);
});

test.each(["auto", "notify_after"] as const)("explicit %s policy uses its non-once grant", async mode => {
  const f = await fixture();
  await f.service.grants.revoke(f.grantId);
  const grant = await f.service.grants.create({ action: "activate_module", mode, scope: { kind: "module", moduleId: f.first.moduleId } });
  const version = await f.propose();
  expect(version.status).toBe("approved");
  expect(await f.db.approval.findFirstOrThrow({ where: { grantId: grant.id } })).toMatchObject({ status: "approved" });
});
