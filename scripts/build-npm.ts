#!/usr/bin/env bun

/**
 * Build script for the npm-published CLI bundle.
 * Uses esbuild with custom tsconfig path resolution to produce
 * a single Node.js-compatible ESM bundle.
 *
 * Strategy: bundle all monorepo source code, externalize all npm packages.
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
  // First check if the path already exists as-is
  try {
    if (statSync(filePath).isFile()) return filePath;
  } catch {
    // file doesn't exist — continue trying
  }

  // TypeScript convention: import "foo.js" resolves to "foo.ts"
  if (filePath.endsWith(".js")) {
    const tsPath = filePath.slice(0, -3) + ".ts";
    try { if (statSync(tsPath).isFile()) return tsPath; } catch { /* not found */ }
    const tsxPath = filePath.slice(0, -3) + ".tsx";
    try { if (statSync(tsxPath).isFile()) return tsxPath; } catch { /* not found */ }
  }
  if (filePath.endsWith(".mjs")) {
    const mtsPath = filePath.slice(0, -4) + ".mts";
    try { if (statSync(mtsPath).isFile()) return mtsPath; } catch { /* not found */ }
  }

  // Try appending common TypeScript/JavaScript extensions
  const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];
  for (const ext of extensions) {
    try {
      const candidate = filePath + ext;
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // extension doesn't match — try next
    }
  }

  // Try index files
  for (const indexFile of ["/index.ts", "/index.js"]) {
    try {
      const candidate = filePath + indexFile;
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // index file not found
    }
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

async function main() {
  const entryFile = resolve(ROOT, "packages/cli/src/npm-entry.ts");
  const outFile = resolve(ROOT, "dist/cli.js");

  const result = await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: { js: "#!/usr/bin/env node" },
    plugins: [
      {
        name: "chrona-resolver",
        setup(build) {
          // Resolve @chrona/* and @/ workspace path aliases → bundle
          build.onResolve({ filter: /^@(chrona\/|\/)/ }, (args) => {
            // @prisma/* should be external (npm package)
            if (args.path.startsWith("@prisma/")) {
              return { external: true, path: args.path };
            }
            const resolved = resolveTsconfigPath(args.path);
            if (resolved) return { path: resolved };
            return { external: true, path: args.path };
          });

          // For all file imports, decide: bundle workspace, externalize npm
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return undefined;
            if (args.namespace !== "file") return undefined;

            // Build the absolute path as esbuild would resolve it
            const abs = join(args.resolveDir, args.path);

            // Check if it actually resolves to an existing workspace file
            if (isWorkspaceFile(abs) && tryResolveFile(abs)) {
              return undefined; // bundle it
            }

            // Everything else → external
            return { external: true, path: args.path };
          });
        },
      },
    ],
  });

  if (result.errors.length > 0) {
    console.error("Build failed:", result.errors);
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn("Build warnings:", result.warnings);
  }

  const { chmodSync } = await import("node:fs");
  chmodSync(outFile, 0o755);

  console.log("✓ Built", outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
