#!/usr/bin/env bun

import { $ } from "bun";
import { chmod, cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName, type ReleaseResource } from "../build/manifest";
import { normalizeElfInterpreterFile } from "../build/portable-elf";
import { buildExecutionContracts } from "../build/execution-contracts";
import { copyModuleGitRelease, stageModuleGitLicense } from "./module-git-release";

const ROOT = resolve(import.meta.dirname, "..");

function log(step: string, ...args: string[]) {
  console.log(`  [${step}]`, ...args);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyResource(resource: ReleaseResource, releaseDir: string) {
  const src = resolve(ROOT, resource.from);
  const dst = resolve(releaseDir, resource.to);
  if (!(await exists(src))) {
    if (resource.required) {
      throw new Error(`Release resource missing: ${resource.from}`);
    }
    log("skip", `${resource.from} not found`);
    return;
  }

  await mkdir(dirname(dst), { recursive: true });
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true, filter: path => !["resources/builtin", "resources/external"].includes(resource.to) || !path.slice(src.length).split(/[\\/]/).some(part => ["node_modules", ".git", ".venv", ".chrona"].includes(part)) });
  log("copy", `${resource.from} → ${resource.to}`);
}

async function createTarGz(sourceDir: string, outFile: string) {
  const parentDir = dirname(sourceDir).replace(/\\/g, "/");
  const dirName = sourceDir.replace(/\\/g, "/").split("/").pop()!;
  const normalizedOut = outFile.replace(/\\/g, "/");
  log("archive", `Creating ${normalizedOut.replace(ROOT.replace(/\\/g, "/") + "/", "")}`);
  await $`tar -czf ${normalizedOut} -C ${parentDir} ${dirName}`.cwd(ROOT);
}

export function compileArgs(target: BuildTargetName, binaryPath: string) {
  const manifestTarget = buildTargets[target];
  const args = [
    "build",
    resolve(ROOT, buildArtifacts.binaryEntry),
    "--compile",
    "--define=CHRONA_COMPILED=true",
    '--define=process.env.NODE_ENV="production"',
    '--define=process.env.BUN_ENV="production"',
    `--target=${manifestTarget.bunTarget}`,
    `--outfile=${binaryPath}`,
    "--tsconfig-override=tsconfig.json",
  ];
  if (process.env.CHRONA_MINIFY_BINARY === "1") {
    args.push("--minify", "--sourcemap");
  }
  return args;
}

/** Generated contract files belong to the exact module commit shipped in its bundle. */
export async function prepareReleaseModules(resourcesRoot: string) {
  await buildExecutionContracts(resolve(resourcesRoot, "external"));
  const seedDir = resolve(process.env.CHRONA_MODULE_GIT_SEEDS ?? resolve(ROOT, buildArtifacts.moduleGit.seedDir));
  await stageModuleGitLicense(resourcesRoot, resolve(ROOT, buildArtifacts.moduleGit.seedDir, "LICENSE"), resolve(ROOT, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"));
  await copyModuleGitRelease(seedDir, resourcesRoot);
}

export async function prepareReleaseResources(releaseDir: string) {
  for (const resource of buildArtifacts.resources) await copyResource(resource, releaseDir);
  await prepareReleaseModules(resolve(releaseDir, buildArtifacts.resourcesRoot));
}

export async function buildBinary(target: BuildTargetName) {
  const manifestTarget = buildTargets[target];
  const releaseDir = resolve(ROOT, "dist", "releases", manifestTarget.releaseName);
  const binaryPath = resolve(releaseDir, manifestTarget.binaryName);

  console.log("");
  console.log(`Building Chrona binary for ${target} (${manifestTarget.bunTarget})`);
  console.log(`  Release dir: ${releaseDir}`);
  console.log("");

  log("build", "Generating Prisma client...");
  await $`bun run db:generate`.cwd(ROOT);

  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  log("compile", "Compiling binary from TypeScript source...");
  await $`bun ${compileArgs(target, binaryPath)}`.cwd(ROOT);

  if ("linuxInterpreter" in manifestTarget) {
    const interpreter = await normalizeElfInterpreterFile(binaryPath, manifestTarget.linuxInterpreter);
    if (interpreter.changed) {
      log("portable", `Normalized ELF interpreter ${interpreter.previousInterpreter} → ${manifestTarget.linuxInterpreter}`);
    } else {
      log("portable", `ELF interpreter already portable: ${manifestTarget.linuxInterpreter}`);
    }
  }

  if (manifestTarget.executable) {
    await chmod(binaryPath, 0o755);
  }
  log("output", `Binary: ${binaryPath}`);

  log("copy", "Copying resources...");
  await prepareReleaseResources(releaseDir);

  console.log("");
  const tarPath = resolve(ROOT, "dist", "releases", `${manifestTarget.releaseName}.tar.gz`);
  await createTarGz(releaseDir, tarPath);
  log("archive", tarPath);

  console.log("");
  console.log(`✓ Built ${manifestTarget.releaseName}`);
  console.log(`  Binary:  ${binaryPath}`);
  console.log(`  Archive: ${tarPath}`);
  console.log("");
}

async function main() {
  if (process.argv[2] === "--resources-only") {
    if (!process.argv[3] || process.argv.length !== 4) throw new Error("Usage: bun scripts/build-binaries.ts --resources-only <release-directory>");
    await prepareReleaseResources(resolve(process.argv[3]));
    return;
  }
  await buildBinary(parseBuildTarget(process.argv.slice(2)));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Build failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
