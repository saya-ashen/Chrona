#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const pluginDir = resolve(repoRoot, "packages/openclaw-plugin-structured-result");
const builtDir = resolve(pluginDir, "dist");
const builtEntry = resolve(builtDir, "index.js");
const builtManifest = resolve(builtDir, "openclaw.plugin.json");

async function run(command: string[], cwd = repoRoot) {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function logSection(title: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  console.log(`\n[${title}]\n${trimmed}`);
}

async function main() {
  console.log("==> Building Chrona OpenClaw structured-result plugin");
  const build = await run(["bun", "run", "build"], pluginDir);
  logSection("build:stdout", build.stdout);
  logSection("build:stderr", build.stderr);
  if (build.exitCode !== 0) {
    throw new Error(`Plugin build failed with exit code ${build.exitCode}`);
  }

  if (!existsSync(builtEntry) || !existsSync(builtManifest)) {
    throw new Error(`Expected built plugin bundle and manifest under ${builtDir}`);
  }

  console.log("==> Installing plugin into OpenClaw");
  const install = await run([
    "openclaw",
    "plugins",
    "install",
    "--force",
    pluginDir,
  ]);
  logSection("install:stdout", install.stdout);
  logSection("install:stderr", install.stderr);
  if (install.exitCode !== 0) {
    throw new Error(`Plugin install failed with exit code ${install.exitCode}`);
  }

  console.log("==> Enabling plugin");
  const enable = await run(["openclaw", "plugins", "enable", "chrona-structured-result"]);
  logSection("enable:stdout", enable.stdout);
  logSection("enable:stderr", enable.stderr);
  if (enable.exitCode !== 0) {
    throw new Error(`Plugin enable failed with exit code ${enable.exitCode}`);
  }

  console.log("==> Restarting OpenClaw gateway service if installed");
  const restart = await run(["openclaw", "gateway", "restart", "--json"]);
  logSection("gateway-restart:stdout", restart.stdout);
  logSection("gateway-restart:stderr", restart.stderr);
  if (restart.exitCode !== 0) {
    console.warn("Gateway restart was not completed successfully. If you run the bridge/gateway manually, restart that process yourself.");
  }

  console.log("\nDone. Installed plugin: chrona-structured-result");
  console.log(`Plugin source dir: ${pluginDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
