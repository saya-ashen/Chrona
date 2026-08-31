#!/usr/bin/env bun

import { $ } from "bun";
import { chmod, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { buildArtifacts, buildTargets, parseBuildTarget, type BuildTargetName, type ReleaseResource } from "../build/manifest";
import { normalizeElfInterpreterFile } from "../build/portable-elf";

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
  await cp(src, dst, { recursive: true });
  log("copy", `${resource.from} → ${resource.to}`);
}

async function copyNativeAddons(target: BuildTargetName, releaseDir: string) {
  const nativePackage = buildTargets[target].nativePackage;
  const packageDir = resolve(ROOT, "node_modules", ...nativePackage.split("/"));
  if (!(await exists(packageDir))) {
    throw new Error(
      `Native release dependency missing for ${target}: ${nativePackage}. `
      + "Install dependencies on the target platform before building.",
    );
  }

  const addonNames = (await readdir(packageDir)).filter((name) => name.endsWith(".node"));
  if (addonNames.length === 0) {
    throw new Error(`Native release dependency has no .node addon: ${nativePackage}`);
  }

  for (const addonName of addonNames) {
    await cp(resolve(packageDir, addonName), resolve(releaseDir, basename(addonName)));
    log("copy", `${nativePackage}/${addonName} → ${addonName}`);
  }
}

async function createTarGz(sourceDir: string, outFile: string) {
  const parentDir = dirname(sourceDir).replace(/\\/g, "/");
  const dirName = sourceDir.replace(/\\/g, "/").split("/").pop()!;
  const normalizedOut = outFile.replace(/\\/g, "/");
  log("archive", `Creating ${normalizedOut.replace(ROOT.replace(/\\/g, "/") + "/", "")}`);
  await $`tar -czf ${normalizedOut} -C ${parentDir} ${dirName}`.cwd(ROOT);
}

function compileArgs(target: BuildTargetName, binaryPath: string) {
  const manifestTarget = buildTargets[target];
  const args = [
    "build",
    resolve(ROOT, buildArtifacts.binaryEntry),
    "--compile",
    `--target=${manifestTarget.bunTarget}`,
    `--outfile=${binaryPath}`,
    "--tsconfig-override=tsconfig.json",
  ];
  if (process.env.CHRONA_MINIFY_BINARY === "1") {
    args.push("--minify", "--sourcemap");
  }
  return args;
}

export async function buildBinary(target: BuildTargetName) {
  const manifestTarget = buildTargets[target];
  const releaseDir = resolve(ROOT, "dist", "releases", manifestTarget.releaseName);
  const binaryPath = resolve(releaseDir, manifestTarget.binaryName);

  console.log("");
  console.log(`Building Chrona binary for ${target} (${manifestTarget.bunTarget})`);
  console.log(`  Release dir: ${releaseDir}`);
  console.log("");

  log("build", "Building Web UI...");
  await $`bun run build`.cwd(resolve(ROOT, "apps/web"));

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
  for (const resource of buildArtifacts.resources) {
    await copyResource(resource, releaseDir);
  }

  log("copy", "Copying target native addons...");
  await copyNativeAddons(target, releaseDir);

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
  await buildBinary(parseBuildTarget(process.argv.slice(2)));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Build failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
