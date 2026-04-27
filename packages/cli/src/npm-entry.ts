import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createProgram } from "../../common/cli/src/program";

// Package install directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageDir = resolve(__dirname, "..");

// ── Platform paths ──────────────────────────────────────────────

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

// ── Setup ───────────────────────────────────────────────────────

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

async function runMigrations(): Promise<boolean> {
  const dbPath = join(getDataDir(), "dev.db");
  const migrationsDir = join(packageDir, "prisma", "migrations");

  if (!existsSync(migrationsDir)) return true;

  // Dynamic import of better-sqlite3 (native module, externalized at build time)
  let Database: new (path: string) => import("better-sqlite3").Database;
  try {
    const mod = await import("better-sqlite3");
    Database = (mod.default ?? mod) as typeof Database;
  } catch {
    console.log("⚠️  better-sqlite3 not found — skipping auto-migration.");
    console.log("   Run 'npx prisma migrate deploy' manually.");
    return false;
  }

  const db = new Database(dbPath);
  try {
    // Ensure migrations tracking table exists
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);

    // Get already-applied migrations
    const applied = new Set<string>(
      (db.prepare("SELECT migration_name FROM _prisma_migrations").all() as Array<{ migration_name: string }>)
        .map((r) => r.migration_name),
    );

    // Read migration directories in order
    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (applied.has(entry.name)) continue;
      const sqlPath = join(migrationsDir, entry.name, "migration.sql");
      if (!existsSync(sqlPath)) continue;

      console.log(`  Running migration: ${entry.name}`);
      const sql = readFileSync(sqlPath, "utf-8");
      db.exec(sql);

      db.prepare(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), "", entry.name, new Date().toISOString(), 1);
    }
    return true;
  } finally {
    db.close();
  }
}

// ── UI ──────────────────────────────────────────────────────────

function banner() {
  console.log("⚡ Chrona — AI-native task control plane");
  console.log("");
}

function openBrowser(port: number) {
  const url = `http://localhost:${port}`;
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // best-effort
  }
}

// ── Main ────────────────────────────────────────────────────────

async function startServerMode() {
  ensureDirs();
  ensureEnv();

  // Set paths for the bundled app
  process.env.CHRONA_WEB_DIST = resolve(packageDir, "apps/web/dist");
  process.env.DATABASE_URL = `file:${join(getDataDir(), "dev.db")}`;

  banner();

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  console.log(`  Data:  ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log("");

  const dbPath = join(dataDir, "dev.db");
  const isNewDb = !existsSync(dbPath);
  if (isNewDb) {
    console.log("🗄️  Setting up database...");
    await runMigrations();
    console.log("✅ Database ready.");
    console.log("");
  }

  const { startNodeServer } = await import("../../../apps/server/src/index");

  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  console.log(`🚀 Starting Chrona on http://localhost:${port}`);
  console.log("");

  setTimeout(() => {
    openBrowser(port);
  }, 1500);

  await startNodeServer();
}

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
