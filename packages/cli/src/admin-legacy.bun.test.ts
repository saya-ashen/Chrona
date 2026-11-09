import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { adminLegacy } from "./admin-legacy";
import { createProgram } from "./program";

const fixtures: { db: PrismaClient; root: string }[] = [];
afterEach(async () => {
  for (const { db, root } of fixtures.splice(0)) { await db.$disconnect(); rmSync(root, { recursive: true, force: true }); }
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-admin-legacy-"));
  const dataDir = join(root, "data"), databaseUrl = `file:${join(dataDir, "chrona.db")}`;
  mkdirSync(join(dataDir, "platform/data/chat"), { recursive: true });
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  fixtures.push({ db, root });
  const workspace = await db.workspace.create({ data: { name: "isolated CLI legacy test" } });
  const session = await db.session.create({ data: { workspaceId: workspace.id, source: "web", key: "old", title: "old title" } });
  const attachment = join(dataDir, "platform/data/chat/old.txt");
  writeFileSync(attachment, "old");
  await db.message.create({ data: { workspaceId: workspace.id, sessionId: session.id, direction: "in", channel: "web", text: "old transcript", attachments: [{ ref: "chat/old.txt", name: "old.txt", size: 3 }] } });
  const scope = { workspaceId: workspace.id, sessionIds: [session.id], outputDir: join(root, "archive") };
  const file = join(root, "request.json");
  return { db, session, attachment, scope, file, options: { dataDir, databaseUrl }, write(request: unknown) { writeFileSync(file, JSON.stringify(request)); return file; } };
}

test("admin legacy is registered with a required request file", () => {
  const command = createProgram().commands.find(c => c.name() === "admin")!.commands.find(c => c.name() === "legacy")!;
  expect(command.registeredArguments.map(arg => ({ name: arg.name(), required: arg.required }))).toEqual([{ name: "request-file", required: true }]);
});

test("CLI export → pinned verify → explicit delete uses only selected temporary data", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const exported = await adminLegacy(f.write({ operation: "export", ...f.scope }), f.options);
    const manifestSha256 = (exported as { manifestSha256: string }).manifestSha256;
    expect(manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(exported).toMatchObject({ sessions: 1, messages: 1, files: 1 });
    expect(await adminLegacy(f.write({ operation: "verify", ...f.scope, manifestSha256 }), f.options)).toEqual(exported);
    await expect(adminLegacy(f.write({ operation: "delete", ...f.scope, manifestSha256 }), f.options)).rejects.toThrow();
    expect(await f.db.message.count()).toBe(1);
    await expect(adminLegacy(f.write({ operation: "delete", ...f.scope, manifestSha256: "0".repeat(64), authorizeDelete: true }), f.options)).rejects.toThrow("digest mismatch");
    expect(await f.db.message.count()).toBe(1);
    expect(await adminLegacy(f.write({ operation: "delete", ...f.scope, manifestSha256, authorizeDelete: true }), f.options)).toMatchObject({ deletedMessages: 1, deletedFiles: 1, retainedSessionIdentities: 1 });
    expect(await f.db.message.count()).toBe(0);
    expect(await f.db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({ title: null, status: "ended" });
    expect(existsSync(f.attachment)).toBe(false);
    expect(existsSync(join(f.scope.outputDir, "manifest.json"))).toBe(true);
    expect(await f.db.module.count()).toBe(0);
    expect(await f.db.run.count()).toBe(0);
    expect(await f.db.stewardState.count()).toBe(0);
    const lock = acquireSqliteRuntimeLock(f.options.databaseUrl); lock.release();
  } finally { log.mockRestore(); }
});

test.each(["export", "verify", "delete"])("CLI %s refuses a live runtime lock before touching archive/source", async operation => {
  const f = await fixture();
  const request = { operation, ...f.scope, ...(operation === "export" ? {} : { manifestSha256: "a".repeat(64) }), ...(operation === "delete" ? { authorizeDelete: true } : {}) };
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try {
    await expect(adminLegacy(f.write(request), f.options)).rejects.toThrow("already in use");
    expect(existsSync(f.scope.outputDir)).toBe(false);
    expect(existsSync(f.attachment)).toBe(true);
    expect(await f.db.message.count()).toBe(1);
  } finally { lock.release(); }
});

test("CLI rejects malformed, unbounded, implicit or extra request fields before opening a database", async () => {
  const f = await fixture();
  const options = { ...f.options, databaseUrl: `file:${join(f.options.dataDir, "absent.db")}` };
  const base = { operation: "export", ...f.scope };
  for (const request of [null, {}, { ...base, operation: "unknown" }, { ...base, workspaceId: "" }, { ...base, sessionIds: [] }, { ...base, sessionIds: ["x", "x"] }, { ...base, sessionIds: Array(1001).fill("x") }, { ...base, outputDir: "x".repeat(4097) }, { ...base, offline: true }, { ...base, operation: "verify" }, { ...base, operation: "verify", manifestSha256: "bad" }, { ...base, operation: "delete", manifestSha256: "a".repeat(64), authorizeDelete: false }]) {
    await expect(adminLegacy(f.write(request), options)).rejects.toThrow();
  }
  writeFileSync(f.file, "{");
  await expect(adminLegacy(f.file, options)).rejects.toThrow();
  writeFileSync(f.file, " ".repeat(65537));
  await expect(adminLegacy(f.file, options)).rejects.toThrow();
  expect(existsSync(join(f.options.dataDir, "absent.db"))).toBe(false);
  expect(existsSync(f.scope.outputDir)).toBe(false);
  await expect(adminLegacy(f.write(base), options)).rejects.toThrow("Chrona database not found");
});

test("CLI rejects removed migrate-wake before database access and preserves legacy rows", async () => {
  const f = await fixture();
  const timer = await f.db.schedule.create({ data: { workspaceId: f.scope.workspaceId, originSessionId: f.session.id, mode: "wake", rule: { kind: "every", minutes: 60 }, text: "Legacy timer", status: "paused", nextAt: null, failures: 2, createdBy: "user" } });
  const request = { operation: "migrate-wake", workspaceId: f.scope.workspaceId, offline: true, limit: 1, owners: [{ moduleId: "owner", hash: "checked" }] };
  const absent = join(f.options.dataDir, "absent.db");
  for (const options of [f.options, { ...f.options, databaseUrl: `file:${absent}` }]) {
    await expect(adminLegacy(f.write(request), options)).rejects.toMatchObject({ name: "ZodError", issues: [expect.objectContaining({ path: ["operation"], code: "invalid_union" })] });
  }
  expect(existsSync(absent)).toBe(false);
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toEqual(timer);
  expect(await f.db.message.count()).toBe(1);
  expect(existsSync(f.attachment)).toBe(true);
  expect(existsSync(f.scope.outputDir)).toBe(false);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl); lock.release();
});

test("CLI stop guard rejects active Run evidence and releases maintenance ownership", async () => {
  const f = await fixture();
  await f.db.run.create({ data: { workspaceId: f.scope.workspaceId, sessionId: f.session.id, lane: "background", trigger: "message", status: "running", tokenHash: "temporary-only", provider: "fake", prompt: "test", cwd: f.options.dataDir } });
  await expect(adminLegacy(f.write({ operation: "export", ...f.scope }), f.options)).rejects.toThrow("live or unknown Run/execution evidence");
  expect(existsSync(f.scope.outputDir)).toBe(false);
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl); lock.release();
});
