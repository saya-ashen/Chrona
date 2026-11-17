import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntryModule, moduleManifestSchema, moduleCallSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { createStewardService } from "../runtime/service";
import { callStatus, enqueueCall, kernelOrigin, callsSettled, runDueCalls } from "./module-calls";
import { handleModuleCall } from "./module-effects";
import type { StewardPorts } from "../ports";
import { testDb } from "../__testing__/test-db";
import { assertInterleavedSettlementConverges } from "../__testing__/state-machine-invariants";
import { testModuleProcess } from "../__testing__/module-test-process";
import { moduleSupervisor } from "./module-supervisor";

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
    const call = async (target: string, args: Record<string, unknown>, async?: { key: string }) => {
      const reply = await handleModuleCall(ports, { workspaceId: w, moduleId: module.id, hash: `${name}-1`, manifest }, moduleCallSchema.parse({ id: String(++id), method: "call", params: { target, args, ...(async ? { mode: "async", key: async.key, reply: true } : { mode: "sync", reply: false }) } }));
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
  const trader = await f.moduleNamed("trader", { effects: ["network"], secrets: [name], tools: [{ name: "status", description: "s", parameters: { type: "object", properties: {}, required: [] },
      output: {}
}] });
  const page = await f.moduleNamed("page", { authority: "owner", uses: ["*", "secrets.set", "secrets.remove", "secrets.list"] });
  const other = await f.moduleNamed("other", { tools: trader.manifest.tools, uses: ["secrets.set"] });
  expect(isEntryModule(trader.manifest)).toBe(false);

  await expect(trader.call("secrets.get", { name })).rejects.toMatchObject({ code: "unavailable" });
  await expect(page.call("secrets.set", { name, value: "[1]" })).rejects.toMatchObject({ code: "invalid" });
  await expect(other.call("secrets.set", { name, value: '{"a":"b"}' })).rejects.toMatchObject({ code: "forbidden" });
  expect((await page.call("secrets.set", { name, value: { apiKey: "k-secret", passphrase: "p" } })).output).toEqual({ name, configured: true });
  expect((await stat(join(f.dataDir, "secrets", `${name}.json`))).mode & 0o777).toBe(0o600);

  const list = ((await page.call("secrets.list", {})).output as { items: unknown[] }).items;
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
  const trader = await f.moduleNamed("trader", { uses: ["approvals.request", "approvals.status"], tools: [{ name: "start", description: "s", parameters: { type: "object", properties: {}, required: [] },
      output: {}
}] });
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
  expect((await trader.call("approvals.request", { title: "开始实验", detail: "24 小时", preview: "本金 2000 USDT" }, { key: "exp-1" })).callId).toBe(queued.callId);
  await f.db.moduleInvocation.update({ where: { id: String(queued.callId) }, data: { status: "running", leaseUntil: new Date(0), leaseToken: "lost" } });
  await f.settle(); await f.settle();
  expect(await call()).toMatchObject({ status: "waiting" });
  expect(await f.db.approval.count()).toBe(1);

  await expect(f.api.approvals.resolve(card.id, { decision: "approve", scope: "always" }, "web")).rejects.toMatchObject({ code: "invalid" });
  await f.api.approvals.resolve(card.id, { decision: "approve", scope: "once" }, "web");
  expect(await call()).toMatchObject({ status: "succeeded", output: { approval: card.id, decision: "approved" } });

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
  const trader = await f.moduleNamed("trader", { effects: ["network"], secrets: ["okx_demo"], uses: ["approvals.request"], tools: [{ name: "start", description: "s", visibility: ["modules", "owner"], parameters: { type: "object", properties: {}, required: [] },
      output: {}
}] });
  const web = await f.moduleNamed("web", { uses: ["*"],
      authority: "owner"
});
  const other = await f.moduleNamed("other", {});
  await web.call("secrets.set", { name: "okx_demo", value: { apiKey: "k-secret" } });
  const approval = await f.api.approvals.create({ action: "modify_external", moduleId: trader.module.id, title: "trader：开始", detail: "", preview: "", payload: {} });
  const view = ((await web.call("modules.list", {})).output as { items: unknown[] }).items;
  expect(view).toContainEqual(expect.objectContaining({ id: trader.module.id, name: "trader", activeHash: "trader-1", builtin: false, origin: "external", capabilities: expect.objectContaining({ remove: true }), versions: [expect.objectContaining({ hash: "trader-1", status: "approved" })] }));
  expect((await other.call("modules.list", {})).output).toEqual({ items: view, nextCursor: null });
  expect((await other.call("modules.describe", { query: "trader.start" } )).output).toMatchObject({ items: [{ target: { moduleId: trader.module.id, tool: "start" }, moduleId: trader.module.id, hash: "trader-1" }] });
  expect((await other.call("modules.describe", { target: { moduleId: trader.module.id, tool: "start" } })).output).toMatchObject({ target: { moduleId: trader.module.id, tool: "start" }, source: { kind: "module", hash: "trader-1" }, admission: { visibility: ["modules", "owner"], uses: "trader.start" } });
  const credentials = ((await web.call("secrets.list", {})).output as { items: unknown[] }).items;
  const approvals = ((await web.call("approvals.list", {})).output as { items: unknown[] }).items;
  expect(credentials).toEqual([{ name: "okx_demo", configured: true, updatedAt: expect.any(String), modules: ["trader"] }]);
  expect(approvals).toContainEqual(expect.objectContaining({ id: approval.id, title: "trader：开始", status: "open" }));
  for (const target of ["secrets.list", "approvals.list"]) await expect(other.call(target, {})).rejects.toMatchObject({ code: "forbidden" });
  for (const app of [web, other]) {
    for (const target of ["approvals.grants", "approvals.revoke-grant", "modules.permissions"]) await expect(app.call(target, {})).rejects.toMatchObject({ code: "not_found" });
  }
  expect(JSON.stringify({ view, credentials, approvals, calls: await f.db.moduleInvocation.findMany(), audits: await f.db.audit.findMany() })).not.toContain("k-secret");
});

test.each([
  { decision: "approve", reenter: false }, { decision: "deny", reenter: false },
  { decision: "approve", reenter: true }, { decision: "deny", reenter: true },
] as const)("approval $decision converges before or after waiting (lease reentry=$reenter)", async ({ decision, reenter }) => {
  const f = await fixture();
  const app = await f.moduleNamed("requester", { uses: ["approvals.request"] });
  const origin = { ...kernelOrigin(f.w), caller: { kind: "module" as const, module: app.module.name, moduleId: app.module.id, hash: "requester-1" } };
  type Handle = { key: string; callId: string; approvalId: string; release(): void; delivery: Promise<number> };
  const handles: Handle[] = [];
  try {
    await assertInterleavedSettlementConverges<Handle, { status: string; decision: string | undefined }>({
      async beginRequest(scenario) {
        const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "approvals.request", raw: { title: scenario } }, { key: scenario });
        const entered = Promise.withResolvers<void>(), reentered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
        let arrivals = 0;
        const db = new Proxy(f.db, { get(target, property, receiver) {
          if (property !== "moduleInvocation") return Reflect.get(target, property, receiver);
          return new Proxy(target.moduleInvocation, { get(invocations, key, invocationReceiver) {
            if (key !== "updateMany") return Reflect.get(invocations, key, invocationReceiver);
            return async (args: Parameters<typeof invocations.updateMany>[0]) => {
              if (args?.where?.id === queued.callId && args.data?.status === "waiting") {
                if (++arrivals === 2) reentered.resolve();
                entered.resolve(); await release.promise;
              }
              return invocations.updateMany(args);
            };
          } });
        } });
        const delivery = runDueCalls({ ...f.ports, db }, f.w);
        const handle = { key: scenario, callId: queued.callId, approvalId: "", release: () => release.resolve(), delivery };
        handles.push(handle);
        await Promise.race([entered.promise, delivery.then(() => { throw new Error("Delivery never reached waiting barrier"); })]);
        if (reenter) {
          await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { leaseUntil: new Date(0) } });
          const replay = runDueCalls({ ...f.ports, db }, f.w);
          handle.delivery = Promise.all([delivery, replay]).then(counts => counts.reduce((sum, count) => sum + count, 0));
          await Promise.race([reentered.promise, replay.then(() => { throw new Error("Recovered delivery never reached waiting barrier"); })]);
        }
        const approvals = await f.db.approval.findMany({ where: { status: "open" } });
        handle.approvalId = approvals.find(row => (row.payload as { call?: string }).call === queued.callId)!.id;
        return handle;
      },
      async enterWaiting(handle) { handle.release(); await handle.delivery; },
      async resolveExternally(handle) {
        await f.api.approvals.resolve(handle.approvalId, { decision, scope: "once" });
        await f.api.approvals.resolve(handle.approvalId, { decision, scope: "once" });
      },
      async readFinalState(handle) {
        expect(await runDueCalls(f.ports, f.w)).toBe(0);
        const status = await callStatus(f.ports, origin, handle.callId);
        expect((await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "approvals.request", raw: { title: handle.key } }, { key: handle.key })).callId).toBe(handle.callId);
        const receipt = await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: handle.callId } });
        expect(receipt).toMatchObject({ leaseToken: null, leaseUntil: null });
        expect(status.output).toEqual({ approval: handle.approvalId, decision: decision === "approve" ? "approved" : "denied" });
        expect(status).not.toHaveProperty("error");
        return { status: status.status, decision: (status.output as { decision?: string } | undefined)?.decision };
      },
      isStuckWaiting: state => state.status === "waiting",
    });
    expect(await f.db.approval.count()).toBe(2);
  } finally {
    for (const handle of handles) handle.release();
    await Promise.allSettled(handles.map(handle => handle.delivery));
  }
});

test.each(["mode", "target", "caller", "hash", "workspace"] as const)("an approval cannot settle an unrelated running invocation: %s", async mismatch => {
  const f = await fixture();
  const app = await f.moduleNamed("requester", { uses: ["approvals.request"] });
  const other = await f.moduleNamed("other", { uses: ["approvals.request"] });
  const origin = { ...kernelOrigin(f.w), caller: { kind: "module" as const, module: app.module.name, moduleId: app.module.id, hash: "requester-1" } };
  const queued = await enqueueCall({ tx: f.db, ports: f.ports, origin, target: "approvals.request", raw: { title: "bound request" } }, { key: "bound-request" });
  const approval = await f.api.approvals.create({ action: "modify_external", moduleId: app.module.id, title: "bound approval", detail: "", preview: "", payload: { kind: "module_request", hash: "requester-1", call: queued.callId } });
  const changes = mismatch === "mode" ? { mode: "sync" } : mismatch === "target" ? { target: "settings", targetIdentity: "system:settings", tool: "update" }
    : mismatch === "caller" ? { callerModuleId: other.module.id, caller: `module:${other.module.id}` } : mismatch === "hash" ? { callerHash: "other-hash" }
    : { workspaceId: (await f.db.workspace.create({ data: { name: "other" } })).id };
  const leaseUntil = new Date(f.ports.now().getTime() + 60_000);
  await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "running", leaseToken: "bound-lease", leaseUntil, ...changes } });
  await f.api.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  await callsSettled(f.ports);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.callId } })).toMatchObject({ status: "running", leaseToken: "bound-lease", leaseUntil, output: null });
});

test("settled approval delivers its fixed call_result and repeated decisions do not reopen delivery", async () => {
  const f = await fixture(), results: ModuleEvent[] = [];
  const peer = testModuleProcess(async event => { if (event.trigger.kind === "call_result") results.push(event); return {}; });
  f.ports.sandbox = { available: true, isolated: false, startModule: peer.startModule };
  cleanups.push(() => moduleSupervisor(f.ports).stop());
  const app = await f.moduleNamed("requester", { uses: ["approvals.request"] });
  const queued = await app.call("approvals.request", { title: "Deliver decision" }, { key: "decision-reply" });
  await f.settle();
  const approval = await f.db.approval.findFirstOrThrow({ where: { status: "open" } });
  await f.api.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  await f.settle();
  expect(results.map(event => event.trigger)).toEqual([expect.objectContaining({
    kind: "call_result", callId: queued.callId, key: "decision-reply", status: "succeeded", output: { approval: approval.id, decision: "approved" },
  })]);
  await f.api.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  await f.settle();
  expect(results).toHaveLength(1);
});
