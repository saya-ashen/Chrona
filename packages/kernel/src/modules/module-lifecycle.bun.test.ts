import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { callSync, type Caller } from "./module-calls";
import { registerSystemModules } from "../system/system-modules";
import { moduleSupervisor } from "./module-supervisor";
import { createModules } from "./modules";
import { testModuleProcess } from "../__testing__/module-test-process";
import { testDb } from "../__testing__/test-db";
import { installTestModuleVersion, seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import type { StewardPorts } from "../ports";
import "./module-effects";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-lifecycle-");
  const workspace = await db.workspace.create({ data: { name: "lifecycle", settings: { notifications: { timezone: "UTC", dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, digestAt: "09:00" } } } });
  const peer = testModuleProcess(async () => ({ result: {} }));
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z"), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function app(name: string, uses: string[] = [], offlineRelease = false) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses, authority: uses.includes("*") ? "owner" : undefined });
    let module;
    if (offlineRelease) {
      const resources = join(dataDir, "external"), code = join(resources, name);
      await mkdir(code, { recursive: true });
      await writeFile(join(code, "module.json"), JSON.stringify(manifest));
      await writeFile(join(code, "index.ts"), "// Synthetic peer transport; never executed\n");
      await writeFile(join(code, "test.ts"), "// Synthetic release fixture\n");
      const material = await seedTestModuleRelease(resources, name);
      const candidate = await propose(moduleContext(ports, workspace.id), { root: resources, dir: name, expectedHash: material.hash, intent: { changes: ["Offline release fixture"] } }, "user");
      const moduleId = candidate.moduleId!, activeHash = candidate.hash;
      await db.moduleVersion.update({ where: { moduleId_hash: { moduleId, hash: activeHash } }, data: { status: "approved" } });
      module = await db.module.update({ where: { id: moduleId }, data: { activeHash } });
      await cp(code, join(dataDir, "platform/store", activeHash), { recursive: true });
    } else {
      module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: name } });
      module.activeHash = await installTestModuleVersion(ports, module, manifest);
    }
    const caller: Caller = { kind: "module", module: name, moduleId: module.id, hash: module.activeHash! };
    return { ...module, caller };
  }
  const entry = await app("web", ["*"]), target = await app("gmail");
  const call = async (name: string, args: Record<string, unknown>, caller: Caller = entry.caller) => (await callSync(ports, { workspaceId: workspace.id, caller, chain: [], path: [] }, name, args, { key: crypto.randomUUID() })).output;
  return { db, dataDir, ports, workspace, entry, target, app, call, processes: peer.processes };
}

test("ordinary web owner controls pause and resume, audits the user and keeps retired schedules cancelled", async () => {
  const f = await fixture();
  const timer = await f.db.timer.create({ data: { workspaceId: f.workspace.id, moduleId: f.target.id, timerId: "mail", rule: { kind: "every", minutes: 60 }, status: "active", nextAt: f.ports.now() } });
  await moduleSupervisor(f.ports).reconcile();
  const running = () => f.processes.filter(process => process.input.codeDir.endsWith("/" + f.target.activeHash) && !process.socket.destroyed);
  expect(running()).toHaveLength(1);
  for (const [operation, status, kind] of [["disable", "paused", "module_disabled"], ["enable", "active", "module_enabled"]]) {
    expect(await f.call(`modules.${operation}`, { moduleId: f.target.id, reason: "用户在网页操作" })).toMatchObject({ status: "done", result: { status } });
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.target.id } })).toMatchObject({ status });
    expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active" });
    expect(await f.db.audit.findFirstOrThrow({ where: { subjectId: f.target.id, kind } })).toMatchObject({ actorKey: "user", details: { source: "owner" } });
    // Retiring or starting the process completes after the call returns.
    for (let attempt = 0; attempt < 100 && running().length !== (status === "paused" ? 0 : 1); attempt++) await Bun.sleep(10);
    expect(running()).toHaveLength(status === "paused" ? 0 : 1);

  }
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "modules", tool: "disable" } })).toMatchObject({ caller: `module:${f.entry.id}` });
});

test("ordinary modules and Provider cannot acquire owner lifecycle access; internal status changes audit Chrona", async () => {
  const f = await fixture(), ordinary = await f.app("ordinary", ["modules.disable"]);
  await expect(f.call("modules.disable", { moduleId: f.target.id, reason: "try" }, ordinary.caller)).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.call("modules.disable", { moduleId: f.target.id, reason: "try" }, { kind: "provider", runId: "fixture" })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.target.id } })).toMatchObject({ status: "active" });
  await createModules(f.ports, f.workspace.id).lifecycle("disable", f.target.id, { reason: "maintenance" }, false);
  expect(await f.db.audit.findFirstOrThrow({ where: { subjectId: f.target.id, kind: "module_disabled" } })).toMatchObject({ actorKey: "chrona", details: { source: "chrona", reason: "maintenance" } });
});

test("web removal approval backs up data, removes the app and schedules, and cleans its registered page", async () => {
  const f = await fixture(), data = join(f.dataDir, "platform", "data", f.target.id);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "mail.json"), "[1]");
  const timer = await f.db.timer.create({ data: { workspaceId: f.workspace.id, moduleId: f.target.id, timerId: "retained mail timer", rule: { kind: "every", minutes: 60 }, status: "active", nextAt: f.ports.now() } });
  const result = await f.call("modules.remove", { moduleId: f.target.id, reason: "用户在网页申请删除应用" }) as { status: string; approvalId: string };
  expect(result.status).toBe("pending_approval");
  expect(await f.db.module.findUnique({ where: { id: f.target.id } })).not.toBeNull();
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status: "active" });
  expect(await readFile(join(data, "mail.json"), "utf8")).toBe("[1]");
  expect(await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } })).toMatchObject({ action: "delete_data", status: "open" });
  await f.call("approvals.resolve", { approval: result.approvalId, decision: "approve" });
  expect(await f.db.module.findUnique({ where: { id: f.target.id } })).toBeNull();
  expect(await f.db.timer.findUnique({ where: { id: timer.id } })).toBeNull();
  expect(await stat(data).catch(() => null)).toBeNull();
  const apps = (await f.call("modules.list", {}) as { items: { name: string; status: string }[] }).items;
  expect(apps.some(app => app.name === "gmail")).toBe(false);
  const audit = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.target.id } });
  expect(await readFile(join((audit.details as { backup: string }).backup, "data", "mail.json"), "utf8")).toBe("[1]");
  const pi = await f.app("pi", [], true);
  const removePi = await f.call("modules.remove", { moduleId: pi.id, reason: "remove ordinary Provider application" }) as { status: string; approvalId: string };
  expect(removePi.status).toBe("pending_approval");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: pi.id } })).toMatchObject({ activeHash: pi.activeHash });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: pi.id, hash: pi.activeHash! } } })).toMatchObject({ source: "user", status: "approved", report: { tests: [] } });
  await f.call("approvals.resolve", { approval: removePi.approvalId, decision: "approve" });
  expect(await f.db.module.findUnique({ where: { id: pi.id } })).toBeNull();
  expect(await f.db.moduleVersion.count({ where: { moduleId: pi.id } })).toBe(0);
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: pi.id } })).toMatchObject({ details: { hash: pi.activeHash } });
  const owner: Caller = { kind: "owner", via: "test" };
  const removeWeb = await f.call("modules.remove", { moduleId: f.entry.id, reason: "remove ordinary application" }, owner) as { status: string; approvalId: string };
  expect(removeWeb.status).toBe("pending_approval");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.entry.id } })).toMatchObject({ activeHash: f.entry.activeHash });
  await f.call("approvals.resolve", { approval: removeWeb.approvalId, decision: "approve" }, owner);
  expect(await f.db.module.findUnique({ where: { id: f.entry.id } })).toBeNull();
});
