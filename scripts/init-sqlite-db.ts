#!/usr/bin/env bun

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const templateIndex = args.indexOf("--template");
const templateArg = templateIndex >= 0 ? args[templateIndex + 1] : undefined;
const dbArg = args.find((arg, index) => arg !== "--reset" && arg !== "--template" && index !== templateIndex + 1);

if (!dbArg) {
  console.error("Usage: bun run scripts/init-sqlite-db.ts [--reset] [--template <template-db-path>] <db-path>");
  process.exit(1);
}

const dbPath = resolve(dbArg);
const templatePath = templateArg ? resolve(templateArg) : undefined;
const migrationsDir = resolve(dirname(import.meta.dirname), "prisma", "migrations");

if (reset && existsSync(dbPath)) {
  rmSync(dbPath, { force: true });
}

if (templatePath && existsSync(templatePath)) {
  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(templatePath, dbPath);
  process.exit(0);
}

ensureSqliteDatabase({
  databaseUrl: `file:${dbPath}`,
  migrationsDir,
  reset,
});
