#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName } from "./manifest";
import { assertElfInterpreterFile } from "./portable-elf";
import { verifyReleaseIdentity } from "./release-identity";

const ROOT = resolve(import.meta.dirname, "../..");
const RUNTIME_TIMEOUT_MS = 60_000;

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertExists(path: string, label: string) {
  if (!(await pathExists(path))) {
    throw new Error(`${label} missing: ${path}`);
  }
}

async function assertExecutable(path: string) {
  const mode = (await stat(path)).mode;
  if ((mode & 0o111) === 0) {
    throw new Error(`Binary not executable: ${path}`);
  }
}

function releasePaths(target: BuildTargetName, releaseRoot = resolve(ROOT, "dist", "releases")) {
  const manifestTarget = buildTargets[target];
  const releaseDir = resolve(releaseRoot, manifestTarget.releaseName);
  return {
    manifestTarget,
    releaseDir,
    binaryPath: resolve(releaseDir, manifestTarget.binaryName),
  };
}

async function freePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  server.stop(true);
  return port;
}

export function releaseSmokeEnvironment(
  dataDir: string,
  configDir: string,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TMP", "TEMP", "TMPDIR"]
      .map(name => [name, inheritedEnvironment[name]]),
  );
  return {
    ...env,
    HOME: configDir,
    USERPROFILE: configDir,
    CHRONA_DATA_DIR: dataDir,
    CHRONA_CONFIG_DIR: configDir,
    CHRONA_CONFIG_FILE: join(configDir, "config.json"),
    DATABASE_URL: `file:${join(dataDir, "chrona.db")}`,
    CHRONA_NO_OPEN: "1",
    NODE_ENV: "production",
    API_KEY: crypto.randomUUID(),
  };
}

async function waitForJson(url: string, label: string) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  let lastError = "not requested";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`${label} not ready: ${lastError}`);
}

async function assertRuntimeStarts(binaryPath: string) {
  const port = await freePort();
  const tempRoot = await mkdtemp(join(tmpdir(), "chrona-release-smoke-"));
  const dataDir = join(tempRoot, "data");
  const configDir = join(tempRoot, "config");

  const env = releaseSmokeEnvironment(dataDir, configDir);
  env.CHRONA_RESOURCE_DIR = join(dirname(binaryPath), buildArtifacts.resourcesRoot);
  const proc = Bun.spawn([binaryPath, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: tempRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  try {
    await waitForJson(`http://127.0.0.1:${port}/health`, "kernel health endpoint");
    const databasePath = join(dataDir, "chrona.db");
    await assertExists(databasePath, "Runtime SQLite database");
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.query("SELECT COUNT(*) AS count FROM Module").get() as { count: number };
      if (row.count !== 0) throw new Error("Fresh kernel installed applications");
      if (!database.query("SELECT checksum FROM _chrona_migrations").get()) throw new Error("Runtime did not apply database migrations");
    } finally { database.close(); }
  } catch (error) {
    proc.kill();
    await proc.exited;
    const [stdout, stderr] = await output;
    throw new Error(
      `Runtime smoke failed: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`.replaceAll(env.API_KEY!, "[REDACTED]"),
      { cause: error },
    );
  } finally {
    proc.kill();
    await proc.exited;
    await output;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

/** Help must work before server configuration or database initialization. */
export async function assertReleaseCli(binaryPath: string) {
  const root = await mkdtemp(join(tmpdir(), "chrona-release-cli-"));
  const data = join(root, "data"), config = join(root, "config");
  const env = { ...process.env, CHRONA_DATA_DIR: data, CHRONA_CONFIG_DIR: config, DATABASE_URL: "invalid:release-cli-must-not-load" };
  try {
    const help = spawnSync(binaryPath, ["--help"], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    if (help.error || help.status !== 0 || !help.stdout.includes("start") || !help.stdout.includes("admin") || /executor|owner.?key|device/i.test(help.stdout)) {
      throw new Error("Packaged CLI help failed or advertises obsolete device administration");
    }
    for (const command of ["executor", "__executor-process"]) {
      const result = spawnSync(binaryPath, [command], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
      if (result.error || result.status === 0 || !result.stderr.includes("unknown command")) throw new Error(`Packaged CLI still accepts ${command}`);
    }
    if (await pathExists(data) || await pathExists(config)) throw new Error("CLI help or an obsolete command initialized private server state");
  } finally { await rm(root, { recursive: true, force: true }); }
}

export type SmokeReleaseOptions = {
  releaseRoot?: string;
  runtime?: boolean;
};

export async function smokeRelease(target: BuildTargetName, options: SmokeReleaseOptions = {}) {
  const { manifestTarget, releaseDir, binaryPath } = releasePaths(target, options.releaseRoot);

  await verifyReleaseIdentity(releaseDir);
  await assertExists(binaryPath, "Binary");
  if (manifestTarget.executable) {
    await assertExecutable(binaryPath);
  }
  if ("linuxInterpreter" in manifestTarget) {
    await assertElfInterpreterFile(binaryPath, manifestTarget.linuxInterpreter);
  }

  await assertReleaseCli(binaryPath);

  const helperPlatform = target.startsWith("windows-") ? "win32" : target.split("-")[0];
  const helperArch = target.split("-")[1];
  const helperPath = resolve(releaseDir, buildArtifacts.resourcesRoot, `process/${helperPlatform}-${helperArch}/chrona-process-guardian${helperPlatform === "win32" ? ".exe" : ""}`);
  await assertExists(helperPath, "Native process guardian");
  if (manifestTarget.executable) await assertExecutable(helperPath);
  if ("linuxInterpreter" in manifestTarget) await assertElfInterpreterFile(helperPath, manifestTarget.linuxInterpreter);

  for (const resource of buildArtifacts.resources) {
    if (resource.required) await assertExists(resolve(releaseDir, resource.to), resource.to);
  }

  if (options.runtime !== false) {
    await assertRuntimeStarts(binaryPath);
  }

  console.log(`✓ Release smoke passed for ${target}`);
}

if (import.meta.main) {
  smokeRelease(parseBuildTarget(process.argv.slice(2))).catch((err) => {
    console.error("Release smoke failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
