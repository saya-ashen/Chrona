#!/usr/bin/env bun

import { $ } from "bun";
import { chmod, cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildArtifacts, buildTargets, currentBuildTarget, omitPausedRuntimeModules, parseBuildTarget, type BuildTargetName, type ReleaseResource } from "../build/manifest";
import { normalizeElfInterpreterFile, removeElfLibraryPathsFile } from "../build/portable-elf";
import { assembleAgentDependencies } from "../build/agent-dependencies";
import { buildAgentApplication } from "../packages/engine/src/modules/steward/builtin/agent/build";
import { buildEntryConversations } from "../build/entry-conversations";
import { copyModuleGitRelease, stageModuleGitLicense } from "./module-git-release";
import { buildProcessHelper } from "../packages/process/scripts/build-helper";

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
  await buildEntryConversations(resourcesRoot);
  // Paused application sources are verified as retained materials, without regenerating their retired contracts.
  await buildAgentApplication(resolve(resourcesRoot, "builtin/agent"));
  await assembleAgentDependencies(resolve(resourcesRoot, "builtin/agent"));
  const seedDir = resolve(process.env.CHRONA_MODULE_GIT_SEEDS ?? resolve(ROOT, buildArtifacts.moduleGit.seedDir));
  await stageModuleGitLicense(resourcesRoot, resolve(ROOT, buildArtifacts.moduleGit.seedDir, "LICENSE"), resolve(ROOT, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"));
  await copyModuleGitRelease(seedDir, resourcesRoot);
  await omitPausedRuntimeModules(resourcesRoot);
}

/** Native helpers are built with their distribution, never by the runtime. */
export async function prepareReleaseProcessHelper(resourcesRoot: string): Promise<string> {
  const target = buildTargets[currentBuildTarget()];
  const extension = process.platform === "win32" ? ".exe" : "";
  const helper = buildProcessHelper(resolve(resourcesRoot, `process/${process.platform}-${process.arch}/chrona-process-guardian${extension}`));
  // MSVC leaves its intermediate beside the requested executable.
  await rm(`${helper}.obj`, { force: true });
  if ("linuxInterpreter" in target) {
    await normalizeElfInterpreterFile(helper, target.linuxInterpreter);
    // Pair the portable loader with its system libc, never the build host's RPATH/RUNPATH.
    await removeElfLibraryPathsFile(helper);
  }
  log("process", `Prepared ${helper}`);
  if (process.platform === "darwin") log("process", "macOS runtime supervision backend is unavailable; packaging does not establish native acceptance");
  if (process.platform === "win32") log("process", "Windows Job backend requires native acceptance; no platform result is implied by packaging");
  return helper;
}

export async function prepareReleaseResources(releaseDir: string) {
  for (const resource of buildArtifacts.resources) await copyResource(resource, releaseDir);
  const resourcesRoot = resolve(releaseDir, buildArtifacts.resourcesRoot);
  await prepareReleaseModules(resourcesRoot);
  await prepareReleaseProcessHelper(resourcesRoot);
}

export async function buildBinary(target: BuildTargetName) {
  const nativeTarget = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  if (target !== nativeTarget) throw new Error(`Native process supervision requires building ${target} on its matching runner; current runner is ${nativeTarget}`);
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
