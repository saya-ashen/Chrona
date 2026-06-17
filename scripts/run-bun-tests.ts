export {};

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const include = new Bun.Glob("**/*.bun.test.ts");
const ignoredSegments = new Set(["node_modules", ".direnv", ".git", ".worktrees", "dist", "build", "coverage"]);
const rootDir = process.cwd();
const tempDir = resolve(rootDir, ".tmp");
const requestedFiles = process.argv.slice(2);

function shouldInclude(path: string) {
  return !path.split("/").some((segment) => ignoredSegments.has(segment));
}

function resolveRequestedFiles(paths: string[]) {
  const invalid = paths.filter((path) => !path.endsWith(".bun.test.ts") || !shouldInclude(path) || !existsSync(path));
  if (invalid.length > 0) {
    console.error(`Invalid Bun test file(s): ${invalid.join(", ")}`);
    process.exit(1);
  }
  return paths;
}

const files = requestedFiles.length > 0
  ? resolveRequestedFiles(requestedFiles)
  : (await Array.fromAsync(include.scan(".")))
    .filter(shouldInclude)
    .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  process.exit(0);
}

mkdirSync(tempDir, { recursive: true });

let exitCode = 0;
const failedFiles: Array<{ file: string; code: number }> = [];

console.log(`Running ${files.length} Bun test file${files.length === 1 ? "" : "s"} sequentially...`);

async function runWithFreshDatabase(file: string, fileDbPath: string): Promise<number> {
  if (existsSync(fileDbPath)) {
    rmSync(fileDbPath, { force: true });
  }
  const initProc = Bun.spawn([
    "bun",
    "run",
    "scripts/init-sqlite-db.ts",
    "--reset",
    fileDbPath,
  ], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const initCode = await initProc.exited;
  if (initCode !== 0) {
    return initCode;
  }
  const proc = Bun.spawn(["bun", "test", file], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: `file:${fileDbPath}`, NODE_ENV: "test" },
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

try {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileDbPath = resolve(tempDir, `bun-test-${index}.db`);
    const code = await runWithFreshDatabase(file, fileDbPath);
    if (code !== 0) {
      exitCode = code;
      failedFiles.push({ file, code });
    }
  }
} finally {
  for (let index = 0; index < files.length; index += 1) {
    const fileDbPath = resolve(tempDir, `bun-test-${index}.db`);
    if (existsSync(fileDbPath)) {
      rmSync(fileDbPath, { force: true });
    }
  }
}

if (failedFiles.length > 0) {
  console.error("\nFailed Bun test files:");
  for (const failure of failedFiles) {
    console.error(`  - ${failure.file} (exit ${failure.code})`);
  }
}

process.exit(exitCode);
