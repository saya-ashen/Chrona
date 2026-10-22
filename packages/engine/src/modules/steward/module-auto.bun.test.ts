import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOTIFICATION_SETTINGS, type ModuleManifest } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(scope: "once" | "affair" = "affair") {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-auto-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "test", settings: { notifications: DEFAULT_NOTIFICATION_SETTINGS } } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-20T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    sandbox: { available: true, async runModule() { return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }; } } };
  const service = createStewardService(ports).forWorkspace(workspace.id), affair = await service.affairs.create({ title: "Prices" });
  const row = await db.affair.findUniqueOrThrow({ where: { id: affair.id } }), dir = join(dataDir, "affairs", row.dirName, "prices");
  await mkdir(dir);
  const manifest: ModuleManifest = { name: "prices", entry: "index.ts", tests: ["test.ts"], triggers: [{ id: "daily", schedule: { kind: "every", minutes: 60 } }], tools: [], keepAlive: false, effects: ["notify_user"], params: {}, data: { schema: 1 } };
  let revision = 0;
  const propose = async () => {
    await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "index.ts"), `entry ${revision++}`); await writeFile(join(dir, "test.ts"), "test");
    if (manifest.data.migrate) await writeFile(join(dir, manifest.data.migrate), "migrate");
    const proposal = await service.modules.propose({ affairId: affair.id, dir: "prices", intent: { changes: ["Refactor prices"], preserves: ["Rules"] } }, "user");
    await service.modules.buildPending();
    return db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } });
  };
  const first = await propose(), card = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(first.status).toBe("pending_review");
  const resolved = await service.approvals.resolve(card.id, { decision: "approve", scope });
  return { db, dataDir, ports, service, workspace, affair, manifest, propose, first, grantId: resolved.grantId! };
}

test.each(["no data", "live data", "empty schema upgrade"])("identical refactor auto-activates with affair grant: %s", async kind => {
  const f = await fixture();
  if (kind === "live data") {
    const live = join(f.dataDir, "platform/data", f.first.moduleId);
    await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "state");
  }
  if (kind === "empty schema upgrade") f.manifest.data.schema = 2;
  const version = await f.propose();
  expect(version.status).toBe("approved");
  const approval = await f.db.approval.findFirstOrThrow({ where: { payload: { path: "$.hash", equals: version.hash } } });
  expect(approval).toMatchObject({ status: "approved", grantId: f.grantId });
  expect(approval.preview).toContain("并行模拟：");
  expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: version.moduleId } })).toMatchObject({ activeHash: version.hash, status: "active" });
  expect(await f.db.generation.findFirstOrThrow({ orderBy: { seq: "desc" } })).toMatchObject({ reason: "activate", seq: 2 });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_auto_activated" } })).toMatchObject({ details: { versionId: version.id, hash: version.hash, grantId: f.grantId } });
  expect(await f.db.notification.findFirstOrThrow()).toMatchObject({ level: "digest", title: "模块 prices 已自动更新" });
  const notification = await f.db.notification.findFirstOrThrow();
  expect(notification.body).toContain("Refactor prices"); expect(notification.body).toContain("可在模块历史中回滚");
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

test.each(["no grant", "once grant", "new effect", "migration", "network", "triggers", "different", "repeated key", "activation failure"])("requires ordinary approval: %s", async kind => {
  const f = await fixture();
  await configureManualCase(f, kind);
  const version = await assertManual(f);
  const report = version.report as { replay: { status: string } };
  if (kind === "different") expect(report.replay.status).toBe("different");
  if (kind === "repeated key") expect(version.report).toMatchObject({ replay: { status: "identical" }, keyProbe: { status: "repeated", keys: ["notify_user:price"] } });
  if (["network", "triggers"].includes(kind)) expect(report.replay.status).toBe("skipped");
  if (kind === "once grant") expect(await f.db.grant.findUniqueOrThrow({ where: { id: f.grantId } })).toMatchObject({ once: true, consumedAt: null });
});
async function configureManualCase(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  if (kind === "no grant" || kind === "once grant") await f.service.grants.revoke(f.grantId);
  if (kind === "once grant") await f.db.grant.update({ where: { id: f.grantId }, data: { revokedAt: null, once: true } });
  if (kind === "new effect") f.manifest.effects.push("wake_provider");
  if (kind === "network") f.manifest.effects.push("network");
  if (kind === "triggers") f.manifest.triggers[0]!.id = "changed";
  if (kind === "migration") {
    const live = join(f.dataDir, "platform/data", f.first.moduleId);
    await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "state");
    f.manifest.data = { schema: 2, migrate: "migrate.ts" };
  }
  if (kind === "different") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: input.entry === "test.ts" || input.codeDir.endsWith(f.first.hash) ? [] : [{ type: "notify_user", key: "price", level: "digest", title: "Price", body: "Changed" }] }) });
  // Only the key probe sees an effect, so replay stays identical and the probe alone blocks.
  if (kind === "repeated key") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: input.dataDir.includes("chrona-module-probe-") ? [{ type: "notify_user", key: "price", level: "digest", title: "Price", body: "Same" }] : [] }) });
  if (kind === "activation failure") {
    const run = f.ports.sandbox!.runModule!;
    let entries = 0;
    f.ports.sandbox!.runModule = async input => {
      if (input.entry === "index.ts" && ++entries === 20) await f.service.grants.create({ action: "notify_user", mode: "never", scope: { kind: "affair", affairId: f.affair.id } });
      return run(input);
    };
  }
}

test.each(["auto", "notify_after"] as const)("explicit %s policy uses its non-once grant", async mode => {
  const f = await fixture();
  await f.service.grants.revoke(f.grantId);
  const grant = await f.service.grants.create({ action: "activate_module", mode, scope: { kind: "affair", affairId: f.affair.id } });
  const version = await f.propose();
  expect(version.status).toBe("approved");
  expect(await f.db.approval.findFirstOrThrow({ where: { grantId: grant.id } })).toMatchObject({ status: "approved" });
});
