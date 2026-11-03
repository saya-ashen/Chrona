import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { registerBuiltins } from "./module-builtin";
import { moduleSupervisor } from "./module-supervisor";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notice } from "./test-notices";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
const now = new Date("2026-10-22T12:00:00Z");
const resources = resolve(import.meta.dirname, "builtin");
async function fixture(migrated = false) {
  const dataDir = await mkdtemp("/tmp/chrona-remind-");
  let db: ReturnType<typeof testDb>;
  if (migrated) {
    const migrationsDir = join(dataDir, "migrations"), databaseUrl = `file:${join(dataDir, "test.db")}`;
    await mkdir(migrationsDir);
    const source = resolve("prisma/migrations");
    for (const name of (await readdir(source)).filter(name => /^\d/.test(name) && name < "0018")) await cp(join(source, name), join(migrationsDir, name), { recursive: true });
    ensureSqliteDatabase({ databaseUrl, migrationsDir });
    const sqlite = new Database(join(dataDir, "test.db"));
    try {
      // A reminder as chrona_schedule mode remind stored it: owned by the built-in remind module, its text in text and payload.
      sqlite.run('INSERT INTO "Workspace" (id, name, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)', ["w", "Migration"]);
      sqlite.run('INSERT INTO "Module" (id, workspaceId, name, builtin) VALUES (?, ?, ?, 1)', ["remind-id", "w", "remind"]);
      sqlite.run('INSERT INTO "Schedule" (id, workspaceId, mode, rule, text, label, createdBy, nextAt, moduleId, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ["00000000-0000-0000-0000-000000000001", "w", "module", JSON.stringify({ kind: "at", at: now.toISOString() }), "Migrated reminder", "Old label", "user", now.toISOString().replace("Z", "+00:00"), "remind-id", JSON.stringify({ text: "Migrated reminder" })]);
    } finally { sqlite.close(); }
    for (const name of (await readdir(source)).filter(name => /^\d/.test(name) && name >= "0018")) await cp(join(source, name), join(migrationsDir, name), { recursive: true });
    ensureSqliteDatabase({ databaseUrl, migrationsDir });
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  } else {
    db = testDb();
    await db.workspace.create({ data: { id: "w", name: "Reminders" } });
  }
  const runtime = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, moduleBuiltinResources: resources,
    sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  const service = createStewardService(ports), api = service.forWorkspace("w");
  return { db, ports, service, api, async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

if (!sandbox.health.available) console.info("SKIP remind real process: bwrap sandbox unavailable");
const sandboxTest = sandbox.health.available ? test : test.skip;
sandboxTest("m_remind_create reminder runs built-in author tests, not a Provider; its timer survives reactivation", async () => {
  const f = await fixture();
  try {
    await registerBuiltins(f.ports, "w");
    const module = await f.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: "w", name: "remind" } } });
    expect(module).toMatchObject({ builtin: true, status: "active" });
    expect(await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ report: { tests: [{ exitCode: 0 }] } });
    expect(await f.db.approval.count()).toBe(0);
    const session = await f.db.session.create({ data: { workspaceId: "w", key: "web:test", source: "web" } });
    await f.api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Fixture" });
    const run = (await f.api.runs.claimNext("foreground"))!;
    await expect(f.service.tools.call(run.token, "chrona_schedule", { mode: "remind", rule: { kind: "at", at: now.toISOString() }, text: "喝水", label: "Drink water" })).rejects.toThrow();
    const created = await f.service.tools.call(run.token, "m_remind_create", { rule: JSON.stringify({ kind: "at", at: now.toISOString() }), text: "喝水", label: "Drink water" }) as { result: { key: string } };
    expect(await f.db.schedule.findFirstOrThrow({ where: { text: created.result.key } })).toMatchObject({ mode: "module", moduleId: module.id, payload: { text: "喝水" }, label: "Drink water" });
    await f.api.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null });
    await f.api.modules.activate(module.id, module.activeHash!, "rollback");
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await f.api.schedules.fireDue()).toBe(0);
    expect(await notice(f.db, { moduleId: module.id })).toMatchObject({ title: "提醒", body: "喝水" });
    expect(await f.db.moduleCall.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ method: "call", status: "executed" });
    expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ exitCode: 0 });
    expect(await f.db.run.count()).toBe(1);
  } finally { await f.close(); }
}, 30_000);

sandboxTest("0018 turns a Provider reminder into a remind timer the module lists and fires", async () => {
  const f = await fixture(true);
  try {
    expect(await f.db.schedule.findFirstOrThrow()).toMatchObject({ mode: "module", moduleId: "remind-id", text: "legacy-00000000-0000-0000-0000-000000000001", payload: { text: "Migrated reminder" }, label: "Old label" });
    await registerBuiltins(f.ports, "w");
    const module = await f.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: "w", name: "remind" } } });
    expect(module).toMatchObject({ id: "remind-id", status: "active" });
    expect(await f.api.schedules.forModule(module.id, "remind").list()).toMatchObject([{ key: "legacy-00000000-0000-0000-0000-000000000001", payload: { text: "Migrated reminder" } }]);
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await notice(f.db, { moduleId: module.id })).toMatchObject({ title: "提醒", body: "Migrated reminder" });
    expect(await f.db.run.count()).toBe(0);
  } finally { await f.close(); }
}, 30_000);
