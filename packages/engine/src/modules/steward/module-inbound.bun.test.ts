import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import { createLocalTestSource } from "../../../../integrations/src/steward/local-test-source";
import { createStewardService } from "./service";
import { createTick } from "./tick";
import { processModuleInbound } from "./module-inbound";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { testModuleSandbox } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-module-inbound-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  let time = new Date("2026-10-21T04:00:00Z"), handled: boolean | undefined = true, fail = false;
  const source = createLocalTestSource(), calls: unknown[] = [];
  const ports: StewardPorts = { db, dataDir, now: () => time, deliveries: [], chat: null, publicUrl: null, connectors: [source.adapter],
    sandbox: testModuleSandbox(async input => {
      calls.push(input);
      return { status: fail ? "failed" : "succeeded", exitCode: fail ? 1 : 0, error: fail ? "failed" : null,
        output: JSON.stringify({ handled, effects: [{ type: "notify_user", key: "sorted", level: "now", title: "邮件已整理", body: "已处理" }] }) };
    }),
  };
  cleanups.push(() => moduleSupervisor(ports).stop());
  const workspaceId = (await db.workspace.create({ data: { name: "test" } })).id;
  const api = createStewardService(ports).forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Mail" });
  const connector = await api.connectors.create({ kind: "local_test", label: "mail", affairId: affair.id });
  const module = await db.module.create({ data: { workspaceId, affairId: affair.id, name: "mail-sort", activeHash: "hash" } });
  const manifest = { name: module.name, entry: "index.ts", tests: ["test.ts"], effects: ["notify_user"], triggers: [{ id: "mail", inbound: { connector: connector.id, match: { from: "*@shop.example" } } }] };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const push = async (externalId = "first", from = "buyer@SHOP.example", body = "mail body") => {
    source.push([{ externalId, from, subject: externalId, body, receivedAt: time.toISOString(), url: null }]);
    await api.connectors.sync(connector.id);
    return db.inboundItem.findUniqueOrThrow({ where: { connectorId_externalId: { connectorId: connector.id, externalId } } });
  };
  return { db, ports, api, workspaceId, module, connector, calls, push, manifest,
    run: () => processModuleInbound(ports, workspaceId),
    advance: (ms: number) => { time = new Date(time.getTime() + ms); },
    handled: (value: boolean | undefined) => { handled = value; }, fail: () => { fail = true; } };
}
test("inbound handled produces notification without a Provider run; false falls back to batching", async () => {
  const f = await fixture();
  const first = await f.push();
  expect(first.status).toBe("module");
  const tick = createTick(f.ports);
  expect((await tick()).failures).toEqual([]); await tick.settled();
  expect(await f.db.inboundItem.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "delivered", action: "module", ruleNote: "模块 mail-sort 已处理", leaseToken: null });
  expect(await f.db.notification.count()).toBe(1);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleRun.findFirstOrThrow()).toMatchObject({ inboundItemId: first.id, triggerId: "mail", firedAt: first.receivedAt });
  expect(f.calls[0]).toMatchObject({ network: false, input: { trigger: { kind: "inbound", firedAt: first.receivedAt.toISOString(), item: { body: "mail body", externalId: "first" } }, params: {} } });
  f.handled(false); const second = await f.push("second"); await f.run();
  expect(await f.db.inboundItem.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "new", deliverAt: second.deliverAt, leaseToken: null });
  f.advance(RUN_LIMITS.inboundBatchWindowMs); await f.api.connectors.flush(f.connector.id);
  expect(await f.db.run.count()).toBe(1);
});
test("a reply without handled does not swallow mail", async () => {
  const f = await fixture(); f.handled(undefined);
  const item = await f.push(); await f.run();
  expect(await f.db.inboundItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "new", leaseToken: null });
  expect((await f.db.moduleRun.findFirstOrThrow()).output).toEqual({});
});
test("ignore, digest and no-match retain connector behavior; wake_now routes before flush", async () => {
  const f = await fixture(), files = await f.api.affairs.files(f.module.affairId);
  await files.intake([{ path: ".chrona/rules.json", bytes: Buffer.from(JSON.stringify({ rules: ["ignore", "digest_only", "wake_now"].map(action => ({ match: { subject: action }, action })), default: "batch" })) }], "rules");
  expect((await f.push("ignore")).status).toBe("ignored");
  expect((await f.push("digest_only")).status).toBe("delivered");
  expect((await f.push("no-match", "other@example.com")).status).toBe("new");
  expect((await f.push("wake_now")).status).toBe("module");
  await f.run(); expect(f.calls.length).toBe(1); expect(await f.db.run.count()).toBe(0);
});
test("failures fall back and three failures pause once across module runs", async () => {
  const f = await fixture(); f.fail();
  for (let i = 0; i < 3; i++) {
    const item = await f.push(String(i)); await f.run();
    expect(await f.db.inboundItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "new", leaseToken: null });
    f.advance(1);
  }
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "paused" });
  expect(await f.db.notification.count({ where: { title: "模块连续失败，已暂停" } })).toBe(1);
  expect((await f.push("paused")).status).toBe("new");
});
test("concurrent ticks execute once and expired lease is reclaimed", async () => {
  const f = await fixture(), item = await f.push();
  await Promise.all([f.run(), f.run()]); expect(f.calls.length).toBe(1);
  const second = await f.push("expired");
  await f.db.inboundItem.update({ where: { id: second.id }, data: { leaseToken: "old", leaseUntil: new Date(f.ports.now().getTime() + 1000) } });
  await f.run(); expect(f.calls.length).toBe(1);
  f.advance(1001); await f.run(); expect(f.calls.length).toBe(2);
  expect(await f.db.moduleRun.count({ where: { inboundItemId: item.id } })).toBe(1);
});
test.each(["paused", "migrating", "unmatched"])("queued mail survives %s and receivedAt-based timeout ignores createdAt", async status => {
  const f = await fixture(), item = await f.push();
  if (status === "unmatched") await f.db.moduleVersion.updateMany({ data: { manifest: { ...f.manifest, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] } } });
  else await f.db.module.update({ where: { id: f.module.id }, data: { status } });
  await f.run();
  expect((await f.db.inboundItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(status === "migrating" ? "module" : "new");
  expect(f.calls.length).toBe(0);
  if (status === "migrating") {
    f.advance(30 * 60000 + 1); await f.run();
    expect((await f.db.inboundItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("new");
  }
});
test("migration completion retries queued mail and processing is capped at ten oldest items", async () => {
  const f = await fixture();
  for (let i = 0; i < 11; i++) { await f.push(`mail-${i}`); f.advance(1); }
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "migrating" } });
  await f.run(); expect(f.calls.length).toBe(0);
  expect(await f.db.inboundItem.count({ where: { status: "module" } })).toBe(11);
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "active" } });
  await f.run(); expect(f.calls.length).toBe(10);
  expect((f.calls[0] as { input: { trigger: { item: { externalId: string } } } }).input.trigger.item.externalId).toBe("mail-0");
  expect(await f.db.inboundItem.count({ where: { status: "module" } })).toBe(1);
  await f.run(); expect(f.calls.length).toBe(11);
});
test("schedule and inbound failures share the three-run pause counter", async () => {
  const f = await fixture();
  await f.db.moduleRun.create({ data: { moduleId: f.module.id, hash: "hash", triggerId: "daily", firedAt: f.ports.now(), exitCode: 1, error: "schedule failed", createdAt: f.ports.now() } });
  f.fail();
  for (let i = 0; i < 2; i++) { f.advance(1); await f.push(`failed-${i}`); await f.run(); }
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).status).toBe("paused");
  expect(await f.db.moduleRun.count()).toBe(3);
});
test("body is UTF-8 truncated to 64 KiB without connector headers", async () => {
  const f = await fixture(); await f.push("large", "a@shop.example", "文".repeat(30000)); await f.run();
  const call = f.calls[0] as { input: { trigger: { item: { body: string } } } };
  expect(Buffer.byteLength(call.input.trigger.item.body)).toBeLessThanOrEqual(64 * 1024);
  expect(call.input.trigger.item.body).not.toContain("From:");
  expect(call.input.trigger.item.body).not.toContain("�");
});
test("a constant module key does not swallow the next mail", async () => {
  const f = await fixture();
  const first = await f.push("first");
  f.advance(1);
  const second = await f.push("second");
  await f.run();
  expect(await f.db.notification.count({ where: { title: "邮件已整理" } })).toBe(2);
  const calls = await f.db.moduleCall.findMany({ orderBy: { key: "asc" } });
  expect(calls.map(call => ({ key: call.key, status: call.status }))).toEqual([first, second].map(item => ({ key: `inbound:${item.id}:sorted`, status: "executed" })).sort((a, b) => a.key.localeCompare(b.key)));
});
