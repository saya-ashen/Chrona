import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

import { createProgram } from "./program.js";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";

// ──────────────────────────────────────────────────────────────
// Package location
// ──────────────────────────────────────────────────────────────

const packageDir = process.env.CHRONA_PACKAGE_DIR
  ?? resolve(dirname(import.meta.dirname), "..");

function findResourceDir(): string {
  const candidates = [
    process.env.CHRONA_RESOURCE_DIR,
    join(dirname(Bun.argv[0] ?? process.execPath), "resources"),
    join(packageDir, "resources"),
    packageDir,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "prisma", "migrations"))) {
      return candidate;
    }
  }

  return candidates[0];
}

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
// UI
// ──────────────────────────────────────────────────────────────

function banner() {
  console.log("⚡ Chrona — AI-native task control plane");
  console.log("");
}

function browserHost(host: string): string {
  return host === "0.0.0.0" ? "localhost" : host;
}

function mcpHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function openBrowser(host: string, port: number) {
  const url = `http://${browserHost(host)}:${port}`;
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

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function applyStartArgs(args: string[]) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--host") {
      process.env.HOST = readOptionValue(args, i, "--host");
      i += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      process.env.HOST = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      process.env.PORT = readOptionValue(args, i, "--port");
      i += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      process.env.PORT = arg.slice("--port=".length);
      continue;
    }

    throw new Error(`Unknown start option: ${arg}`);
  }
}

async function startServerMode(args: string[] = []) {
  applyStartArgs(args);
  ensureDirs();
  ensureEnv();

  const resourceDir = findResourceDir();
  const migrationsDir = join(resourceDir, "prisma", "migrations");

  process.env.CHRONA_WEB_DIST = join(resourceDir, "apps/web/dist");
  process.env.CHRONA_MIGRATIONS_DIR = migrationsDir;
  process.env.DATABASE_URL ??= `file:${join(getDataDir(), "chrona.db")}`;

  banner();

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  console.log(`  Data:  ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log("");

  console.log("🗄️  Preparing database...");
  ensureSqliteDatabase({
    databaseUrl: process.env.DATABASE_URL,
    migrationsDir,
    log: (message) => console.log(message),
  });
  console.log("✅ Database ready.");
  console.log("");

  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  const appUrl = `http://${browserHost(host)}:${port}`;
  const mcpUrl = `http://${mcpHost(host)}:${port}/api/mcp`;
  console.log(`🚀 Starting Chrona on ${appUrl}`);
  console.log(`🔌 Chrona MCP: ${mcpUrl}`);
  console.log("");

  setTimeout(() => {
    openBrowser(host, port);
  }, 1500);

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

  await startServerMode(args[0] === "start" ? args.slice(1) : []);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
