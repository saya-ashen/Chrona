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
    for (const name of (await readdir(source)).filter(name => /^\d/.test(name) && name < "0011")) await cp(join(source, name), join(migrationsDir, name), { recursive: true });
    ensureSqliteDatabase({ databaseUrl, migrationsDir });
    const sqlite = new Database(join(dataDir, "test.db"));
    try {
      sqlite.run('INSERT INTO "Workspace" (id, name, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)', ["w", "Migration"]);
      sqlite.run('INSERT INTO "Schedule" (id, workspaceId, mode, rule, text, label, createdBy, nextAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ["00000000-0000-0000-0000-000000000001", "w", "remind", JSON.stringify({ kind: "at", at: now.toISOString() }), "Migrated reminder", "Old label", "user", now.toISOString().replace("Z", "+00:00")]);
    } finally { sqlite.close(); }
    await cp(join(source, "0011_schedule_payload"), join(migrationsDir, "0011_schedule_payload"), { recursive: true });
    ensureSqliteDatabase({ databaseUrl, migrationsDir });
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  } else {
    db = testDb();
    await db.workspace.create({ data: { id: "w", name: "Reminders" } });
  }
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, deliveries: [], chat: null, moduleBuiltinResources: resources,
    sandbox: { ...sandbox.health, runModule: sandbox.runModule, startModule: sandbox.startModule } };
  const service = createStewardService(ports), api = service.forWorkspace("w");
  return { db, ports, service, api, async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

test.each([
  [true, true, true],
  [true, false, false],
  [false, true, false],
  [false, false, false],
])("dynamic reminder creation: builtin=%s dynamicSchedules=%s allowed=%s", async (builtin, dynamicSchedules, allowed) => {
  const f = await fixture();
  try {
    const module = await f.db.module.create({ data: { workspaceId: "w", name: "remind", builtin, status: "active", activeHash: "fixture" } });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "fixture", source: "builtin", status: "active", intent: "fixture", report: {},
      manifest: { name: "remind", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, dynamicSchedules, effects: ["notify_user"], params: {}, data: { schema: 1 } } } });
    const create = () => f.api.schedules.create(undefined, { mode: "remind", rule: { kind: "at", at: now.toISOString() }, text: "Remember" });
    if (allowed) {
      expect(await create()).toMatchObject({ mode: "module", moduleId: module.id });
    } else {
      await expect(create()).rejects.toThrow("does not accept dynamic schedules");
      expect(await f.db.schedule.count()).toBe(0);
    }
  } finally { await f.close(); }
});

if (!sandbox.health.available) console.info("SKIP remind real process: bwrap sandbox unavailable");
const sandboxTest = sandbox.health.available ? test : test.skip;
sandboxTest("chrona_schedule reminder runs built-in author tests, not a Provider; dynamic schedules survive reactivation", async () => {
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
    const schedule = await f.service.tools.call(run.token, "chrona_schedule", { mode: "remind", rule: { kind: "at", at: now.toISOString() }, text: "喝水", label: "Drink water" }) as { id: string };
    expect(await f.db.schedule.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ mode: "module", moduleId: module.id, payload: { text: "喝水" }, label: "Drink water" });
    await f.api.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null });
    await f.api.modules.activate(module.id, module.activeHash!, "rollback");
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await f.api.schedules.fireDue()).toBe(0);
    expect(await f.db.notification.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ title: "提醒", body: "喝水" });
    expect(await f.db.moduleCall.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ method: "notify", status: "executed" });
    expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ exitCode: 0 });
    expect(await f.db.run.count()).toBe(1);
  } finally { await f.close(); }
}, 30_000);

sandboxTest("0011 migrates an old remind row; registration attaches it idempotently and the module fires", async () => {
  const f = await fixture(true);
  try {
    expect(await f.db.schedule.findFirstOrThrow()).toMatchObject({ mode: "module", moduleId: null, payload: { text: "Migrated reminder" }, label: "Old label" });
    await registerBuiltins(f.ports, "w");
    await registerBuiltins(f.ports, "w");
    const module = await f.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: "w", name: "remind" } } });
    expect(await f.db.schedule.findFirstOrThrow()).toMatchObject({ moduleId: module.id, status: "active" });
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await f.db.notification.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ title: "提醒", body: "Migrated reminder" });
    expect(await f.db.run.count()).toBe(0);
  } finally { await f.close(); }
}, 30_000);
