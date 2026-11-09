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
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], ...part });
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

for (const name of ["okx_demo", "qq_bot"]) test(`${name}: any module may declare a user-saved credential; values never enter records`, async () => {
  const f = await fixture();
  const trader = await f.moduleNamed("trader", { effects: ["network"], secrets: [name], tools: [{ name: "status", description: "s", parameters: { type: "object", properties: {}, required: [] } }] });
  const page = await f.moduleNamed("page", { uses: ["*", "secrets.set", "secrets.remove", "secrets.list"] });
  const other = await f.moduleNamed("other", { tools: trader.manifest.tools, uses: ["secrets.set"] });
  expect(isEntryModule(trader.manifest)).toBe(false);

  await expect(trader.call("secrets.get", { name })).rejects.toMatchObject({ code: "unavailable" });
  await expect(page.call("secrets.set", { name, value: "[1]" })).rejects.toMatchObject({ code: "invalid" });
  await expect(other.call("secrets.set", { name, value: '{"a":"b"}' })).rejects.toMatchObject({ code: "forbidden" });
  expect((await page.call("secrets.set", { name, value: JSON.stringify({ apiKey: "k-secret", passphrase: "p" }) })).output).toEqual({ name, configured: true });
  expect((await stat(join(f.dataDir, "secrets", `${name}.json`))).mode & 0o777).toBe(0o600);

  const list = (await page.call("secrets.list", {})).output;
  expect(list).toEqual([{ name, configured: true, updatedAt: expect.any(String), modules: ["trader"] }]);
  expect((await trader.call("secrets.get", { name })).output).toEqual({ value: { apiKey: "k-secret", passphrase: "p" } });
  await expect(page.call("secrets.get", { name })).rejects.toMatchObject({ code: "forbidden" });
  // Neither the value written nor the value read is kept in call records.
  expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain("k-secret");
  // v2-18: the change shows in the activity trail by name only.
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "secret_set" } })).toMatchObject({ actorKey: "user", details: { name } });
  expect(JSON.stringify(await f.db.audit.findMany())).not.toContain("k-secret");

  await page.call("secrets.remove", { name });
  await expect(trader.call("secrets.get", { name })).rejects.toMatchObject({ code: "unavailable" });
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

test("installed identities and contracts are readable; credentials and approvals require the current owner", async () => {
  const f = await fixture();
  const trader = await f.moduleNamed("trader", { effects: ["network"], secrets: ["okx_demo"], uses: ["approvals.request"], tools: [{ name: "start", description: "s", visibility: ["modules", "owner"], parameters: { type: "object", properties: {}, required: [] } }] });
  const web = await f.moduleNamed("web", { uses: ["*"] });
  const other = await f.moduleNamed("other", {});
  await web.call("secrets.set", { name: "okx_demo", value: JSON.stringify({ apiKey: "k-secret" }) });
  const approval = await f.api.approvals.create({ action: "modify_external", moduleId: trader.module.id, title: "trader：开始", detail: "", preview: "", payload: {} });
  const view = (await web.call("modules.list", {})).output;
  expect(view).toContainEqual(expect.objectContaining({ id: trader.module.id, name: "trader", activeHash: "trader-1", builtin: false, origin: "external", capabilities: expect.objectContaining({ remove: true }), versions: [expect.objectContaining({ hash: "trader-1", status: "approved" })] }));
  expect((await other.call("modules.list", {})).output).toEqual(view);
  expect((await other.call("modules.tools", { query: "trader.start" })).output).toMatchObject([{ target: "trader.start", moduleId: trader.module.id, hash: "trader-1", contractHash: expect.any(String) }]);
  expect((await other.call("modules.reference", { target: "trader.start" })).output).toMatchObject({ target: "trader.start", source: { kind: "module", hash: "trader-1" }, admission: { visibility: ["modules", "owner"], uses: "trader.start" } });
  const credentials = (await web.call("secrets.list", {})).output;
  const approvals = (await web.call("approvals.list", {})).output;
  expect(credentials).toEqual([{ name: "okx_demo", configured: true, updatedAt: expect.any(String), modules: ["trader"] }]);
  expect(approvals).toContainEqual(expect.objectContaining({ id: approval.id, title: "trader：开始", status: "open" }));
  for (const target of ["secrets.list", "approvals.list"]) await expect(other.call(target, {})).rejects.toMatchObject({ code: "forbidden" });
  for (const app of [web, other]) {
    for (const target of ["approvals.grants", "approvals.revoke-grant", "modules.permissions"]) await expect(app.call(target, {})).rejects.toMatchObject({ code: "not_found" });
  }
  expect(JSON.stringify({ view, credentials, approvals, calls: await f.db.moduleInvocation.findMany(), audits: await f.db.audit.findMany() })).not.toContain("k-secret");
});
