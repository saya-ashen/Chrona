#!/usr/bin/env bun

/**
 * Build Chrona portable binaries via Bun compile.
 *
 * Two-step process:
 *   1. esbuild bundle (resolves tsconfig path aliases, bundles workspace source)
 *   2. bun build --compile (embeds the bundle + Bun runtime into a self-contained binary)
 *
 * Usage:
 *   bun run scripts/build-binaries.ts --target linux-x64
 *   bun run scripts/build-binaries.ts --target darwin-arm64
 *   bun run scripts/build-binaries.ts --target windows-x64
 *
 * Supports targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64
 */

import * as esbuild from "esbuild";
import { existsSync, mkdirSync, cpSync, chmodSync, rmSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

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

// ────── esbuild resolver (reuses build-npm.ts logic) ────────────

const TSCONFIG = JSON.parse(await Bun.file(resolve(ROOT, "tsconfig.json")).text());
const paths: Record<string, string[]> = TSCONFIG.compilerOptions?.paths ?? {};
const baseUrl = resolve(ROOT, TSCONFIG.compilerOptions?.baseUrl ?? ".");

interface PathRule {
  regex: RegExp;
  targets: string[];
}

const pathRules: PathRule[] = Object.entries(paths).map(([pattern, targets]) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)");
  return { regex: new RegExp("^" + escaped + "$"), targets };
});

function tryResolveFile(filePath: string): string | null {
  try {
    if (statSync(filePath).isFile()) return filePath;
  } catch { /* not found */ }

  if (filePath.endsWith(".js")) {
    const tsPath = filePath.slice(0, -3) + ".ts";
    try { if (statSync(tsPath).isFile()) return tsPath; } catch { /* */ }
    const tsxPath = filePath.slice(0, -3) + ".tsx";
    try { if (statSync(tsxPath).isFile()) return tsxPath; } catch { /* */ }
  }
  if (filePath.endsWith(".mjs")) {
    const mtsPath = filePath.slice(0, -4) + ".mts";
    try { if (statSync(mtsPath).isFile()) return mtsPath; } catch { /* */ }
  }

  const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];
  for (const ext of extensions) {
    try {
      const candidate = filePath + ext;
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* */ }
  }

  for (const indexFile of ["/index.ts", "/index.js"]) {
    try {
      const candidate = filePath + indexFile;
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* */ }
  }

  return null;
}

function resolveTsconfigPath(importPath: string): string | null {
  for (const { regex, targets } of pathRules) {
    const match = importPath.match(regex);
    if (!match) continue;
    const suffix = match[1] ?? "";
    for (const target of targets) {
      const resolved = join(baseUrl, target.replace(/\*/g, suffix));
      const file = tryResolveFile(resolved);
      if (file) return file;
    }
  }
  return null;
}

function isWorkspaceFile(absPath: string): boolean {
  return absPath.startsWith(ROOT + "/packages") || absPath.startsWith(ROOT + "/apps");
}

function createResolverPlugin() {
  return {
    name: "chrona-resolver",
    setup(build: esbuild.PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: esbuild.OnResolveArgs) => {
        if (args.kind === "entry-point") return undefined;
        if (args.namespace !== "file") return undefined;

        // Keep node:* builtins external
      // Keep bun:* builtins external (Bun runtime provides them)
        if (args.path.startsWith("bun:")) {
          return { external: true, path: args.path };
        }
        // Keep @prisma/* external (npm package)
        if (args.path.startsWith("@prisma/")) {
          return { external: true, path: args.path };
        }

        // Try tsconfig path alias resolution first
        const aliased = resolveTsconfigPath(args.path);
        if (aliased) return { path: aliased };

        // For relative imports, resolve absolute path
        const abs = join(args.resolveDir, args.path);
        if (isWorkspaceFile(abs) && tryResolveFile(abs)) {
          return { path: tryResolveFile(abs) ?? abs };
        }

        // Everything else → external (npm packages)
        return { external: true, path: args.path };
      });
    },
  };
}

// ────── esbuild bundling step ───────────────────────────────────

async function bundleWithEsbuild(target: string): Promise<string> {
  const entryFile = resolve(ROOT, "packages/cli/src/binary-entry.ts");
  const bundleDir = resolve(ROOT, "dist", "binary-bundle");
  const bundleOut = resolve(bundleDir, `binary-entry-${target}.js`);

  mkdirSync(bundleDir, { recursive: true });
  log("esbuild", `Bundling ${entryFile} → ${bundleOut}`);

  const result = await esbuild.build({
    entryPoints: [entryFile],
    outfile: bundleOut,
    bundle: true,
    platform: "node",
    target: "esnext",
    format: "esm",
    plugins: [createResolverPlugin()],
  });

  if (result.errors.length > 0) {
    console.error("esbuild bundle errors:", result.errors);
    throw new Error("esbuild bundling failed");
  }
  if (result.warnings.length > 0) {
    console.warn("esbuild warnings:", result.warnings);
  }

  return bundleOut;
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

  // Step 3: esbuild bundle (resolve tsconfig paths)
  const bundlePath = await bundleWithEsbuild(target);

  // Step 4: Clean and create release directory
  if (existsSync(releaseDir)) {
    rmSync(releaseDir, { recursive: true });
  }
  mkdirSync(releaseDir, { recursive: true });

  // Step 5: Bun compile the bundled output
  log("compile", "Compiling binary...");
  Bun.spawnSync([
    "bun",
    "build",
    bundlePath,
    "--compile",
    `--target=${bunTarget}`,
    `--outfile=${binaryPath}`,
  ], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });

  // Set executable permission for linux/mac
  if (!isWindows) {
    chmodSync(binaryPath, 0o755);
  }

  log("output", `Binary: ${binaryPath}`);

  // Step 6: Copy resources
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

  // Step 7: Generate archive
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
