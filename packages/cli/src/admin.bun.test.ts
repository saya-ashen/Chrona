import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createStewardService } from "@chrona/engine";
import { removeSecret, runAdmin, setSecret } from "./admin";
import { createProgram } from "./program";

const dbs: PrismaClient[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-admin-test-")), databaseUrl = `file:${join(dataDir, "chrona.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) }); dbs.push(db);
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const module = await db.module.create({ data: { workspaceId: "ws_default", name: "entry", status: "active", activeHash: "a".repeat(64), dataSchema: 1 } });
  const manifest = { name: "entry", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["chat.send"], tests: ["test.ts"] };
  for (const hash of ["a", "b"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash: hash.repeat(64), manifest, intent: {}, report: {}, source: hash === "a" ? "builtin" : "user", status: "approved" } });
  const ports = { db, dataDir, now: () => new Date(), publicUrl: null };
  const api = createStewardService(ports).forWorkspace("ws_default");
  return { db, module, api, options: { dataDir, databaseUrl } };
}
test("admin commands are registered", () => {
  const admin = createProgram().commands.find(c => c.name() === "admin")!;
  expect(admin.commands.map(c => c.name())).toEqual(["modules", "diagnostics", "approvals", "rollback", "disable", "approve", "reject", "secret-set", "secret-remove"]);
});
test("admin reads while runtime locked but refuses writes; approval audit source is cli", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const approval = await f.api.approvals.create({ action: "change_policy", title: "Settings", detail: "Review", preview: "diff", payload: {} });
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
    const second = await f.api.approvals.create({ action: "change_policy", title: "Settings", detail: "Review", preview: "diff", payload: {} });
    await runAdmin("reject", [second.id], f.options);
    expect(await f.db.approval.findUnique({ where: { id: second.id } })).toMatchObject({ status: "denied" });
    expect(log.mock.calls.some(call => String(call[0]).includes("Restart Chrona"))).toBe(true);
  } finally { log.mockRestore(); }
});
test("admin rollback activates entry modules directly, supports builtin, and disable pauses schedules", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await runAdmin("rollback", [f.module.name, "b".repeat(64)], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ activeHash: "b".repeat(64) });
    expect(await f.db.approval.count({ where: { moduleId: f.module.id } })).toBe(0);
    await runAdmin("rollback", [f.module.name, "builtin"], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ activeHash: "a".repeat(64) });
    await runAdmin("disable", [f.module.name], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ status: "paused" });
    expect(await f.db.audit.findFirst({ where: { kind: "module_disabled" } })).toMatchObject({ actorKey: "user", details: { source: "cli" } });
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
