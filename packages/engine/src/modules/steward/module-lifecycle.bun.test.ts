import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { callSync, type Caller } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease } from "./module-release";
import { createPages } from "./builtin/web/pages";
import type { StewardPorts } from "./ports";
import "./module-effects";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-lifecycle-");
  const workspace = await db.workspace.create({ data: { name: "lifecycle", settings: { notifications: { timezone: "UTC", dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, digestAt: "09:00" } } } });
  const peer = testModuleProcess(async () => ({ result: {} }));
  const ports: StewardPorts = { db, dataDir, moduleBuiltinResources: join(dataDir, "builtin"), publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z"), sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  async function app(name: string, uses: string[] = [], builtin = false) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], keepAlive: true, uses });
    let activeHash = name;
    if (builtin) {
      const code = join(ports.moduleBuiltinResources!, name);
      await mkdir(code, { recursive: true });
      await writeFile(join(code, "module.json"), JSON.stringify(manifest));
      await writeFile(join(code, "index.ts"), "// Synthetic peer transport; never executed\n");
      await writeFile(join(code, "test.ts"), "// Synthetic release fixture\n");
      await seedTestModuleRelease(ports.moduleBuiltinResources!, name);
      activeHash = (await resolveBuiltinRelease(ports, name)).hash;
      await cp(code, join(dataDir, "platform/store", activeHash), { recursive: true });
    }
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash, builtin } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: activeHash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const caller: Caller = { kind: "module", module: name, moduleId: module.id, hash: activeHash };
    return { ...module, caller };
  }
  const entry = await app("web", ["*"], true), target = await app("gmail");
  const call = async (name: string, args: Record<string, unknown>, caller: Caller = entry.caller) => (await callSync(ports, { workspaceId: workspace.id, caller, chain: [], path: [] }, name, args)).output;
  return { db, dataDir, ports, workspace, entry, target, app, call, processes: peer.processes };
}

test("web owner controls pause and resume directly, audit the user and reconcile the process and schedules", async () => {
  const f = await fixture();
  const timer = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: f.target.id, mode: "module", triggerId: "daily", text: "mail", createdBy: "chrona", rule: { kind: "every", minutes: 60 }, status: "active", nextAt: f.ports.now() } });
  await moduleSupervisor(f.ports).reconcile();
  const running = () => f.processes.filter(process => process.input.codeDir.endsWith("/gmail") && !process.socket.destroyed);
  expect(running()).toHaveLength(1);
  for (const [operation, status, kind] of [["disable", "paused", "module_disabled"], ["enable", "active", "module_enabled"]]) {
    expect(await f.call(`modules.${operation}`, { module: "gmail", reason: "用户在网页操作" })).toMatchObject({ status });
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.target.id } })).toMatchObject({ status });
    expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ status });
    expect(await f.db.audit.findFirstOrThrow({ where: { subjectId: f.target.id, kind } })).toMatchObject({ actorKey: "user", details: { source: "owner" } });
    // Retiring or starting the process completes after the call returns.
    for (let attempt = 0; attempt < 100 && running().length !== (status === "paused" ? 0 : 1); attempt++) await Bun.sleep(10);
    expect(running()).toHaveLength(status === "paused" ? 0 : 1);
    if (status === "paused") {
      // Retirement closes the socket first, then removes its directory asynchronously.
      const socketDir = f.processes.find(process => process.input.codeDir.endsWith("/gmail"))!.input.socketPath.replace(/\/s$/, "");
      for (let attempt = 0; attempt < 100 && await stat(socketDir).catch(() => null); attempt++) await Bun.sleep(10);
      expect(await stat(socketDir).catch(() => null)).toBeNull();
    }
  }
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "modules", tool: "disable" } })).toMatchObject({ caller: `module:${f.entry.id}` });
});

test("ordinary modules cannot acquire owner lifecycle access, and Provider actions remain attributed to Chrona", async () => {
  const f = await fixture(), ordinary = await f.app("ordinary", ["modules.disable"]);
  await expect(f.call("modules.disable", { module: "gmail", reason: "try" }, ordinary.caller)).rejects.toMatchObject({ code: "forbidden" });
  await f.call("modules.disable", { module: "gmail", reason: "maintenance" }, { kind: "provider", runId: "fixture" });
  expect(await f.db.audit.findFirstOrThrow({ where: { subjectId: f.target.id, kind: "module_disabled" } })).toMatchObject({ actorKey: "chrona", details: { source: "chrona", reason: "maintenance" } });
});

test("web removal approval backs up data, removes the app and schedules, and cleans its registered page", async () => {
  const f = await fixture(), data = join(f.dataDir, "platform", "data", f.target.id);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "mail.json"), "[1]");
  const pages = createPages({ dataDir: join(f.dataDir, "pages"), modules: () => f.db.module.findMany({ where: { workspaceId: f.workspace.id }, select: { id: true, name: true, status: true, activeHash: true } }), tools: async () => new Map() });
  await pages.tool("page-set", { id: "inbox", title: "收件箱", spec: { root: "title", elements: { title: { type: "Text", props: { text: "邮件" }, children: [] } } } }, { kind: "module", module: "gmail", moduleId: f.target.id });
  const result = await f.call("modules.remove", { module: "gmail", reason: "用户在网页申请删除应用" }) as { status: string; approvalId: string };
  expect(result.status).toBe("pending_approval");
  expect(await f.db.module.findUnique({ where: { id: f.target.id } })).not.toBeNull();
  expect(await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } })).toMatchObject({ action: "delete_data", status: "open" });
  await f.call("approvals.resolve", { approval: result.approvalId, decision: "approve", scope: "once" });
  expect(await f.db.module.findUnique({ where: { id: f.target.id } })).toBeNull();
  const apps = await f.call("modules.list", {}) as { name: string; status: string }[];
  expect(apps.some(app => app.name === "gmail")).toBe(false);
  expect(await pages.list()).toEqual([]);
  expect(await pages.get("gmail", "inbox")).toBeNull();
  const audit = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.target.id } });
  expect(await readFile(join((audit.details as { backup: string }).backup, "data", "mail.json"), "utf8")).toBe("[1]");
  await expect(f.call("modules.remove", { module: "web", reason: "try" })).rejects.toThrow("Built-in web cannot remove");
});
