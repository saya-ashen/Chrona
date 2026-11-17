import { copyFileSync, existsSync } from "node:fs";
import { chronaDataDir } from "@chrona/runtime-config";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ensurePrivateDirectory, secureGeneratedPrivateFile } from "@chrona/db/sqlite-url";


export type ChronaStartOptions = {
  host?: string;
  port?: string;
  open?: boolean;
};

export type BootChronaServer = () => Promise<void>;

const packageDir = process.env.CHRONA_PACKAGE_DIR
  ?? resolve(import.meta.dirname, "../../..");

type ResourceDirectoryInput = {
  cwd: string;
  argv0: string;
  executable: string;
  resourceDir?: string;
  packageDir?: string;
};

export function findResourceDir(input: ResourceDirectoryInput = {
  cwd: process.cwd(), argv0: Bun.argv[0] ?? process.execPath, executable: process.execPath,
  resourceDir: process.env.CHRONA_RESOURCE_DIR, packageDir,
}): string {
  const binaryDir = resolve(input.cwd, dirname(input.argv0));
  const executableDir = resolve(input.cwd, dirname(input.executable));
  const candidates = [
    input.resourceDir,
    join(binaryDir, "resources"),
    join(executableDir, "resources"),
    ...(input.packageDir !== undefined ? [join(input.packageDir, "resources"), input.packageDir] : []),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(resolveMigrationsDir(resolve(input.cwd, candidate)))) return candidate;
  }

  if (input.packageDir === undefined) throw new Error("Cannot determine resource root: no observed resource directory contains prisma/migrations and the process package path is unavailable");
  return candidates[0]!;
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

export function resolveMigrationsDir(resourceDir: string): string {
  const packaged = join(resourceDir, "prisma", "migrations");
  if (existsSync(packaged)) return packaged;
  return join(resourceDir, "packages", "db", "prisma", "migrations");
}

export function getChronaDataDir(): string { return chronaDataDir(); }

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
  console.log("⚡ Chrona — personal steward");
  console.log("");
}

function browserHost(host: string): string {
  return host === "0.0.0.0" ? "localhost" : host;
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
  const migrationsDir = resolveMigrationsDir(resourceDir);
  ensureEnv(resourceDir);

  process.env.CHRONA_MIGRATIONS_DIR ??= migrationsDir;
  process.env.DATABASE_URL ??= `file:${join(getChronaDataDir(), "chrona.db")}`;

  banner();

  const dataDir = getChronaDataDir();
  const configDir = getChronaConfigDir();
  console.log(`  Data:  ${dataDir}`);
  console.log(`  Config: ${configDir}`);
  console.log("");

  // CLI runtime assembly owns the sole storage lock and migration lifecycle.

  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  const appUrl = `http://${browserHost(host)}:${port}`;
  console.log(`🚀 Starting Chrona on ${appUrl}`);
  console.log("");

  if (options.open !== false && process.env.CHRONA_NO_OPEN !== "1") {
    setTimeout(() => {
      openBrowser(host, port);
    }, 1500);
  }

  await bootServer();
}
