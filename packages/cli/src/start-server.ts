import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assertPrivateStorageSupported, ensurePrivateDirectory, secureGeneratedPrivateFile } from "@chrona/db/sqlite-url";


export type ChronaStartOptions = {
  host?: string;
  port?: string;
  open?: boolean;
};

export type BootChronaServer = () => Promise<void>;

const packageDir = process.env.CHRONA_PACKAGE_DIR
  ?? resolve(dirname(import.meta.dirname), "..");

function findResourceDir(): string {
  const binaryPath = Bun.argv[0] ?? process.execPath;
  const binaryDir = resolve(dirname(binaryPath));
  const executableDir = resolve(dirname(process.execPath));
  const candidates = [
    process.env.CHRONA_RESOURCE_DIR,
    join(binaryDir, "resources"),
    join(executableDir, "resources"),
    join(packageDir, "resources"),
    packageDir,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "prisma", "migrations"))) {
      return candidate;
    }
  }

  return candidates[0] ?? packageDir;
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

export function getChronaDataDir(): string {
  if (process.env.CHRONA_DATA_DIR) return process.env.CHRONA_DATA_DIR;
  const home = getHome();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "chrona");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrona");
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "chrona")
    : join(home, ".local", "share", "chrona");
}

export function getChronaConfigDir(): string {
  if (process.env.CHRONA_CONFIG_DIR) return process.env.CHRONA_CONFIG_DIR;
  const home = getHome();
  if (process.platform === "darwin") return join(home, "Library", "Preferences", "chrona");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrona");
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "chrona")
    : join(home, ".config", "chrona");
}

function ensureDirs() {
  assertPrivateStorageSupported();
  for (const path of [getChronaDataDir(), getChronaConfigDir()]) {
    // Existing selected paths are audited, never rewritten. Newly-created
    // Chrona roots receive private POSIX modes or a verified Windows ACL.
    ensurePrivateDirectory(path);
  }
}

function ensureEnv(resourceDir: string) {
  const envPath = join(getChronaConfigDir(), ".env");
  if (!existsSync(envPath)) {
    const examplePath = join(resourceDir, ".env.example");
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, envPath, 0);
      // Secure only the generated config file, never an existing user file.
      secureGeneratedPrivateFile(envPath);
    }
  }
}

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

function applyStartOptions(options: ChronaStartOptions) {
  if (options.host) process.env.HOST = options.host;
  if (options.port) process.env.PORT = options.port;
}

export async function startChronaServer(bootServer: BootChronaServer, options: ChronaStartOptions = {}) {
  applyStartOptions(options);
  ensureDirs();

  const resourceDir = findResourceDir();
  const migrationsDir = join(resourceDir, "prisma", "migrations");
  ensureEnv(resourceDir);

  process.env.CHRONA_WEB_DIST ??= join(resourceDir, "apps/web/dist");
  process.env.CHRONA_MIGRATIONS_DIR ??= migrationsDir;
  process.env.DATABASE_URL ??= `file:${join(getChronaDataDir(), "chrona.db")}`;

  banner();

  const dataDir = getChronaDataDir();
  const configDir = getChronaConfigDir();
  console.log(`  Data:  ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log("");

  // The server entrypoint owns the runtime lock and migration lifecycle. Keeping
  // this launcher side-effect free prevents a packaged start from acquiring twice.

  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  const appUrl = `http://${browserHost(host)}:${port}`;
  const mcpUrl = `http://${mcpHost(host)}:${port}/api/mcp`;
  console.log(`🚀 Starting Chrona on ${appUrl}`);
  console.log(`🔌 Chrona MCP: ${mcpUrl}`);
  console.log("");

  if (options.open !== false && process.env.CHRONA_NO_OPEN !== "1") {
    setTimeout(() => {
      openBrowser(host, port);
    }, 1500);
  }

  await bootServer();
}
