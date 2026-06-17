/**
 * Sequential API test runner.
 *
 * Bun's test runner interleaves parallel file execution, which causes
 * `resetTestDb()` in beforeEach hooks to delete data that other
 * concurrently running test files depend on.
 *
 * Running each file one at a time via a separate Bun process avoids
 * this shared-DB contention.
 */

export {};

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const glob = new Bun.Glob("*.bun.test.ts");
const rootDir = process.cwd();
const tempDbPath = resolve(rootDir, ".tmp", "api-test.db");
const tempDatabaseUrl = `file:${tempDbPath}`;

const dirs = [
  "apps/server/src/__tests__/api",
  "apps/server/src/routes/__tests__",
];

let exitCode = 0;
const failedFiles: Array<{ file: string; code: number }> = [];


mkdirSync(dirname(tempDbPath), { recursive: true });
rmSync(tempDbPath, { force: true });

const initProc = Bun.spawn(["bun", "run", "scripts/init-sqlite-db.ts", "--reset", tempDbPath], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
});
const initCode = await initProc.exited;
if (initCode !== 0) {
  process.exit(initCode);
}

try {
  for (const dir of dirs) {
    const files = (await Array.fromAsync(glob.scan(dir))).sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const path = `${dir}/${file}`;
      const proc = Bun.spawn(["bun", "test", path], {
        cwd: rootDir,
        env: { ...process.env, DATABASE_URL: tempDatabaseUrl, NODE_ENV: "test" },
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        exitCode = code;
        failedFiles.push({ file: path, code });
      }
    }
  }
} finally {
  if (existsSync(tempDbPath)) {
    rmSync(tempDbPath, { force: true });
  }
}

if (failedFiles.length > 0) {
  console.error("\nFailed API test files:");
  for (const failure of failedFiles) {
    console.error(`  - ${failure.file} (exit ${failure.code})`);
  }
}

process.exit(exitCode);
