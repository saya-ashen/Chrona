#!/usr/bin/env bun

/**
 * Build script for the npm-published CLI bundle.
 * Produces two outputs:
 *   1. dist/cli.js      — pure Node.js launcher (node:* imports only)
 *   2. dist/bun-entry.js — Bun runtime with bundled workspace source
 */

import * as esbuild from "esbuild";
import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TSCONFIG = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf-8"));

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
      build.onResolve({ filter: /.*/ }, (args) => {
        // Let esbuild handle entry points normally
        if (args.kind === "entry-point") return undefined;

        // Skip esbuild's internal namespace imports
        if (args.namespace !== "file") return undefined;

        // Keep node:* builtins external
        if (args.path.startsWith("node:")) {
          return { external: true, path: args.path };
        }
        // Keep bun:* builtins external (for Bun runtime entry)
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

        // For relative imports, resolve absolute path and check if workspace
        const abs = join(args.resolveDir, args.path);
        if (isWorkspaceFile(abs) && tryResolveFile(abs)) {
          return { path: tryResolveFile(abs) ?? abs };
        }

        // Everything else → external (npm packages, etc.)
        return { external: true, path: args.path };
      });
    },
  };
}

async function main() {
  const { chmodSync } = await import("node:fs");

  // ── Build 1: dist/cli.js (Node.js launcher) ──────────────────

  const launcherEntry = resolve(ROOT, "packages/cli/src/npm-launcher.ts");
  const launcherOut = resolve(ROOT, "dist/cli.js");

  const launcherResult = await esbuild.build({
    entryPoints: [launcherEntry],
    outfile: launcherOut,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: { js: "#!/usr/bin/env node" },
    plugins: [createResolverPlugin()],
    external: [], // launcher must not import any non-node:* deps
  });

  if (launcherResult.errors.length > 0) {
    console.error("Launcher build failed:", launcherResult.errors);
    process.exit(1);
  }
  if (launcherResult.warnings.length > 0) {
    console.warn("Launcher build warnings:", launcherResult.warnings);
  }
  chmodSync(launcherOut, 0o755);
  console.log("✓ Built", launcherOut);

  // ── Build 2: dist/bun-entry.js (Bun runtime) ─────────────────

  const bunEntry = resolve(ROOT, "packages/cli/src/bun-entry.ts");
  const bunOut = resolve(ROOT, "dist/bun-entry.js");

  const bunResult = await esbuild.build({
    entryPoints: [bunEntry],
    outfile: bunOut,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    plugins: [createResolverPlugin()],
  });

  if (bunResult.errors.length > 0) {
    console.error("Bun entry build failed:", bunResult.errors);
    process.exit(1);
  }
  if (bunResult.warnings.length > 0) {
    console.warn("Bun entry build warnings:", bunResult.warnings);
  }
  console.log("✓ Built", bunOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
