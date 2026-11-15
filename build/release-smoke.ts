#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName } from "./manifest";
import { assertElfInterpreterFile } from "./portable-elf";

const ROOT = resolve(import.meta.dirname, "..");
// Ordinary preinstalled modules run installation checks on first start.
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
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnvironment,
    CHRONA_DATA_DIR: dataDir,
    CHRONA_CONFIG_DIR: configDir,
    CHRONA_CONFIG_FILE: join(configDir, "config.json"),
    DATABASE_URL: `file:${join(dataDir, "chrona.db")}`,
    CHRONA_NO_OPEN: "1",
    API_KEY: crypto.randomUUID(),
    CHRONA_STEWARD_AGENT: "",
    CHRONA_QQ_APP_ID: "",
    CHRONA_QQ_SECRET_FILE: "",
  };
  for (const name of ["CHRONA_RESOURCE_DIR", "CHRONA_PACKAGE_DIR", "CHRONA_MIGRATIONS_DIR", "CHRONA_PROCESS_HELPER", "CHRONA_SDK"]) delete env[name];
  return env;
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

export async function approveSmokeWeb(baseUrl: string, key: string) {
  return approveSmokeModule(baseUrl, key, "web");
}
async function approveSmokeModule(baseUrl: string, key: string, name: "web" | "pi") {
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const modules = await waitForJson(`${baseUrl}/api/modules`, "rescue modules", key) as { items: { id: string; name: string; status: string; activeHash: string | null }[] };
    const web = modules.items.find(module => module.name === name);
    if (web?.status === "active" && web.activeHash) return;
    const approvals = await waitForJson(`${baseUrl}/api/approvals`, "rescue approvals", key) as { items: { id: string; moduleId: string | null; action: string }[] };
    const candidates = approvals.items.filter(approval => approval.moduleId === web?.id && approval.action === "activate_module");
    if (candidates.length > 1) throw new Error(`Ambiguous ${name} activation approvals`);
    if (candidates[0]) {
      const response = await fetch(`${baseUrl}/api/approvals/${candidates[0].id}/resolve`, { method: "POST", headers, body: JSON.stringify({ decision: "approve", scope: "once" }) });
      if (!response.ok) throw new Error(`${name} activation approval failed: ${response.status}`);
      const approval = await response.json() as { status: string };
      if (approval.status !== "approved") throw new Error(`${name} activation approval unresolved: ${approval.status}`);
    }
    await Bun.sleep(250);
  }
  throw new Error(`${name} activation approval was not ready`);
}

async function assertRuntimeStarts(binaryPath: string) {
  const port = await freePort(), rescuePort = await freePort();
  const tempRoot = await mkdtemp(join(tmpdir(), "chrona-release-smoke-"));
  const dataDir = join(tempRoot, "data");
  const configDir = join(tempRoot, "config");

  const env = releaseSmokeEnvironment(dataDir, configDir);
  env.CHRONA_RESOURCE_DIR = join(dirname(binaryPath), buildArtifacts.resourcesRoot);
  env.CHRONA_RESCUE_HOST = "127.0.0.1";
  env.CHRONA_RESCUE_PORT = String(rescuePort);
  env.RESCUE_KEY = env.API_KEY;
  const proc = Bun.spawn([binaryPath, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: tempRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForJson(`${baseUrl}/health`, "health endpoint");
    // Web is an ordinary owner application; approve its exact first activation through rescue.
    await approveSmokeWeb(`http://127.0.0.1:${rescuePort}`, env.API_KEY!);
    // Exercise the shipped Provider's real dependency installation and immutable material checks.
    await approveSmokeModule(`http://127.0.0.1:${rescuePort}`, env.API_KEY!, "pi");
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

  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/schema.prisma"), "Prisma schema");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/migrations"), "Prisma migrations");

  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "pi/chrona-tools.ts"), "Pi steward extension");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "pi/browser-tools.ts"), "Pi browser extension");
  await assertPiReleaseResources(resolve(releaseDir, buildArtifacts.resourcesRoot));
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/sdk.ts"), "Module SDK");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/package.json"), "Module SDK package");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "rescue.html"), "Immutable rescue console");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/testing.ts"), "Module test helper");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/transport.ts"), "Module SDK transport");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/process.ts"), "Module SDK process supervision");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/windows-transport.ts"), "Module SDK Windows transport");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/chrona-sdk-loader.ts"), "Module SDK static loader");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-typecheck/chrona-sdk-loader.ts"), "Module type check static loader");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/build-contract.md"), "Module build contract");
  await assertExists(resolve(releaseDir, buildArtifacts.resourcesRoot, "module-sdk/group-build-contract.md"), "Module group-build contract");
  await assertModuleTypecheck(resolve(releaseDir, buildArtifacts.resourcesRoot));

  if (options.runtime !== false) {
    await assertRuntimeStarts(binaryPath);
  }

  console.log(`✓ Release smoke passed for ${target}`);
}

/** The default Provider ships as an ordinary external application with a pinned source bundle. */
export async function assertPiReleaseResources(resourcesRoot: string) {
  const moduleDir = join(resourcesRoot, "external/pi");
  for (const file of ["module.json", "package.json", "bun.lock", "runtime.js", "test.js", "vendor"]) {
    await assertExists(join(moduleDir, file), "Pi external module resource");
  }
  const manifest = JSON.parse(await readFile(join(moduleDir, "module.json"), "utf8"));
  if (manifest.name !== "pi") throw new Error("Pi external module manifest mismatch");
  await assertExists(join(resourcesRoot, "module-git/pi.bundle"), "Pi module Git bundle");
}

/** Check Notify against packaged Web contracts in a writable SDK, as ordinary builds do. */
export async function assertModuleTypecheck(resources: string) {
  const temporary = await mkdtemp(join(tmpdir(), "chrona-release-typecheck-")), sdk = join(temporary, "sdk");
  try {
    await cp(join(resources, "module-sdk"), sdk, { recursive: true });
    await chmod(join(sdk, "calls.d.ts"), 0o644);
    const web = moduleManifestSchema.parse(JSON.parse(await readFile(join(resources, "external/web/module.json"), "utf8")));
    const contracts = Object.fromEntries(web.tools.filter(tool => tool.visibility.some(who => who === "modules" || who === "owner"))
      .map(tool => [`web.${tool.name}`, { input: tool.parameters, output: tool.output ?? null }]));
    await writeFile(join(sdk, "calls.json"), JSON.stringify(contracts));
    const child = Bun.spawn(["bun", "--no-install", join(resources, "module-typecheck/check.ts"), join(resources, "external/notify"), sdk], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Module type check failed (exit ${code}): ${stdout.slice(-500)} ${stderr.slice(-500)}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  smokeRelease(parseBuildTarget(process.argv.slice(2))).catch((err) => {
    console.error("Release smoke failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
