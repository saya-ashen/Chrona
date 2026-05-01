import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

import { createProgram } from "../../common/cli/src/program";

// ──────────────────────────────────────────────────────────────
// Runtime guard
// ──────────────────────────────────────────────────────────────

if (typeof globalThis.Bun === "undefined") {
  throw new Error(
    "Chrona binary requires Bun. This should never happen — the binary embeds Bun. " +
    "If you see this, your executable may be corrupted.",
  );
}

// ──────────────────────────────────────────────────────────────
// Executable / resources location
// ──────────────────────────────────────────────────────────────

function getExecutableDir(): string {
  return dirname(process.execPath);
}

function getResourcesDir(): string {
  if (process.env.CHRONA_RESOURCES_DIR) {
    return resolve(process.env.CHRONA_RESOURCES_DIR);
  }
  return join(getExecutableDir(), "resources");
}

const resourcesDir = getResourcesDir();

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

function getLogsDir(): string {
  return join(getDataDir(), "logs");
}

// ──────────────────────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────────────────────

function ensureDirs() {
  mkdirSync(getDataDir(), { recursive: true });
  mkdirSync(getConfigDir(), { recursive: true });
  mkdirSync(getLogsDir(), { recursive: true });
}

function ensureEnv() {
  const envPath = join(getConfigDir(), ".env");
  if (existsSync(envPath)) return;
  const examplePath = join(resourcesDir, ".env.example");
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
  const migrationsDir = join(resourcesDir, "prisma", "migrations");

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
// Port check
// ──────────────────────────────────────────────────────────────

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({ port, hostname: "0.0.0.0", socket: { data() {} } });
    server.stop(true);
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EADDRINUSE") || msg.includes("in use") || msg.includes("Address in use")) {
      return true;
    }
    throw err;
  }
}

async function checkAlreadyRunning(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const body = await resp.json().catch(() => null);
      if (body && typeof body === "object" && "status" in body) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Server start
// ──────────────────────────────────────────────────────────────

async function startServerMode() {
  ensureDirs();
  ensureEnv();

  process.env.CHRONA_WEB_DIST = join(resourcesDir, "apps", "web", "dist");
  process.env.DATABASE_URL = `file:${join(getDataDir(), "dev.db")}`;

  banner();

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  console.log(`  Data:   ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log(`  Logs:   ${getLogsDir()}`);
  console.log(`  Web UI: ${process.env.CHRONA_WEB_DIST}`);
  console.log("");

  const port = Number.parseInt(process.env.PORT ?? "3101", 10);

  // Check if port is in use and whether Chrona is already running
  if (await isPortInUse(port)) {
    if (await checkAlreadyRunning(port)) {
      console.log(`✓  Chrona is already running on http://localhost:${port}`);
      console.log("");
      openBrowser(port);
      return;
    }
    console.error(`❌ Port ${port} is already in use by another process.`);
    console.error("   Stop the other process or set PORT=<other> to use a different port.");
    process.exit(1);
  }

  const dbPath = join(dataDir, "dev.db");
  if (!isDbInitialized(dbPath)) {
    console.log("🗄️  Setting up database...");
    runMigrations();
    console.log("✅ Database ready.");
    console.log("");
  }

  const distIndex = join(resourcesDir, "apps", "web", "dist", "index.html");
  if (!existsSync(distIndex)) {
    console.error("❌ Frontend build not found in resources.");
    console.error("   Expected: " + distIndex);
    process.exit(1);
  }

  console.log(`🚀 Starting Chrona on http://localhost:${port}`);
  console.log("");

  setTimeout(() => {
    openBrowser(port);
  }, 1500);

  // Dynamic import to avoid module caching issues in compiled mode
  const { startBunServer } = await import("@server/index.bun");
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
