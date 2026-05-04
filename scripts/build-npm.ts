#!/usr/bin/env bun

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const bundles = [
  {
    entry: resolve(ROOT, "packages/cli/src/npm-launcher.ts"),
    outfile: resolve(ROOT, "dist/cli.js"),
  },
  {
    entry: resolve(ROOT, "packages/cli/src/bun-entry.ts"),
    outfile: resolve(ROOT, "dist/bun-entry.js"),
  },
] as const;

function buildBundle(entry: string, outfile: string): void {
  mkdirSync(dirname(outfile), { recursive: true });
  rmSync(outfile, { force: true });

  const result = Bun.spawnSync([
    "bun",
    "build",
    entry,
    `--outfile=${outfile}`,
    "--target=bun",
    "--tsconfig-override=tsconfig.json",
  ], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to build ${outfile}`);
  }
}

for (const bundle of bundles) {
  console.log(`Building ${bundle.outfile.replace(`${ROOT}/`, "")}`);
  buildBundle(bundle.entry, bundle.outfile);
}
