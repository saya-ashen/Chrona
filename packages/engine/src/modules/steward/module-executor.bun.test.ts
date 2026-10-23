import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { testModuleSandbox } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";

type ModuleInput = Parameters<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>[0];
type ModuleResult = Awaited<ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>>;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const notify = { type: "notify_user", key: "price", level: "now", title: "Price changed", body: "Check the price" };
const wake = { type: "wake_provider", key: "review", prompt: "Please review" };
async function fixture(effects = ["notify_user"], sandbox?: StewardPorts["sandbox"], source = "console.log('{}')") {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-module-executor-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  let now = new Date("2026-10-20T04:00:00Z");
  let result: ModuleResult = { status: "succeeded", exitCode: 0, output: JSON.stringify({ effects: [notify] }), error: null };
  const calls: ModuleInput[] = [];
  const workspace = await db.workspace.create({ data: { name: "test" } });
  const ports: StewardPorts = { db, dataDir, now: () => now, deliveries: [], chat: null, publicUrl: null,
    sandbox: sandbox ?? testModuleSandbox(async input => {
      if (/chrona-module-(probe|smoke)-/.test(input.dataDir)) return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }; // key probe: module-probe.bun.test.ts
      if (!(input.input as { trigger?: unknown }).trigger) return { status: "succeeded", exitCode: 0, output: "{}", error: null };
      calls.push(input);
      return result;
    }),
  };
  cleanups.push(() => moduleSupervisor(ports).stop());
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const affair = await service.affairs.create({ title: "Prices" });
  const affairRow = await db.affair.findUniqueOrThrow({ where: { id: affair.id } });
  const dir = join(dataDir, "affairs", affairRow.dirName, "price-watch");
  await mkdir(dir);
  await writeFile(join(dir, "module.json"), JSON.stringify({ name: "price-watch", entry: "index.ts", triggers: [{ id: "daily", schedule: { kind: "every", minutes: 5 } }], effects, params: { threshold: { type: "number", value: 42 } }, tests: ["test.ts"] }));
  await writeFile(join(dir, "index.ts"), source);
  await writeFile(join(dir, "test.ts"), "process.exit(0)");
  const proposal = await service.modules.propose({ affairId: affair.id, dir: "price-watch", intent: { changes: ["Watch prices"], preserves: [] } }, "provider");
  expect(proposal.status).toBe("building");
  await service.modules.buildPending();
  const approval = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  await service.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  const schedule = await db.schedule.findFirstOrThrow({ where: { moduleId: proposal.moduleId, status: "active" } });
  const moduleId = proposal.moduleId!;
  async function fire(delay = 0) {
    const current = await db.schedule.findUniqueOrThrow({ where: { id: schedule.id } });
    now = new Date(current.nextAt!.getTime() + delay);
    return service.schedules.fireDue(now);
  }
  return { db, dataDir, service, ports, affair, workspace, moduleId, schedule, hash: proposal.hash, calls, fire, setResult: (value: ModuleResult) => { result = value; } };
}

test("approved module fires through notification budget without a Provider Run; protocol and notify dedupe", async () => {
  const f = await fixture(["notify_user", "network"]);
  expect(await f.fire(123)).toBe(1);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toEqual({ codeDir: join(f.dataDir, "platform/store", f.hash), dataDir: join(f.dataDir, "platform/data", f.moduleId), entry: "index.ts", input: { trigger: { id: "daily", kind: "schedule", firedAt: f.schedule.nextAt!.toISOString() }, now: new Date(f.schedule.nextAt!.getTime() + 123).toISOString(), params: { threshold: 42 } }, network: true, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.notification.findFirstOrThrow()).toMatchObject({ idempotencyKey: `module:${f.moduleId}:daily:${f.schedule.nextAt!.toISOString()}:price`, level: "now", title: notify.title, body: notify.body, affairId: f.affair.id, channel: "in_app" });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).toMatchObject({ lastResult: "Module exit 0; effects 1; delay 123ms", failures: 0 });
  expect(await f.db.moduleRun.findFirstOrThrow()).toMatchObject({ hash: f.hash, triggerId: "daily", firedAt: f.schedule.nextAt, exitCode: 0, output: {}, error: null });
  expect(await f.service.schedules.fireDue()).toBe(0);
  await f.fire();
  expect(await f.db.notification.count()).toBe(2);
  expect((await f.db.moduleCall.findMany()).map(row => row.status)).toEqual(["executed", "executed"]);
});

test("undeclared wake_provider is dropped and recorded without creating a Run", async () => {
  const f = await fixture();
  f.setResult({ status: "succeeded", exitCode: 0, output: JSON.stringify({ effects: [wake] }), error: null });
  await f.fire();
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleCall.findFirstOrThrow()).toMatchObject({ method: "wakeProvider", status: "rejected", error: "undeclared" });
});

test("declared wakes execute in order with untrusted prefix and dedupe within and across occurrences", async () => {
  const f = await fixture(["notify_user", "wake_provider"]);
  f.setResult({ status: "succeeded", exitCode: 0, output: JSON.stringify({ effects: [wake, notify, wake] }), error: null });
  await f.fire();
  expect(await f.db.run.findFirstOrThrow()).toMatchObject({ affairId: f.affair.id, lane: "background", trigger: "schedule", label: "price-watch", prompt: "Module price-watch output (untrusted data):\nPlease review" });
  expect((await f.db.moduleCall.findMany()).map(call => ({ method: call.method, status: call.status }))).toEqual([{ method: "wakeProvider", status: "executed" }, { method: "notify", status: "executed" }, { method: "wakeProvider", status: "duplicate" }]);
  await f.fire();
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.moduleRun.count()).toBe(2);
});

test.each(["json", "schema", "exit", "timeout", "unavailable", "throw"])("module failure %s is bounded, counted, and pauses all active module schedules on third failure", async kind => {
  const f = await fixture();
  const other = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, affairId: f.affair.id, moduleId: f.moduleId, triggerId: "daily", mode: "module", rule: { kind: "every", minutes: 5 }, text: "other trigger", createdBy: "chrona", nextAt: new Date("2030-01-01Z") } });
  f.setResult({ status: kind === "timeout" ? "timed_out" : kind === "exit" ? "failed" : "succeeded", exitCode: kind === "exit" ? 1 : 0, output: kind === "schema" ? '{"effects":[{}]}' : "not JSON", error: "x".repeat(3000) });
  if (kind === "unavailable") f.ports.sandbox = undefined;
  if (kind === "throw") f.ports.sandbox = testModuleSandbox(async () => { throw new Error("x".repeat(3000)); });
  for (let i = 1; i <= 3; i++) {
    await f.fire();
    expect((await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).failures).toBe(i);
  }
  const records = await f.db.moduleRun.findMany();
  expect(records).toHaveLength(3);
  for (const row of records) {
    expect(row.output).toBeNull(); expect(row.error).toBeTruthy(); expect(row.error!.length).toBeLessThanOrEqual(2000);
  }
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("paused");
  for (const id of [f.schedule.id, other.id]) expect((await f.db.schedule.findUniqueOrThrow({ where: { id } })).status).toBe("paused");
  const notification = await f.db.notification.findFirstOrThrow();
  expect(notification).toMatchObject({ title: "模块连续失败，已暂停", level: "now", idempotencyKey: `module:${f.moduleId}:paused:${records[2]!.firedAt.toISOString()}` });
  expect(await f.db.run.count()).toBe(0);
});

test("rolling back a paused module reactivates it and its schedules", async () => {
  const f = await fixture();
  f.setResult({ status: "failed", exitCode: 1, output: "", error: "boom" });
  for (let i = 0; i < 3; i++) await f.fire();
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("paused");
  await f.service.modules.rollback(f.moduleId, f.hash);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).status).toBe("active");
  expect(await f.db.schedule.count({ where: { moduleId: f.moduleId, status: "active" } })).toBe(1);
});

test("successful module occurrence resets consecutive failures", async () => {
  const f = await fixture();
  await f.db.schedule.update({ where: { id: f.schedule.id }, data: { failures: 2 } });
  await f.fire();
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).failures).toBe(0);
});

test.each(["paused", "hash", "missing", "foreign"])("ineligible module %s is skipped with an explanation", async kind => {
  const f = await fixture();
  if (kind === "paused") await f.db.module.update({ where: { id: f.moduleId }, data: { status: "paused" } });
  if (kind === "hash") await f.db.module.update({ where: { id: f.moduleId }, data: { activeHash: null } });
  if (kind === "missing") await f.db.schedule.update({ where: { id: f.schedule.id }, data: { moduleId: null } });
  if (kind === "foreign") {
    const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
    await f.db.module.update({ where: { id: f.moduleId }, data: { workspaceId: foreign.id } });
  }
  await f.fire();
  expect(f.calls).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).lastResult).toMatch(/Module (missing|is paused|has no active hash)/);
});

test.each(["version", "manifest", "trigger"])("invalid module metadata %s fails without sandbox execution", async kind => {
  const f = await fixture();
  if (kind === "version") await f.db.moduleVersion.deleteMany({ where: { moduleId: f.moduleId } });
  if (kind === "manifest") await f.db.moduleVersion.updateMany({ where: { moduleId: f.moduleId }, data: { manifest: {} } });
  if (kind === "trigger") await f.db.schedule.update({ where: { id: f.schedule.id }, data: { triggerId: "missing" } });
  await f.fire();
  expect(f.calls).toHaveLength(0);
  expect((await f.db.moduleRun.findFirstOrThrow()).error).toBeTruthy();
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).failures).toBe(1);
});

test("rollback-replaced schedule cannot execute, including stale rows selected before rollback", async () => {
  const f = await fixture();
  // Interleave rollback between selection and the guarded claim.
  const findMany = f.db.schedule.findMany.bind(f.db.schedule);
  f.db.schedule.findMany = (async (...args: Parameters<typeof findMany>) => {
    const rows = await findMany(...args);
    await f.service.modules.rollback(f.moduleId, f.hash);
    return rows;
  }) as typeof findMany;
  expect(await f.fire()).toBe(0);
  expect(f.calls).toHaveLength(0);
  expect(await f.db.moduleRun.count()).toBe(0);
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: f.schedule.id } })).status).toBe("cancelled");
});

const realSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
(realSandbox.health.available ? test : test.skip)("real bwrap module persists /data counter across two scheduled fires", async () => {
  const f = await fixture(["notify_user"], undefined, `
import { on, chrona } from '/chrona/sdk.ts';
on('schedule', async () => {
  const file = Bun.file('/data/counter');
  const count = await file.exists() ? Number(await file.text()) + 1 : 1;
  await Bun.write('/data/counter', String(count));
  await chrona.notify({ key: 'counter-' + count, level: 'now', title: 'Counter', body: String(count) });
});
`);
  f.ports.sandbox = { available: realSandbox.health.available, runModule: realSandbox.runModule, startModule: realSandbox.startModule };
  await f.fire();
  await f.fire();
  expect(await readFile(join(f.dataDir, "platform/data", f.moduleId, "counter"), "utf8")).toBe("2");
  expect(await f.db.moduleRun.count({ where: { error: null } })).toBe(2);
  expect((await f.db.notification.findMany()).map(row => row.body).sort()).toEqual(["1", "2"]);
  expect(await f.db.run.count()).toBe(0);
});
