import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createStewardService } from "@chrona/engine";
import { runAdmin } from "./admin";
import { createProgram } from "./program";

const dbs: PrismaClient[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-admin-test-")), databaseUrl = `file:${join(dataDir, "chrona.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) }); dbs.push(db);
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const module = await db.module.create({ data: { workspaceId: "ws_default", name: "entry", status: "active", activeHash: "a".repeat(64), dataSchema: 1 } });
  const manifest = { name: "entry", entry: "index.ts", keepAlive: true, triggers: [], effects: ["owner"], tests: ["test.ts"] };
  for (const hash of ["a", "b"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash: hash.repeat(64), manifest, intent: {}, report: {}, source: hash === "a" ? "builtin" : "user", status: "approved" } });
  const ports = { db, dataDir, now: () => new Date(), deliveries: [], publicUrl: null, chat: null };
  const api = createStewardService(ports).forWorkspace("ws_default");
  return { db, module, api, options: { dataDir, databaseUrl } };
}
test("admin commands are registered", () => {
  const admin = createProgram().commands.find(c => c.name() === "admin")!;
  expect(admin.commands.map(c => c.name())).toEqual(["modules", "approvals", "rollback", "disable", "approve", "reject"]);
});
test("admin reads while runtime locked but refuses writes; approval audit source is cli", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  const approval = await f.api.approvals.create({ action: "change_policy", title: "Settings", detail: "Review", preview: "diff", payload: {} });
  const lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try {
    expect(await runAdmin("approvals", [], f.options)).toContainEqual(expect.objectContaining({ rescueOnly: true }));
    expect(await runAdmin("modules", [], f.options)).toContainEqual({ name: "rescue", status: "immutable" });
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
test("admin rollback uses hash-bound rescue approvals, supports builtin, and disable pauses schedules", async () => {
  const f = await fixture(), log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await runAdmin("rollback", [f.module.name, "b".repeat(64)], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ activeHash: "b".repeat(64) });
    expect(await f.db.approval.findFirst({ where: { moduleId: f.module.id } })).toMatchObject({ rescueOnly: true, status: "approved", payload: { hash: "b".repeat(64) } });
    await runAdmin("rollback", [f.module.name, "builtin"], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ activeHash: "a".repeat(64) });
    await runAdmin("disable", [f.module.name], f.options);
    expect(await f.db.module.findUnique({ where: { id: f.module.id } })).toMatchObject({ status: "paused" });
    expect(await f.db.audit.findFirst({ where: { kind: "module_disabled" } })).toMatchObject({ actorKey: "user", details: { source: "cli" } });
  } finally { log.mockRestore(); }
});
