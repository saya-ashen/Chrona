import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { createStewardService } from "../service";
import type { StewardPorts } from "../ports";
import { testDb } from "../test-db";
import { testModuleSandbox } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import { callsSettled, callSync } from "./module-calls";
import { notices } from "../test-notices";
import { installNotifyTarget } from "../test-notify-target";

type ModuleInput = Parameters<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>[0];
type ModuleResult = Awaited<ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>>;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const notify = { type: "notify_user", key: "price", level: "now", title: "Price changed", body: "Check the price" };
async function fixture({ effects = [], uses = ["notify.send"] }: { effects?: string[]; uses?: string[] } = {}, sandbox?: StewardPorts["sandbox"], source = "console.log('{}')") {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-module-executor-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  let now = new Date("2026-10-20T04:00:00Z");
  let result: ModuleResult = { status: "succeeded", exitCode: 0, output: JSON.stringify({ effects: [notify] }), error: null };
  const calls: ModuleInput[] = [];
  const workspace = await db.workspace.create({ data: { name: "test" } });
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null,
    sandbox: sandbox ?? testModuleSandbox(async input => {
      if (/chrona-module-(probe|smoke)-/.test(input.dataDir)) return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }; // key probe: module-probe.bun.test.ts
      if (!(input.input as { trigger?: unknown }).trigger) return { status: "succeeded", exitCode: 0, output: "{}", error: null };
      calls.push(input);
      return result;
    }),
  };
  cleanups.push(async () => { await callsSettled(ports); await moduleSupervisor(ports).stop(); });
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const root = join(dataDir, "sessions", "test");
  const dir = join(root, "price-watch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), JSON.stringify({ name: "price-watch", entry: "index.ts", tools: [{ name: "inspect", description: "Inspect price state", visibility: ["owner", "provider", "modules"], output: {}, parameters: { type: "object", properties: {} } }], effects, uses, params: { threshold: { type: "number", value: 42 } }, tests: ["test.ts"] }));
  await writeFile(join(dir, "index.ts"), source);
  await writeFile(join(dir, "test.ts"), "process.exit(0)");
  const proposal = await service.modules.propose({ root, dir: "price-watch", intent: { changes: ["Watch prices"], preserves: [] } }, "provider");
  expect(proposal.status).toBe("building");
  await service.modules.buildPending();
  expect(await db.approval.count()).toBe(0);
  // Start from the module's own notices: its auto-activation digest is covered in modules.bun.test.ts.
  await db.moduleInvocation.deleteMany({ where: { target: "notify", tool: "send" } });
  await db.kernelFact.deleteMany();
  await installNotifyTarget(ports, workspace.id, true);
  const moduleId = proposal.moduleId!;
  async function fire(delay = 0) {
    now = new Date(now.getTime() + Math.max(1, delay));
    return service.modules.callTool("m_price_watch_inspect", {});
  }
  return { db, dataDir, service, ports, workspace, moduleId, hash: proposal.hash, calls, fire, setResult: (value: ModuleResult) => { result = value; } };
}

test("approved module executes a routed tool without a Provider Run and scopes notification dedupe to each event", async () => {
  const f = await fixture({ effects: ["network"] });
  expect(await f.fire(123)).toEqual({ result: null });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ codeDir: join(f.dataDir, "platform/store", f.hash), dataDir: join(f.dataDir, "platform/data", f.moduleId), entry: "index.ts", input: { trigger: { id: "inspect", kind: "tool", args: {}, caller: { kind: "owner" } }, params: { threshold: 42 } }, network: true, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.timer.count()).toBe(0);
  const records = await f.db.moduleRun.findMany({ where: { moduleId: f.moduleId } });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ hash: f.hash, triggerId: "tool:inspect", exitCode: 0, output: {}, error: null });
  await f.fire();
  await callsSettled(f.ports);
  expect((await notices(f.db)).map(row => row.body)).toEqual([notify.body, notify.body]);
  expect(await f.db.moduleInvocation.count({ where: { target: "notify", tool: "send", status: "succeeded" } })).toBe(2);
  expect(await f.db.moduleCall.count({ where: { method: "call", status: { not: "rejected" } } })).toBe(0);
});

test.each(["json", "schema", "exit", "timeout", "throw"])("routed module failure %s is bounded, counted, and pauses after three failures", async kind => {
  const f = await fixture();
  f.setResult({ status: kind === "timeout" ? "timed_out" : kind === "exit" ? "failed" : "succeeded", exitCode: kind === "exit" ? 1 : 0, output: kind === "schema" ? '{"effects":[{}]}' : "not JSON", error: "x".repeat(3000) });
  if (kind === "throw") f.ports.sandbox = testModuleSandbox(async () => { throw new Error("x".repeat(3000)); });
  for (let i = 1; i <= 3; i++) await expect(f.fire()).rejects.toThrow();
  const records = await f.db.moduleRun.findMany();
  expect(records).toHaveLength(3);
  for (const row of records) {
    expect(row.output).toBeNull(); expect(row.error).toBeTruthy(); expect(row.error!.length).toBeLessThanOrEqual(2000);
  }
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("paused");
  await expect(f.fire()).rejects.toMatchObject({ code: "not_found" });
  expect(await f.db.moduleRun.count()).toBe(3);
  expect(await f.db.run.count()).toBe(0);
});

test("rolling back a paused module restores routed execution without recreating calendar work", async () => {
  const f = await fixture();
  f.setResult({ status: "failed", exitCode: 1, output: "", error: "boom" });
  for (let i = 0; i < 3; i++) await expect(f.fire()).rejects.toThrow();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("paused");
  await f.service.modules.rollback(f.moduleId, f.hash);
  f.setResult({ status: "succeeded", exitCode: 0, output: '{"result":{"restored":true}}', error: null });
  expect(await f.fire()).toEqual({ result: { restored: true } });
  expect(await f.db.timer.count()).toBe(0);
});

test("successful routed execution resets consecutive failures", async () => {
  const f = await fixture();
  f.setResult({ status: "failed", exitCode: 1, output: "", error: "boom" });
  for (let i = 0; i < 2; i++) await expect(f.fire()).rejects.toThrow();
  f.setResult({ status: "succeeded", exitCode: 0, output: "{}", error: null });
  await f.fire();
  f.setResult({ status: "failed", exitCode: 1, output: "", error: "boom again" });
  for (let i = 0; i < 2; i++) await expect(f.fire()).rejects.toThrow();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("active");
  expect(await f.db.moduleRun.count()).toBe(5);
});

test.each(["paused", "hash", "missing", "foreign"])("ineligible module %s cannot be routed to a sandbox", async kind => {
  const f = await fixture();
  if (kind === "paused") await f.db.module.update({ where: { id: f.moduleId }, data: { status: "paused" } });
  if (kind === "hash") await f.db.module.update({ where: { id: f.moduleId }, data: { activeHash: null } });
  if (kind === "missing") await f.db.module.delete({ where: { id: f.moduleId } });
  if (kind === "foreign") {
    const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
    await f.db.module.update({ where: { id: f.moduleId }, data: { workspaceId: foreign.id } });
  }
  await expect(f.fire()).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
});

test.each(["version", "manifest", "tool"])("invalid module metadata %s fails before sandbox execution", async kind => {
  const f = await fixture();
  if (kind === "version") await f.db.moduleVersion.deleteMany({ where: { moduleId: f.moduleId } });
  if (kind === "manifest") await f.db.moduleVersion.updateMany({ where: { moduleId: f.moduleId }, data: { manifest: {} } });
  if (kind === "tool") await f.db.moduleVersion.updateMany({ where: { moduleId: f.moduleId }, data: { manifest: { name: "price-watch", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [] } } });
  await expect(f.fire()).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("active");
});

test("a module caller with a replaced hash loses its declared secret access after rollback", async () => {
  const f = await fixture();
  const current = await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: f.moduleId } });
  const manifest = { ...current.manifest as object, secrets: ["demo_key"] };
  await f.db.moduleVersion.update({ where: { id: current.id }, data: { manifest } });
  f.ports.secrets = async () => ({ token: "private-token" });
  const origin = { workspaceId: f.workspace.id, caller: { kind: "module" as const, moduleId: f.moduleId, module: "price-watch", hash: f.hash }, chain: [], path: [] };
  expect(await callSync(f.ports, origin, "secrets.get", { name: "demo_key" })).toMatchObject({ output: { value: { token: "private-token" } } });
  await f.db.moduleVersion.create({ data: { moduleId: f.moduleId, hash: "replacement", status: "approved", source: "user", manifest, intent: {}, report: {} } });
  await f.service.modules.rollback(f.moduleId, "replacement");
  await expect(callSync(f.ports, origin, "secrets.get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
  expect(f.calls).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
});

const realSandbox = createScriptSandbox({  });
(realSandbox.health.available ? test : test.skip)("real SDK module persists its data counter across two routed tool calls", async () => {
  const f = await fixture({}, undefined, `
import { on, chrona } from 'chrona';
on('tool', async () => {
  const file = Bun.file(chrona.paths.data + '/counter');
  const count = await file.exists() ? Number(await file.text()) + 1 : 1;
  await Bun.write(file, String(count));
  const key = 'counter-' + count;
  await chrona.call({moduleId:chrona.dependencies.notify,tool:'send'}, { key, level: 'now', title: 'Counter', body: String(count) }, { mode: 'async', key });
});
`);
  const runtime = createScriptSandbox({ dataDir: f.dataDir });
  f.ports.sandbox = { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule };
  await f.fire(); await f.fire();
  await callsSettled(f.ports);
  expect(await readFile(join(f.dataDir, "platform/data", f.moduleId, "counter"), "utf8")).toBe("2");
  expect(await f.db.moduleRun.count({ where: { moduleId: f.moduleId, error: null } })).toBe(2);
  expect(await f.db.moduleInvocation.count({ where: { target: "notify", tool: "send", status: "succeeded" } })).toBe(2);
  expect((await notices(f.db)).map(row => row.body).sort()).toEqual(["1", "2"]);
  expect(await f.db.run.count()).toBe(0);
});
