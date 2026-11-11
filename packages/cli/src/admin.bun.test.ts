import { afterEach, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createStewardService } from "@chrona/engine";
import { removeSecret, runAdmin, setSecret } from "./admin";
import { createProgram } from "./program";
import { adminBuild } from "@server/admin-build";
import { seedTestModuleRelease } from "../../engine/src/modules/steward/module-release-test-fixture";
import { registerTestProvider } from "../../engine/src/modules/steward/test-provider";
import * as stewardRuntime from "@server/steward-runtime";

const dbs: PrismaClient[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture(hashLength = 64, name = "entry") {
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-admin-test-")), databaseUrl = `file:${join(dataDir, "chrona.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) }); dbs.push(db);
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const module = await db.module.create({ data: { workspaceId: "ws_default", name, status: "active", activeHash: "a".repeat(hashLength), dataSchema: 1 } });
  const manifest = { name, entry: "index.ts", keepAlive: true, effects: [], uses: ["chat.send"], tests: ["test.ts"] };
  for (const hash of ["a", "b"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash: hash.repeat(hashLength), manifest, intent: {}, report: {}, source: hash === "a" ? "builtin" : "user", status: "approved" } });
  const ports = { db, dataDir, now: () => new Date(), publicUrl: null };
  const api = createStewardService(ports).forWorkspace("ws_default");
  return { db, module, api, options: { dataDir, databaseUrl } };
}
async function offlineResources(dataDir: string, name: string) {
  const root = join(dataDir, "resources"), external = join(root, "external"), dir = join(external, name);
  mkdirSync(dir, { recursive: true });
  cpSync(resolve("packages/integrations/src/steward/module-sdk"), join(root, "module-sdk"), { recursive: true });
  writeFileSync(join(dir, "module.json"), JSON.stringify({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], ...(name === "mcp" ? { uses: ["*"],
      authority: "owner"
} : {}) }));
  writeFileSync(join(dir, "index.ts"), "// synthetic offline recovery fixture\n");
  writeFileSync(join(dir, "test.ts"), "// checked on restart\n");
  await seedTestModuleRelease(external, name);
  return root;
}
test("admin commands are registered", () => {
  const admin = createProgram().commands.find(c => c.name() === "admin")!;
  expect(admin.commands.map(c => c.name())).toEqual(["build", "legacy", "modules", "catalog", "install", "diagnostics", "approvals", "rollback", "disable", "remove", "approve", "reject", "secret-set", "secret-remove"]);
});
test("admin build dispatches the request file through the packaged host", async () => {
  const files: string[] = [];
  await createProgram({ adminBuild: async file => { files.push(file); } }).parseAsync(["node", "chrona", "admin", "build", "request.json"]);
  expect(files).toEqual(["request.json"]);
});

test("admin build respects the runtime lock and runs no ordinary tick or built-in upgrades", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const file = join(f.options.dataDir, "request.json");
  writeFileSync(file, JSON.stringify({ name: "owner-app", goal: "memory only", intent: { changes: ["memory"], preserves: [] }, requestKey: "once", execution: { provider: "pi", model: "openai/gpt-6.1-sol", timeoutMinutes: 10, maxSubmissions: 1 } }));
  const createRuntime = stewardRuntime.createStewardRuntime;
  const runtimeFactory = spyOn(stewardRuntime, "createStewardRuntime").mockImplementation((...args) => {
    const runtime = createRuntime(...args);
    registerTestProvider(runtime.ports.db);
    return runtime;
  });
  const seen: unknown[] = [];
  const provider = { name: "pi", supportsRunModel: true, async health() { return { available: true, sandboxed: true, error: null }; }, start(input: unknown) { seen.push(input); return { async inject() {}, async abort() {}, done: Promise.resolve({ outcome: "finished" as const, sessionId: null, error: null }) }; } };
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try { await expect(adminBuild(file, { ...f.options, provider })).rejects.toThrow("already in use"); }
  finally { lock.release(); }
  try {
    const modules = await f.db.module.count();
    expect(await adminBuild(file, { ...f.options, provider })).toMatchObject({ status: "finished" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: "openai/gpt-6.1-sol", lane: "build" });
    expect(await f.db.module.count()).toBe(modules);
    expect(await f.db.stewardState.count()).toBe(0);
    const released = acquireSqliteRuntimeLock(f.options.databaseUrl); released.release();
  } finally { runtimeFactory.mockRestore(); log.mockRestore(); }
});

test("admin reads while runtime locked but refuses writes; approval audit source is cli", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const approval = await f.api.approvals.create({ action: "modify_external", title: "Settings", detail: "Review", preview: "diff", payload: {} });
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try {
    expect(await runAdmin("approvals", [], f.options)).toContainEqual(expect.objectContaining({ id: approval.id }));
    expect(await runAdmin("modules", [], f.options)).toContainEqual({ name: "rescue", status: "immutable" });
    const before = await f.db.audit.count();
    expect(await runAdmin("diagnostics", [f.module.name], f.options)).toContainEqual(expect.objectContaining({ module: f.module.name, runtime: { state: "unobserved", pid: null }, incidents: [] }));
    expect(await f.db.audit.count()).toBe(before);
    await expect(runAdmin("approve", [approval.id], f.options)).rejects.toThrow("already in use");
  } finally { lock.release(); }
  try {
    await runAdmin("approve", [approval.id], f.options);
    expect(await f.db.audit.findFirst({ where: { kind: "approval_resolved", subjectId: approval.id } })).toMatchObject({ actorKey: "user", details: { source: "cli" } });
    const second = await f.api.approvals.create({ action: "modify_external", title: "Settings", detail: "Review", preview: "diff", payload: {} });
    await runAdmin("reject", [second.id], f.options);
    expect(await f.db.approval.findUnique({ where: { id: second.id } })).toMatchObject({ status: "denied" });
    expect(log.mock.calls.some(call => String(call[0]).includes("Restart Chrona"))).toBe(true);
  } finally { log.mockRestore(); }
});
test("admin remove requires a target in the default workspace and retains the runtime lock", async () => {
  const f = await fixture();
  const workspace = await f.db.workspace.create({ data: { name: "Other" } });
  const other = await f.db.module.create({ data: { workspaceId: workspace.id, name: "other-app" } });
  for (const args of [[], [""]]) await expect(runAdmin("remove", args, f.options)).rejects.toThrow("Module name or id is required");
  for (const target of ["missing-app", other.name, other.id]) await expect(runAdmin("remove", [target], f.options)).rejects.toThrow("Module not found");
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try { await expect(runAdmin("remove", [f.module.name], f.options)).rejects.toThrow("already in use"); }
  finally { lock.release(); }
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active" });
});

test.each(["web", "notify"])("admin remove requests %s deletion offline and only separate approval removes it with a backup", async name => {
  const f = await fixture(64, name), log = spyOn(console, "log").mockImplementation(() => {});
  const data = join(f.options.dataDir, "platform", "data", f.module.id);
  const content = join(f.options.dataDir, "platform", "content", f.module.id);
  for (const dir of [data, content]) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "keep.txt"), "valuable"); }
  await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: { manifest: { name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], uses: ["*"],
      authority: "owner"
} } });
  try {
    const request = await runAdmin("remove", [name === "web" ? name : f.module.id], f.options) as { status: string; approvalId: string };
    expect(request.status).toBe("pending_approval");
    expect(typeof request.approvalId).toBe("string");
    expect(await f.db.approval.findUniqueOrThrow({ where: { id: request.approvalId } })).toMatchObject({ action: "delete_data", status: "open", resolvedAt: null, payload: { kind: "module_remove", moduleId: f.module.id, name, hash: f.module.activeHash } });
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: f.module.activeHash });
    expect(await f.db.moduleVersion.count({ where: { moduleId: f.module.id } })).toBe(2);
    for (const dir of [data, content]) expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("valuable");
    expect(existsSync(join(f.options.dataDir, "platform", "removed"))).toBe(false);
    expect(await f.db.audit.count({ where: { kind: "module_removed" } })).toBe(0);
    expect(await f.db.grant.count()).toBe(0);
    const released = acquireSqliteRuntimeLock(f.options.databaseUrl); released.release();

    await runAdmin("approve", [request.approvalId], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toBeNull();
    expect(await f.db.moduleVersion.count({ where: { moduleId: f.module.id } })).toBe(0);
    const removal = await f.db.audit.findFirstOrThrow({ where: { kind: "module_removed", subjectId: f.module.id } });
    const backup = (removal.details as { backup: string }).backup;
    for (const part of ["data", "content"]) expect(readFileSync(join(backup, part, "keep.txt"), "utf8")).toBe("valuable");
    for (const dir of [data, content]) expect(existsSync(dir)).toBe(false);
    expect(await f.db.approval.findUniqueOrThrow({ where: { id: request.approvalId } })).toMatchObject({ status: "approved", scope: "once", grantId: null });
    expect(await f.db.audit.findFirst({ where: { kind: "approval_resolved", subjectId: request.approvalId } })).toMatchObject({ details: { source: "cli" } });
    expect(await f.db.stewardState.count()).toBe(0);
    expect(await f.db.run.count()).toBe(0);
    expect(await f.db.moduleRun.count()).toBe(0);
  } finally { log.mockRestore(); }
});

test.each([40, 64])("admin rollback accepts an approved %i-character hash and disable pauses schedules", async hashLength => {
  const f = await fixture(hashLength), log = spyOn(console, "log").mockImplementation(() => {}), hash = "b".repeat(hashLength);
  try {
    await runAdmin("rollback", [f.module.name, hash], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ activeHash: hash });
    expect(await f.db.approval.count({ where: { moduleId: f.module.id } })).toBe(0);
    expect(await f.db.audit.findFirst({ where: { kind: "admin_rollback" } })).toMatchObject({ actorKey: "user", details: { source: "cli", hash } });
    expect(await f.db.generation.count()).toBe(1);
    expect(await f.db.stewardState.count()).toBe(0);
    expect(await f.db.run.count()).toBe(0);
    expect(await f.db.moduleRun.count()).toBe(0);
    await runAdmin("disable", [f.module.name], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ status: "paused" });
    expect(await f.db.audit.findFirst({ where: { kind: "module_disabled" } })).toMatchObject({ actorKey: "user", details: { source: "cli" } });
  } finally { log.mockRestore(); }
});

test("admin rollback rejects malformed hashes and builtin token without changing state", async () => {
  const f = await fixture();
  for (const hash of [undefined, "", "builtin", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "A".repeat(40), "A".repeat(64), "g".repeat(40), "g".repeat(64)]) {
    await expect(runAdmin("rollback", hash === undefined ? [f.module.name] : [f.module.name, hash], f.options)).rejects.toThrow("external module version hash");
  }
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "a".repeat(64) });
  expect(await f.db.generation.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "admin_rollback" } })).toBe(0);
});

test.each([40, 64])("admin rollback still rejects unapproved or absent %i-character hashes", async hashLength => {
  const f = await fixture(hashLength);
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.module.id, hash: "b".repeat(hashLength) } } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "pending_review" } });
  for (const hash of [version.hash, "c".repeat(hashLength)]) await expect(runAdmin("rollback", [f.module.name, hash], f.options)).rejects.toThrow("Module version is not approved");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "a".repeat(hashLength) });
  expect(await f.db.generation.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "admin_rollback" } })).toBe(0);
});

test("admin install queues trusted official code offline, preserves the lock and deduplicates request keys", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const previous = process.env.CHRONA_RESOURCE_DIR;
  process.env.CHRONA_RESOURCE_DIR = await offlineResources(f.options.dataDir, "author");
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try { await expect(runAdmin("install", ["author", "install", "offline-one"], f.options)).rejects.toThrow("already in use"); }
  finally { lock.release(); }
  try {
    const receipt = await runAdmin("install", ["author", "install", "offline-one"], f.options);
    expect(receipt).toMatchObject({ package: "author", status: "building", moduleId: expect.any(String), hash: expect.any(String) });
    expect(await runAdmin("install", ["author", "install", "offline-one"], f.options)).toEqual(receipt);
    expect(await f.db.moduleVersion.count({ where: { module: { name: "author" } } })).toBe(1);
    expect(await f.db.stewardState.count()).toBe(0);
    expect(await f.db.run.count()).toBe(0);
    expect(await f.db.moduleRun.count()).toBe(0);
    expect(log.mock.calls.some(call => String(call[0]).includes("Restart Chrona"))).toBe(true);
    await expect(runAdmin("install", ["../private", "install", "invalid"], f.options)).rejects.toThrow("Invalid");
    const released = acquireSqliteRuntimeLock(f.options.databaseUrl); released.release();
  } finally {
    if (previous === undefined) delete process.env.CHRONA_RESOURCE_DIR; else process.env.CHRONA_RESOURCE_DIR = previous;
    log.mockRestore();
  }
});

test.each(["author", "files", "events", "mcp", "mind"])("stopped-service official %s recovery needs no other entry, Provider or tick", async name => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const previous = process.env.CHRONA_RESOURCE_DIR;
  process.env.CHRONA_RESOURCE_DIR = await offlineResources(f.options.dataDir, name);
  try {
    expect(await f.db.module.count({ where: { name: { in: ["web", "mcp"] } } })).toBe(0);
    expect(await runAdmin("catalog", [], f.options)).toContainEqual(expect.objectContaining({ name, available: true, moduleId: null }));
    const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
    try { await expect(runAdmin("install", [name, "install", `recover-${name}`], f.options)).rejects.toThrow("already in use"); }
    finally { lock.release(); }
    const receipt = await runAdmin("install", [name, "install", `recover-${name}`], f.options);
    expect(receipt).toMatchObject({ package: name, status: "building", moduleId: expect.any(String), hash: expect.any(String) });
    expect(await runAdmin("install", [name, "install", `recover-${name}`], f.options)).toEqual(receipt);
    expect(await f.db.module.findFirstOrThrow({ where: { name } })).toMatchObject({ builtin: false, activeHash: null });
    expect(await f.db.moduleVersion.count({ where: { module: { name }, status: "building" } })).toBe(1);
    expect(await f.db.module.count()).toBe(2);
    expect(await f.db.stewardState.count()).toBe(0);
    expect(await f.db.run.count()).toBe(0);
    expect(await f.db.moduleRun.count()).toBe(0);
    expect(log.mock.calls.some(call => String(call[0]).includes("Restart Chrona"))).toBe(true);
    const released = acquireSqliteRuntimeLock(f.options.databaseUrl); released.release();
  } finally {
    if (previous === undefined) delete process.env.CHRONA_RESOURCE_DIR; else process.env.CHRONA_RESOURCE_DIR = previous;
    log.mockRestore();
  }
});

test.each(["remind"])("offline admin cannot reinstall paused %s", async name => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runAdmin("catalog", [], f.options)).toContainEqual(expect.objectContaining({ name, available: false, error: expect.stringContaining("paused") }));
    await expect(runAdmin("install", [name, "install", `paused-${name}`], f.options)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
    expect(await f.db.module.count()).toBe(1);
    expect(await f.db.moduleVersion.count()).toBe(2);
    expect(await f.db.run.count()).toBe(0);
  } finally { log.mockRestore(); }
});

test("secret-set saves a module credential from stdin as a private file and never prints it", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-admin-secret-")), log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(setSecret("okx_demo", "not json", { dataDir })).rejects.toThrow("JSON object");
    await expect(setSecret("qq_bot", '{"a":"b"}', { dataDir })).rejects.toThrow("Invalid credential name");
    await setSecret("okx_demo", JSON.stringify({ apiKey: "k-secret" }), { dataDir });
    expect(statSync(join(dataDir, "secrets", "okx_demo.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dataDir, "secrets", "okx_demo.json"), "utf8"))).toEqual({ apiKey: "k-secret" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("k-secret");
    await removeSecret("okx_demo", { dataDir });
    expect(existsSync(join(dataDir, "secrets", "okx_demo.json"))).toBe(false);
  } finally { log.mockRestore(); }
});
