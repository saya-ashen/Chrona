import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { callsSettled, runDueCalls } from "./module-calls";
import { handleModuleCall } from "./module-effects";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** v2-16: module credentials and decisions a module asks the user for. */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-requests-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const w = (await db.workspace.create({ data: { name: "requests" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-27T03:00:00Z"), publicUrl: null };
  const api = createStewardService(ports).forWorkspace(w);
  async function moduleNamed(name: string, part: Record<string, unknown>) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], ...part });
    const module = await db.module.create({ data: { workspaceId: w, name, activeHash: `${name}-1` } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-1`, manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    let id = 0;
    const call = async (target: string, args: Record<string, string>, async?: { key: string }) => {
      const reply = await handleModuleCall(ports, { workspaceId: w, moduleId: module.id, hash: `${name}-1`, manifest }, { id: String(++id), method: "call", params: { target, args, ...(async ? { mode: "async", key: async.key, reply: true } : { mode: "sync", reply: false }) } });
      if ("error" in reply) throw reply.error;
      return (reply as { result: unknown }).result as Record<string, unknown> & { output?: unknown };
    };
    return { module, manifest, call };
  }
  // Async calls also drain in the background as soon as they are queued.
  const settle = async () => { await callsSettled(ports); await runDueCalls(ports, w); await callsSettled(ports); };
  return { db, dataDir, ports, w, api, moduleNamed, settle };
}

test("any module may declare a credential the user saves on the page; values never come back", async () => {
  const f = await fixture();
  const trader = await f.moduleNamed("trader", { effects: ["network"], secrets: ["okx_demo"], tools: [{ name: "status", description: "s", parameters: { type: "object", properties: {}, required: [] } }] });
  const page = await f.moduleNamed("page", { uses: ["chat.send", "secrets.set", "secrets.remove", "secrets.list"] });
  const other = await f.moduleNamed("other", { tools: trader.manifest.tools, uses: ["secrets.set"] });
  expect(isEntryModule(trader.manifest)).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...trader.manifest, secrets: ["qq_bot"] }).success).toBe(false);

  await expect(trader.call("secrets.get", { name: "okx_demo" })).rejects.toMatchObject({ code: "unavailable" });
  await expect(page.call("secrets.set", { name: "okx_demo", value: "[1]" })).rejects.toMatchObject({ code: "invalid" });
  await expect(page.call("secrets.set", { name: "qq_bot", value: '{"a":"b"}' })).rejects.toMatchObject({ code: "invalid" });
  await expect(other.call("secrets.set", { name: "okx_demo", value: '{"a":"b"}' })).rejects.toMatchObject({ code: "forbidden" });
  expect((await page.call("secrets.set", { name: "okx_demo", value: JSON.stringify({ apiKey: "k-secret", passphrase: "p" }) })).output).toEqual({ name: "okx_demo", configured: true });
  expect((await stat(join(f.dataDir, "secrets", "okx_demo.json"))).mode & 0o777).toBe(0o600);

  const list = (await page.call("secrets.list", {})).output;
  expect(list).toEqual([{ name: "okx_demo", configured: true, updatedAt: expect.any(String), modules: ["trader"] }]);
  expect((await trader.call("secrets.get", { name: "okx_demo" })).output).toEqual({ value: { apiKey: "k-secret", passphrase: "p" } });
  await expect(page.call("secrets.get", { name: "okx_demo" })).rejects.toMatchObject({ code: "forbidden" });
  // Neither the value written nor the value read is kept in call records.
  expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain("k-secret");
  // v2-18: the change shows in the activity trail by name only.
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "secret_set" } })).toMatchObject({ actorKey: "user", details: { name: "okx_demo" } });
  expect(JSON.stringify(await f.db.audit.findMany())).not.toContain("k-secret");

  await page.call("secrets.remove", { name: "okx_demo" });
  await expect(trader.call("secrets.get", { name: "okx_demo" })).rejects.toMatchObject({ code: "unavailable" });
});

test("approvals.request waits for the user's decision and sends it back; approved once, no standing grant", async () => {
  const f = await fixture();
  const trader = await f.moduleNamed("trader", { uses: ["approvals.request", "approvals.status"], tools: [{ name: "start", description: "s", parameters: { type: "object", properties: {}, required: [] } }] });
  const other = await f.moduleNamed("other", { uses: ["approvals.status"], tools: trader.manifest.tools });
  expect(isEntryModule(trader.manifest)).toBe(false);
  await expect(trader.call("approvals.request", { title: "开始实验" })).rejects.toMatchObject({ code: "invalid" });

  const queued = await trader.call("approvals.request", { title: "开始实验", detail: "24 小时", preview: "本金 2000 USDT" }, { key: "exp-1" });
  expect(queued).toMatchObject({ status: "queued" });
  await f.settle();
  const call = () => f.db.moduleInvocation.findUniqueOrThrow({ where: { id: String(queued.callId) } });
  expect(await call()).toMatchObject({ status: "waiting", leaseUntil: null });
  const card = await f.db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(card).toMatchObject({ action: "modify_external", moduleId: trader.module.id, title: "trader：开始实验", preview: "本金 2000 USDT", payload: { kind: "module_request", hash: "trader-1", call: queued.callId } });

  // A repeat of the same request and a recovered delivery find the same card.
  expect((await trader.call("approvals.request", { title: "开始实验" }, { key: "exp-1" })).callId).toBe(queued.callId);
  await f.db.moduleInvocation.update({ where: { id: String(queued.callId) }, data: { status: "running", leaseUntil: new Date(0), leaseToken: "lost" } });
  await f.settle(); await f.settle();
  expect(await call()).toMatchObject({ status: "waiting" });
  expect(await f.db.approval.count()).toBe(1);

  await expect(f.api.approvals.resolve(card.id, { decision: "approve", scope: "always" }, "web")).rejects.toMatchObject({ code: "invalid" });
  await f.api.approvals.resolve(card.id, { decision: "approve", scope: "once" }, "web");
  expect(await call()).toMatchObject({ status: "succeeded", output: { approval: card.id, decision: "approved" } });
  expect(await f.db.grant.count()).toBe(0);
  expect((await trader.call("approvals.status", { approval: card.id })).output).toMatchObject({ approval: card.id, status: "approved", hash: "trader-1" });
  await expect(other.call("approvals.status", { approval: card.id })).rejects.toMatchObject({ code: "not_found" });

  const second = await trader.call("approvals.request", { title: "再开一次" }, { key: "exp-2" });
  await f.settle();
  const next = await f.db.approval.findFirstOrThrow({ where: { status: "open" } });
  await f.api.approvals.resolve(next.id, { decision: "deny", scope: "once" }, "web");
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: String(second.callId) } })).toMatchObject({ status: "succeeded", output: { approval: next.id, decision: "denied" } });
});

test("v2-17: modules.permissions gathers one app's capabilities, grants, credentials, model use and approvals, visible to modules", async () => {
  const f = await fixture();
  const trader = await f.moduleNamed("trader", { effects: ["network"], model: { tier: "strong", maxCalls: 1, maxOutputTokens: 100 }, secrets: ["okx_demo"], uses: ["provider.complete", "approvals.request"], tools: [{ name: "start", description: "s", parameters: { type: "object", properties: {}, required: [] } }] });
  const web = await f.moduleNamed("web", { uses: ["chat.send", "secrets.set"] });
  const other = await f.moduleNamed("other", { uses: ["chat.send"] });
  await f.db.workspace.update({ where: { id: f.w }, data: { settings: { moduleModel: { models: { strong: { model: "fake/m", thinking: "high" } }, maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 10, timeoutMs: 5000, moduleDailyCalls: { trader: 96 } } } } });
  await web.call("secrets.set", { name: "okx_demo", value: JSON.stringify({ apiKey: "k-secret" }) });
  const grant = await f.db.grant.create({ data: { workspaceId: f.w, action: "modify_external", mode: "allow", scope: { kind: "module", moduleId: trader.module.id } } });
  await f.api.approvals.create({ action: "modify_external", moduleId: trader.module.id, title: "trader：开始", detail: "", preview: "", payload: {} });
  const view = (await web.call("modules.permissions", { module: "trader" })).output;
  expect(view).toMatchObject({
    module: "trader", capabilities: ["联网", "调用 provider.complete", "调用 approvals.request", "读取凭据 okx_demo"],
    secrets: [{ name: "okx_demo", configured: true }], model: { tier: "strong", target: { model: "fake/m", thinking: "high" }, dailyCap: 96, today: { calls: 0 } },
    grants: [{ id: grant.id, action: "modify_external", mode: "allow" }], approvals: [{ title: "trader：开始", status: "open" }],
  });
  expect(JSON.stringify(view)).not.toContain("k-secret");
  expect((await other.call("modules.permissions", { module: "trader" })).output).toEqual(view);
});
