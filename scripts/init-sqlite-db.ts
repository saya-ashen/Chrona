#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const templateIndex = args.indexOf("--template");
const templateArg = templateIndex >= 0 ? args[templateIndex + 1] : undefined;
const dbArg = args.find((arg, index) => arg !== "--reset" && arg !== "--template" && index !== templateIndex + 1);

if (!dbArg) {
  console.error("Usage: bun run scripts/init-sqlite-db.ts [--reset] <db-path>");
  process.exit(1);
}

const dbPath = resolve(dbArg);
const templatePath = templateArg ? resolve(templateArg) : undefined;
const migrationsDir = resolve(dirname(import.meta.dirname), "prisma", "migrations");

if (reset && existsSync(dbPath)) {
  rmSync(dbPath, { force: true });
}

if (templatePath && existsSync(templatePath)) {
  copyFileSync(templatePath, dbPath);
}

const db = new Database(dbPath);

function hasColumn(table: string, column: string) {
  const columns = db.query(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (hasColumn(table, column)) {
    return;
  }

  db.run(`ALTER TABLE "${table.replaceAll('"', '""')}" ADD COLUMN "${column.replaceAll('"', '""')}" ${definition}`);
}

function hasTable(table: string) {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | null;
  return Boolean(row);
}

function recreateCurrentTaskTable() {
  db.run("PRAGMA foreign_keys = OFF");
  db.run('DROP TABLE IF EXISTS "Task"');
  db.run(`CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "executionRuntime" TEXT NOT NULL DEFAULT 'hermes',
    "executionConfig" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "parentTaskId" TEXT,
    "dueAt" DATETIME,
    "blockReason" JSONB,
    "defaultSessionId" TEXT,
    "latestRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`);
  db.run('CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status")');
  db.run('CREATE INDEX "Task_workspaceId_priority_idx" ON "Task"("workspaceId", "priority")');
  db.run('CREATE INDEX "Task_defaultSessionId_idx" ON "Task"("defaultSessionId")');
  db.run("PRAGMA foreign_keys = ON");
}

function applyCurrentSchemaCompatibility() {
  if (!hasTable("Task")) {
    return;
  }

  if (hasColumn("Task", "ownerType")) {
    recreateCurrentTaskTable();
    return;
  }

  addColumnIfMissing("Task", "executionRuntime", "TEXT NOT NULL DEFAULT 'hermes'");
  addColumnIfMissing("Task", "executionConfig", "JSONB NOT NULL DEFAULT '{}'");
}

try {
  if (templatePath && existsSync(templatePath)) {
    db.run("PRAGMA foreign_keys = OFF");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'")
      .all() as Array<{ name: string }>;

    for (const { name } of tables) {
      db.run(`DELETE FROM "${name.replaceAll('"', '""')}"`);
    }

    db.run("PRAGMA foreign_keys = ON");
    process.exit(0);
  }

  db.run(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);

  const applied = db
    .query("SELECT migration_name FROM _prisma_migrations")
    .all() as Array<{ migration_name: string }>;
  const appliedNames = new Set(applied.map((migration) => migration.migration_name));

  for (const entry of readdirSync(migrationsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || appliedNames.has(entry.name)) {
      continue;
    }

    const sqlPath = join(migrationsDir, entry.name, "migration.sql");
    if (!existsSync(sqlPath)) {
      continue;
    }

    const sql = readFileSync(sqlPath, "utf8");
    const hasExecutableStatement = sql
      .split(/\r?\n/)
      .some((line) => line.trim() && !line.trim().startsWith("--"));

    if (hasExecutableStatement) {
      db.run(sql);
    }
    db.run(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), "", entry.name, new Date().toISOString(), 1],
    );
  }

  applyCurrentSchemaCompatibility();
} finally {
  db.close();
}
