#!/usr/bin/env bun

import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName } from "./manifest";

const ROOT = resolve(import.meta.dirname, "..");

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

export type SmokeReleaseOptions = {
  pluginSource?: string;
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

  console.log(`✓ Release smoke passed for ${target}`);
}

if (import.meta.main) {
  smokeRelease(parseBuildTarget(process.argv.slice(2))).catch((err) => {
    console.error("Release smoke failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
