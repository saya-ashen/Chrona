#!/usr/bin/env bun

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName } from "./manifest";
import { assertElfInterpreterFile } from "./portable-elf";

const ROOT = resolve(import.meta.dirname, "..");
// The built-in web installs its npm dependencies on first start.
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
  return {
    ...inheritedEnvironment,
    CHRONA_DATA_DIR: dataDir,
    CHRONA_CONFIG_DIR: configDir,
    DATABASE_URL: `file:${join(dataDir, "chrona.db")}`,
    CHRONA_NO_OPEN: "1",
    API_KEY: crypto.randomUUID(),
    CHRONA_STEWARD_AGENT: "",
    CHRONA_QQ_APP_ID: "",
    CHRONA_QQ_SECRET_FILE: "",
  };
}

async function waitForJson(url: string, label: string, apiKey?: string) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  let lastError = "not requested";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      if (response.ok) return await response.json();
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`${label} not ready: ${lastError}`);
}

async function waitForText(url: string, label: string) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  let lastError = "not requested";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok && text.includes("<html")) return text;
      lastError = `${response.status} ${text.slice(0, 120)}`;
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
  const proc = Bun.spawn([binaryPath, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForJson(`${baseUrl}/health`, "health endpoint");
    // The page comes from the built-in web module, which builds at first start.
    await waitForText(`${baseUrl}/`, "web index");
    // The page's data API (web module, routed calls): today's overview of the default workspace.
    await waitForJson(`${baseUrl}/api/web/today`, "web today endpoint", env.API_KEY);
    await assertExists(join(dataDir, "chrona.db"), "Runtime SQLite database");
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    throw new Error(
      `Runtime smoke failed: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`.replaceAll(env.API_KEY!, "[REDACTED]"),
      { cause: error },
    );
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export type SmokeReleaseOptions = {
  releaseRoot?: string;
  runtime?: boolean;
};

export async function smokeRelease(target: BuildTargetName, options: SmokeReleaseOptions = {}) {
  const { manifestTarget, releaseDir, binaryPath } = releasePaths(target, options.releaseRoot);

  await assertExists(binaryPath, "Binary");
  if (manifestTarget.executable) {
    await assertExecutable(binaryPath);
  }
  if ("linuxInterpreter" in manifestTarget) {
    await assertElfInterpreterFile(binaryPath, manifestTarget.linuxInterpreter);
  }

  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/schema.prisma"), "Prisma schema");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/migrations"), "Prisma migrations");

  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "external-plugins/pi-steward-agent"), "Pi steward extension");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "builtin"), "Built-in module resources");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/sdk.ts"), "Module SDK");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/package.json"), "Module SDK package");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "rescue.html"), "Immutable rescue console");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/testing.ts"), "Module test helper");
  await assertModuleTypecheck(resolve(releaseDir, buildArtifacts.resourcesRoot));

  if (options.runtime !== false) {
    await assertRuntimeStarts(binaryPath);
  }

  console.log(`✓ Release smoke passed for ${target}`);
}

/** v2-25: the shipped type check resolves TypeScript and Bun's types on its own and passes a built-in module. */
async function assertModuleTypecheck(resources: string) {
  const child = Bun.spawn(["bun", "--no-install", join(resources, "module-typecheck/check.ts"), join(resources, "external/remind"), join(resources, "module-sdk")], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Module type check failed (exit ${code}): ${stdout.slice(-500)} ${stderr.slice(-500)}`);
}

if (import.meta.main) {
  smokeRelease(parseBuildTarget(process.argv.slice(2))).catch((err) => {
    console.error("Release smoke failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
