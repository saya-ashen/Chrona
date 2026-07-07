#!/usr/bin/env bun

import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName } from "./manifest";

const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_TIMEOUT_MS = 20_000;

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

function releasePaths(target: BuildTargetName) {
  const manifestTarget = buildTargets[target];
  const releaseDir = resolve(ROOT, "dist", "releases", manifestTarget.releaseName);
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
  await mkdir(dataDir, { recursive: true });
  await mkdir(configDir, { recursive: true });

  const proc = Bun.spawn([binaryPath, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHRONA_DATA_DIR: dataDir,
      CHRONA_CONFIG_DIR: configDir,
      CHRONA_NO_OPEN: "1",
      CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForJson(`${baseUrl}/health`, "health endpoint");
    await waitForJson(`${baseUrl}/api/health`, "api health endpoint");
    await waitForText(`${baseUrl}/`, "web index");
    const workspace = await waitForJson(`${baseUrl}/api/workspaces/default`, "default workspace endpoint") as { id?: string };
    if (typeof workspace.id !== "string" || workspace.id.length === 0) {
      throw new Error("Default workspace response missing id");
    }
    await waitForJson(`${baseUrl}/api/dashboard?workspaceId=${encodeURIComponent(workspace.id)}`, "dashboard endpoint");
    await assertExists(join(dataDir, "chrona.db"), "Runtime SQLite database");
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    throw new Error(`Runtime smoke failed: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export type SmokeReleaseOptions = {
  pluginSource?: string;
  runtime?: boolean;
};

export async function smokeRelease(target: BuildTargetName, options: SmokeReleaseOptions = {}) {
  const { manifestTarget, releaseDir, binaryPath } = releasePaths(target);

  await assertExists(binaryPath, "Binary");
  if (manifestTarget.executable) {
    await assertExecutable(binaryPath);
  }

  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist, "index.html"), "Web index");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/schema.prisma"), "Prisma schema");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/migrations"), "Prisma migrations");

  const pluginSource = resolve(ROOT, options.pluginSource ?? "external-plugins/hermes");
  const pluginRelease = resolve(releaseDir, buildArtifacts.resourcesRoot, "external-plugins/hermes");
  if (await pathExists(pluginSource)) {
    await assertExists(pluginRelease, "Hermes plugin");
  } else if (await pathExists(pluginRelease)) {
    throw new Error(`Hermes plugin bundled without source path: ${pluginRelease}`);
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
