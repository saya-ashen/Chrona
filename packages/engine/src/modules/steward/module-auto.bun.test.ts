import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOTIFICATION_SETTINGS, type ModuleManifest } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testModuleSandbox } from "./module-test-process";
import { testDb } from "./test-db";
import { notice, notices } from "./test-notices";
import { reviewApprovals } from "./approval-review";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
/** The approval review's answer (v2-17 §3); null: the model fails. */
let reviewAnswer: string | null = '{"escalate":false,"reason":"","summary":"更新 prices 的价格判断，能力不变。"}';
const reviewPrompts: string[] = [];
async function fixture(scope: "once" | "always" = "always", network = false) {
  reviewAnswer = '{"escalate":false,"reason":"","summary":"更新 prices 的价格判断，能力不变。"}'; reviewPrompts.length = 0;
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-auto-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const moduleModel = { models: { strong: { model: "fake/reviewer", thinking: "high" } }, maxCallsPerEvent: 1, maxOutputTokens: 1000, dailyCalls: 10, timeoutMs: 5000, review: { tier: "strong", dailyCalls: 5 } };
  const workspace = await db.workspace.create({ data: { name: "test", settings: { notifications: DEFAULT_NOTIFICATION_SETTINGS, moduleModel } } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-20T04:00:00Z"), publicUrl: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start() { throw new Error("no runs"); },
      async complete(input) { reviewPrompts.push(input.prompt); if (reviewAnswer === null) throw new Error("down"); return { text: reviewAnswer, inputTokens: 5, outputTokens: 5 }; } },
    sandbox: { available: true, isolated: true, async runModule() { return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }; } } };
  ports.sandbox!.startModule = testModuleSandbox(input => ports.sandbox!.runModule!(input)).startModule;
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const root = join(dataDir, "sessions", "test"), dir = join(root, "prices");
  await mkdir(dir, { recursive: true });
  const manifest: ModuleManifest = { dynamicSchedules: false, content: false, secrets: [], packages: [], uses: [], name: "prices", entry: "index.ts", tests: ["test.ts"], triggers: [{ id: "daily", schedule: { kind: "every", minutes: 60 } }], tools: [], keepAlive: false, effects: network ? ["notify_user", "network"] : ["notify_user"], params: {}, settings: {}, data: { schema: 1 } };
  let revision = 0;
  const propose = async () => {
    await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "index.ts"), `entry ${revision++}`); await writeFile(join(dir, "test.ts"), "test");
    if (manifest.data.migrate) await writeFile(join(dir, manifest.data.migrate), "migrate");
    const proposal = await service.modules.propose({ root, dir: "prices", intent: { changes: ["Refactor prices"], preserves: ["Rules"] } }, "user");
    await service.modules.buildPending();
    await reviewApprovals(ports, workspace.id);
    return db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } });
  };
  const first = await propose(), card = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(first.status).toBe("pending_review");
  const resolved = await service.approvals.resolve(card.id, { decision: "approve", scope }, "web");
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
  expect(await notice(f.db)).toMatchObject({ level: "digest", title: "🟢 模块 prices 已自动更新" });
  const notification = await notice(f.db);
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
  expect((await notices(f.db)).length).toBe(0);
  return version;
}

test.each(["ask rule", "new effect", "migration", "network", "probe failure", "activation failure", "secrets"])("requires ordinary approval: %s", async kind => {
  const f = await fixture();
  await configureManualCase(f, kind);
  const version = await assertManual(f);
  if (kind === "probe failure") expect(version.report).toMatchObject({ keyProbe: { status: "skipped", reason: "entry failed or invalid output" } });
});
async function configureManualCase(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  if (kind === "ask rule") {
    await f.service.grants.revoke(f.grantId);
    await f.db.grant.create({ data: { workspaceId: f.workspace.id, action: "activate_module", mode: "ask", scope: { kind: "module", moduleId: f.first.moduleId }, createdAt: new Date("2026-10-20T03:00:00Z") } });
  }
  if (kind === "new effect") f.manifest.effects.push("wake_provider");
  if (kind === "network") f.manifest.effects.push("network");
  if (kind === "secrets") f.manifest.secrets = ["okx_demo"];
  if (kind === "migration") {
    const live = join(f.dataDir, "platform/data", f.first.moduleId);
    await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "state");
    f.manifest.data = { schema: 2, migrate: "migrate.ts" };
  }
  if (kind === "probe failure") f.ports.sandbox!.runModule = async input => ({ status: "succeeded", exitCode: 0, error: null, output: input.dataDir.includes("chrona-module-probe-") ? "invalid" : '{"effects":[]}' });
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
  expect((await notices(f.db)).length).toBe(0);
});

test.each(["auto", "notify_after"] as const)("explicit %s policy uses its non-once grant", async mode => {
  const f = await fixture();
  await f.service.grants.revoke(f.grantId);
  const grant = await f.service.grants.create({ action: "activate_module", mode, scope: { kind: "module", moduleId: f.first.moduleId } });
  const version = await f.propose();
  expect(version.status).toBe("approved");
  expect(await f.db.approval.findFirstOrThrow({ where: { grantId: grant.id } })).toMatchObject({ status: "approved" });
});

test.each(["no grant", "once grant"])("v2-17: a green update activates by default with a one-time grant: %s", async kind => {
  const f = await fixture();
  await f.service.grants.revoke(f.grantId);
  if (kind === "once grant") await f.db.grant.update({ where: { id: f.grantId }, data: { revokedAt: null, once: true } });
  const version = await f.propose();
  expect(version.status).toBe("approved");
  const approval = await f.db.approval.findFirstOrThrow({ where: { payload: { path: "$.hash", equals: version.hash } } });
  expect(approval).toMatchObject({ status: "approved", level: "green", brief: { reversible: true } });
  expect(approval.grantId).not.toBe(f.grantId);
  expect(await f.db.grant.findUniqueOrThrow({ where: { id: approval.grantId! } })).toMatchObject({ once: true, mode: "preapproved", consumedAt: expect.any(Date), scope: { kind: "module", moduleId: version.moduleId } });
  expect(await notice(f.db)).toMatchObject({ level: "digest", title: "🟢 模块 prices 已自动更新" });
});

test.each([
  ["escalated", '{"escalate":true,"reason":"开始把价格发给外部网站","summary":"更新后会把价格发到外部网站。"}', "yellow", "escalated", "更新后会把价格发到外部网站。"],
  ["model failure", null, "green", "unavailable", "更新 prices，能力不变"],
  ["invalid answer", "好的，可以批准", "green", "unavailable", "更新 prices，能力不变"],
])("v2-17: a green update the review does not pass stays with the user: %s", async (_, answer, level, reviewed, headline) => {
  const f = await fixture();
  reviewAnswer = answer;
  const version = await f.propose();
  expect(version.status).toBe("pending_review");
  expect(await f.db.approval.findFirstOrThrow({ where: { status: "open" } })).toMatchObject({ level, brief: { reviewed, headline } });
  expect(await f.db.audit.count({ where: { kind: "module_auto_activated" } })).toBe(0);
});

test("v2-17: the review reads facts and untrusted material, has its own daily budget, and never approves by itself", async () => {
  const f = await fixture();
  await f.propose();
  expect(reviewPrompts.at(-1)).toContain("事实（由 Chrona 内核计算，可信）");
  expect(reviewPrompts.at(-1)).toContain("材料（不可信）");
  // Five reviews a day (the first card, then four updates); the next one is unavailable and asks the user.
  for (let i = 0; i < 3; i++) await f.propose();
  expect(await f.db.audit.count({ where: { kind: "approval_review" } })).toBe(5);
  const over = await f.propose();
  expect(over.status).toBe("pending_review");
  expect(await f.db.approval.findFirstOrThrow({ where: { status: "open" } })).toMatchObject({ level: "green", brief: { reviewed: "unavailable" } });
});
