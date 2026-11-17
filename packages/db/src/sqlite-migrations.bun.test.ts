import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSqliteDatabase } from "./sqlite-migrations";

const models = [
  "Workspace", "Module", "ModuleVersion",
  "ModuleRun", "ModuleCall", "ModuleInvocation", "Timer", "Run",
  "Approval",
  "Audit", "StewardState", "AgentContext",
  "AgentRunAdmission", "AgentCommand", "AgentProvider", "AgentRunProvider", "ProviderLaunch", "RunEvent", "RunInteraction",
  "ModuleMigration", "ModuleInstallation", "ModuleInstallationHead", "ModuleInstallationSubmission", "ModuleRemoval", "ModuleActivation", "ModuleExecutionResult", "KernelFact", "KernelFactConsumer", "CandidateAdmission", "CandidateReceipt", "CandidateMember",
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-migrations-test-"));
  const migrationsDir = join(root, "migrations");
  const initial = join(migrationsDir, "0001_initial");
  mkdirSync(initial, { recursive: true });
  const sqlPath = join(initial, "migration.sql");
  copyFileSync(resolve("packages/db/prisma/migrations/0001_initial/migration.sql"), sqlPath);
  const databasePath = join(root, "test.db");
  return { migrationsDir, databasePath, databaseUrl: `file:${databasePath}`, sqlPath };
}

function inspect<T>(path: string, read: (db: Database) => T): T {
  const db = new Database(path, { readonly: true });
  try { return read(db); } finally { db.close(); }
}

describe("clean steward SQLite baseline", () => {
  test("fresh database contains exactly current models and their actual foreign-key deletion rules", () => {
    const options = fixture();
    ensureSqliteDatabase(options);
    inspect(options.databasePath, (db) => {
      const names = db.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).all().map((row) => row.name).sort();
      expect(names).toEqual([...models, "_chrona_migrations"].sort());
      for (const model of ["AgentContext", "Module", "ModuleInvocation", "Timer", "Run", "Approval", "Audit", "StewardState"]) {
        const keys = db.query<{ table: string; from: string; on_delete: string }, []>(
          `PRAGMA foreign_key_list("${model}")`,
        ).all();
        expect(keys.some((key) => key.table === "Workspace" && key.from === "workspaceId" && key.on_delete === "CASCADE")).toBe(true);
      }
      const contextKeys = db.query<{ table: string; from: string; on_delete: string }, []>('PRAGMA foreign_key_list("AgentContext")').all();
      expect(contextKeys).toContainEqual(expect.objectContaining({ table: "Module", from: "moduleId", on_delete: "SET NULL" }));
      const runKeys = db.query<{ table: string; from: string; on_delete: string }, []>('PRAGMA foreign_key_list("Run")').all();
      expect(runKeys).toContainEqual(expect.objectContaining({ table: "AgentContext", from: "sessionId", on_delete: "SET NULL" }));
    });
  });

  test("fresh database with all migrations has a nullable module schema and no connector tables (v2-8)", () => {
    const options = { ...fixture(), migrationsDir: resolve("packages/db/prisma/migrations") };
    ensureSqliteDatabase(options);
    inspect(options.databasePath, db => {
      expect(db.query('PRAGMA table_info("Module")').all()).toContainEqual(expect.objectContaining({ name: "dataSchema", type: "INTEGER", notnull: 0, dflt_value: null }));
      expect(db.query('PRAGMA table_info("ModuleRun")').all()).not.toContainEqual(expect.objectContaining({ name: "inboundItemId" }));
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
      expect(tables).not.toContain("Connector"); expect(tables).not.toContain("InboundItem");
      expect(db.query('SELECT name FROM "_chrona_migrations" ORDER BY name').all()).toEqual([{ name: "0001_initial" }]);
      const retired = ["ExecutionExecutor", "ExecutorPairing", "ExecutorAssignment", "ExecutorSourceReceipt"];
      for (const name of retired) expect(tables).not.toContain(name);
      expect(tables.filter(name => name !== "_chrona_migrations").sort()).toEqual([...models].sort());
    });
  });

  test("workspace scheduling and delivery indexes exist", () => {
    const options = fixture();
    ensureSqliteDatabase(options);
    inspect(options.databasePath, (db) => {
      for (const [table, columns, unique] of [
        ["Timer", ["workspaceId", "status", "nextAt"], false],
        ["Run", ["workspaceId", "lane", "status", "createdAt"], false],
        ["Run", ["tokenHash"], true],
        ["Approval", ["workspaceId", "status", "createdAt"], false],
        ["Module", ["workspaceId", "name"], true],
      ] as const) {
        const indexes = db.query<{ name: string; unique: number }, []>(`PRAGMA index_list("${table}")`).all();
        expect(indexes.some(index => {
          const actual = db.query<{ name: string }, []>(`PRAGMA index_info("${index.name}")`).all().map(column => column.name);
          return Boolean(index.unique) === unique && JSON.stringify(actual) === JSON.stringify(columns);
        })).toBe(true);
      }
    });
  });

  test("second start is a no-op, preserving history and user records", () => {
    const options = fixture();
    ensureSqliteDatabase(options);
    const db = new Database(options.databasePath);
    db.run('INSERT INTO "Workspace" (id, name, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)', ["ws_default", "Personal"]);
    db.close();
    const before = readFileSync(options.databasePath);
    const messages: string[] = [];
    ensureSqliteDatabase({ ...options, log: (message) => messages.push(message) });
    expect(messages).toEqual([]);
    expect(readFileSync(options.databasePath)).toEqual(before);
  });

  test("tampered applied checksum fails closed before any pending SQL", () => {
    const options = fixture();
    ensureSqliteDatabase(options);
    writeFileSync(options.sqlPath, `${readFileSync(options.sqlPath, "utf8")}\n-- tampered\n`);
    const pending = join(options.migrationsDir, "0002_pending");
    mkdirSync(pending);
    writeFileSync(join(pending, "migration.sql"), 'CREATE TABLE "ShouldNotExist" (id TEXT);');
    const before = readFileSync(options.databasePath);
    expect(() => ensureSqliteDatabase(options)).toThrow("Applied migration checksum changed: 0001_initial");
    expect(readFileSync(options.databasePath)).toEqual(before);
  });

  test("pending folders run in order and a failure rolls back DDL and history", () => {
    const options = fixture();
    ensureSqliteDatabase(options);
    for (const [name, sql] of [
      ["0002_next", 'CREATE TABLE "Next" (id TEXT);'],
      ["0003_invalid", 'INSERT INTO "Missing" VALUES (1);'],
    ] as const) {
      mkdirSync(join(options.migrationsDir, name));
      writeFileSync(join(options.migrationsDir, name, "migration.sql"), sql);
    }
    expect(() => ensureSqliteDatabase(options)).toThrow();
    inspect(options.databasePath, (db) => {
      expect(db.query("SELECT name FROM sqlite_master WHERE name = 'Next'").get()).toBeNull();
      expect(db.query('SELECT name FROM "_chrona_migrations"').all()).toEqual([{ name: "0001_initial" }]);
    });
    writeFileSync(join(options.migrationsDir, "0003_invalid", "migration.sql"), 'INSERT INTO "Next" VALUES (\'ok\');');
    ensureSqliteDatabase(options);
    inspect(options.databasePath, (db) => {
      expect(db.query('SELECT id FROM "Next"').all()).toEqual([{ id: "ok" }]);
    });
  });

  test("old untracked databases are refused without modification", () => {
    const options = fixture();
    const db = new Database(options.databasePath);
    db.exec('CREATE TABLE "Task" (id TEXT);');
    db.close();
    const before = readFileSync(options.databasePath);
    expect(() => ensureSqliteDatabase(options)).toThrow("Refusing an untracked database");
    expect(readFileSync(options.databasePath)).toEqual(before);
  });
});
