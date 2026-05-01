#!/usr/bin/env bun

/**
 * Build Chrona portable binaries via Bun compile.
 *
 * Uses Bun's native bundler and resolver to directly compile from TypeScript source.
 * No esbuild pre-bundling — Bun handles tsconfig paths, TypeScript, and node_modules resolution.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts --target linux-x64
 *   bun run scripts/build-binaries.ts --target darwin-arm64
 *   bun run scripts/build-binaries.ts --target windows-x64
 *
 * Supports targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64
 */

import { existsSync, mkdirSync, cpSync, chmodSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ────── Target mapping ─────────────────────────────────────────

const TARGET_MAP: Record<string, string> = {
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64",
};

const RELEASE_MAP: Record<string, string> = {
  "linux-x64": "chrona-linux-x64",
  "linux-arm64": "chrona-linux-arm64",
  "darwin-x64": "chrona-darwin-x64",
  "darwin-arm64": "chrona-darwin-arm64",
  "windows-x64": "chrona-windows-x64",
};

// ────── Logging helpers ────────────────────────────────────────

function log(step: string, ...args: string[]) {
  console.log(`  [${step}]`, ...args);
}

function bunRun(script: string) {
  log("bun", `run ${script}`);
  Bun.spawnSync(["bun", "run", script], { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] });
}

// ────── Archive helpers ─────────────────────────────────────────

async function createTarGz(sourceDir: string, outFile: string) {
  // Normalize paths for cross-platform tar (MSYS tar on Windows needs forward slashes)
  const parentDir = dirname(sourceDir).replace(/\\/g, "/");
  const dirName = sourceDir.replace(/\\/g, "/").split("/").pop()!;
  const normalizedOut = outFile.replace(/\\/g, "/");
  log("archive", `Creating ${normalizedOut.replace(ROOT.replace(/\\/g, "/") + "/", "")}`);
  Bun.spawnSync(["tar", "-czf", normalizedOut, "-C", parentDir, dirName], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
}

// ────── Main build function ─────────────────────────────────────

async function buildBinary(target: string) {
  const bunTarget = TARGET_MAP[target];
  const releaseName = RELEASE_MAP[target];
  if (!bunTarget || !releaseName) {
    throw new Error(`Unknown target: ${target}. Supported: ${Object.keys(TARGET_MAP).join(", ")}`);
  }

  const isWindows = target.startsWith("windows");
  const binaryName = isWindows ? "Chrona.exe" : "chrona";
  const releaseDir = resolve(ROOT, "dist", "releases", releaseName);
  const binaryPath = resolve(releaseDir, binaryName);
  const resourcesDir = resolve(releaseDir, "resources");
  const entryFile = resolve(ROOT, "packages/cli/src/binary-entry.ts");

  console.log("");
  console.log(`Building Chrona binary for ${target} (${bunTarget})`);
  console.log(`  Release dir: ${releaseDir}`);
  console.log("");

  // Step 1: Ensure Web UI is built
  log("build", "Building Web UI...");
  bunRun("build");

  // Step 2: Ensure Prisma client is generated
  log("build", "Generating Prisma client...");
  bunRun("db:generate");

  // Step 3: Clean and create release directory
  if (existsSync(releaseDir)) {
    rmSync(releaseDir, { recursive: true });
  }
  mkdirSync(releaseDir, { recursive: true });

  // Step 4: Bun compile directly from TypeScript source
  // Bun natively handles tsconfig paths, TypeScript, and node_modules resolution.
  log("compile", "Compiling binary from TypeScript source...");
  const compileResult = Bun.spawnSync([
    "bun",
    "build",
    entryFile,
    "--compile",
    `--target=${bunTarget}`,
    `--outfile=${binaryPath}`,
    "--tsconfig-override=tsconfig.json",
  ], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (compileResult.exitCode !== 0) {
    throw new Error(`bun build --compile failed with exit code ${compileResult.exitCode}`);
  }

  // Set executable permission for linux/mac
  if (!isWindows) {
    chmodSync(binaryPath, 0o755);
  }

  log("output", `Binary: ${binaryPath}`);

  // Step 5: Copy resources
  log("copy", "Copying resources...");
  mkdirSync(resourcesDir, { recursive: true });

  // apps/web/dist
  const webDistSrc = resolve(ROOT, "apps/web/dist");
  const webDistDst = resolve(resourcesDir, "apps/web/dist");
  if (existsSync(webDistSrc)) {
    cpSync(webDistSrc, webDistDst, { recursive: true });
    log("copy", "  apps/web/dist → resources/apps/web/dist");
  } else {
    throw new Error("Web UI build not found at apps/web/dist. Run 'bun run build' first.");
  }

  // prisma/schema.prisma
  const schemaSrc = resolve(ROOT, "prisma/schema.prisma");
  const schemaDst = resolve(resourcesDir, "prisma/schema.prisma");
  mkdirSync(dirname(schemaDst), { recursive: true });
  cpSync(schemaSrc, schemaDst);
  log("copy", "  prisma/schema.prisma → resources/prisma/schema.prisma");

  // prisma/migrations
  const migrationsSrc = resolve(ROOT, "prisma/migrations");
  const migrationsDst = resolve(resourcesDir, "prisma/migrations");
  if (existsSync(migrationsSrc)) {
    cpSync(migrationsSrc, migrationsDst, { recursive: true });
    log("copy", "  prisma/migrations → resources/prisma/migrations");
  }

  // .env.example
  const envSrc = resolve(ROOT, ".env.example");
  const envDst = resolve(resourcesDir, ".env.example");
  if (existsSync(envSrc)) {
    cpSync(envSrc, envDst);
    log("copy", "  .env.example → resources/.env.example");
  }

  // Step 6: Generate archive
  console.log("");
  const tarPath = resolve(ROOT, "dist", "releases", `${releaseName}.tar.gz`);
  await createTarGz(releaseDir, tarPath);
  log("archive", tarPath);

  console.log("");
  console.log(`✓ Built ${releaseName}`);
  console.log(`  Binary:  ${binaryPath}`);
  console.log(`  Archive: ${tarPath}`);
  console.log("");
}

// ────── Argument parsing ────────────────────────────────────────

function parseTarget(): string {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  if (targetIdx !== -1 && targetIdx + 1 < args.length) {
    return args[targetIdx + 1];
  }
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "linux" && arch === "x64") return "linux-x64";
  if (plat === "linux" && arch === "arm64") return "linux-arm64";
  if (plat === "darwin" && arch === "x64") return "darwin-x64";
  if (plat === "darwin" && arch === "arm64") return "darwin-arm64";
  if (plat === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`Cannot auto-detect target for ${plat}-${arch}. Pass --target <target>`);
}

async function main() {
  const target = parseTarget();
  await buildBinary(target);
}

main().catch((err) => {
  console.error("Build failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
