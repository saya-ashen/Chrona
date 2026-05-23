export {};

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const include = new Bun.Glob("**/*.bun.test.ts");
const ignoredSegments = new Set(["node_modules", ".direnv", ".git", ".worktrees", "dist", "build", "coverage"]);
const rootDir = process.cwd();
const tempDbPath = resolve(rootDir, ".tmp", "bun-test.db");
const tempDatabaseUrl = `file:${tempDbPath}`;

function shouldInclude(path: string) {
  return !path.split("/").some((segment) => ignoredSegments.has(segment));
}

const files = (await Array.fromAsync(include.scan(".")))
  .filter(shouldInclude)
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  process.exit(0);
}

mkdirSync(dirname(tempDbPath), { recursive: true });
rmSync(tempDbPath, { force: true });

const initProc = Bun.spawn([
  "bun",
  "run",
  "scripts/init-sqlite-db.ts",
  "--reset",
  tempDbPath,
], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
});
const initCode = await initProc.exited;
if (initCode !== 0) {
  process.exit(initCode);
}

let exitCode = 0;

try {
  for (const file of files) {
    const proc = Bun.spawn(["bun", "test", file], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: tempDatabaseUrl, NODE_ENV: "test" },
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      exitCode = code;
    }
  }
} finally {
  if (existsSync(tempDbPath)) {
    rmSync(tempDbPath, { force: true });
  }
}

process.exit(exitCode);
