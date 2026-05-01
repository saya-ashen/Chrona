import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

import { createProgram } from "../../common/cli/src/program";
import { startBunServer } from "@server/index.bun";

// ──────────────────────────────────────────────────────────────
// Package location
// ──────────────────────────────────────────────────────────────

const packageDir = process.env.CHRONA_PACKAGE_DIR
  ?? resolve(dirname(import.meta.dirname), "..");

// ──────────────────────────────────────────────────────────────
// Platform paths
// ──────────────────────────────────────────────────────────────

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
}

function getDataDir(): string {
  if (process.env.CHRONA_DATA_DIR) return process.env.CHRONA_DATA_DIR;
  const home = getHome();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "chrona");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrona");
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "chrona")
    : join(home, ".local", "share", "chrona");
}

function getConfigDir(): string {
  if (process.env.CHRONA_CONFIG_DIR) return process.env.CHRONA_CONFIG_DIR;
  const home = getHome();
  if (process.platform === "darwin") return join(home, "Library", "Preferences", "chrona");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrona");
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "chrona")
    : join(home, ".config", "chrona");
}

// ──────────────────────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────────────────────

function ensureDirs() {
  mkdirSync(getDataDir(), { recursive: true });
  mkdirSync(getConfigDir(), { recursive: true });
}

function ensureEnv() {
  const envPath = join(getConfigDir(), ".env");
  if (existsSync(envPath)) return;
  const examplePath = join(packageDir, ".env.example");
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
  }
}

// ──────────────────────────────────────────────────────────────
// DB initialization check (before Prisma connects)
// ──────────────────────────────────────────────────────────────

function isDbInitialized(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'",
      ).all() as Array<{ name: string }>;
      return result.length > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Migrations via bun:sqlite
// ──────────────────────────────────────────────────────────────

function runMigrations(): boolean {
  const dbPath = join(getDataDir(), "dev.db");
  const migrationsDir = join(packageDir, "prisma", "migrations");

  if (!existsSync(migrationsDir)) return true;

  const db = new Database(dbPath);
  try {
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

    const applied = db.query("SELECT migration_name FROM _prisma_migrations")
      .all() as Array<{ migration_name: string }>;
    const appliedNames = new Set(applied.map((r) => r.migration_name));

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (appliedNames.has(entry.name)) continue;
      const sqlPath = join(migrationsDir, entry.name, "migration.sql");
      if (!existsSync(sqlPath)) continue;

      console.log(`  Running migration: ${entry.name}`);
      const sql = readFileSync(sqlPath, "utf-8");
      db.run(sql);

      db.run(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), "", entry.name, new Date().toISOString(), 1],
      );
    }
    return true;
  } finally {
    db.close();
  }
}

// ──────────────────────────────────────────────────────────────
// UI
// ──────────────────────────────────────────────────────────────

function banner() {
  console.log("⚡ Chrona — AI-native task control plane");
  console.log("");
}

function openBrowser(port: number) {
  const url = `http://localhost:${port}`;
  try {
    if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
    } else if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url], { stdio: ["ignore", "ignore", "ignore"] });
    } else {
      Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {
    // best-effort
  }
}

// ──────────────────────────────────────────────────────────────
// Server start
// ──────────────────────────────────────────────────────────────

async function startServerMode() {
  ensureDirs();
  ensureEnv();

  process.env.CHRONA_WEB_DIST = resolve(packageDir, "apps/web/dist");
  process.env.DATABASE_URL = `file:${join(getDataDir(), "dev.db")}`;

  banner();

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  console.log(`  Data:  ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log("");

  const dbPath = join(dataDir, "dev.db");
  if (!isDbInitialized(dbPath)) {
    console.log("🗄️  Setting up database...");
    runMigrations();
    console.log("✅ Database ready.");
    console.log("");
  }

  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  console.log(`🚀 Starting Chrona on http://localhost:${port}`);
  console.log("");

  setTimeout(() => {
    openBrowser(port);
  }, 1500);

  await startBunServer();
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== "start") {
    await createProgram().parseAsync(process.argv);
    return;
  }

  await startServerMode();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
