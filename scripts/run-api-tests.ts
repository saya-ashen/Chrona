/**
 * Concurrent API test runner.
 *
 * Files that share cross-file DB state stay serial; isolated files run with
 * bounded concurrency, each against its own temp database.
 */

export {};

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const glob = new Bun.Glob("*.bun.test.ts");
const rootDir = process.cwd();
const tempDir = resolve(rootDir, ".tmp", "api-tests");
const concurrency = Math.max(1, Number(process.env.CHRONA_TEST_CONCURRENCY ?? "4"));
const dirs = [
  "apps/server/src/__tests__/api",
  "apps/server/src/routes/__tests__",
];
const serialFiles = new Set([
  "apps/server/src/routes/__tests__/mcp-routes.bun.test.ts",
  "apps/server/src/__tests__/api/ai-client-crud.bun.test.ts",
  "apps/server/src/__tests__/api/decide-schedule-proposal.bun.test.ts",
  "apps/server/src/__tests__/api/schedule-proposal-workflow.bun.test.ts",
  "apps/server/src/__tests__/api/task-workflow.bun.test.ts",
]);

let exitCode = 0;
const failedFiles: Array<{ file: string; code: number }> = [];

mkdirSync(tempDir, { recursive: true });

async function runFile(path: string, dbPath: string, dataDir: string): Promise<number> {
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }

  const initProc = Bun.spawn(["bun", "run", "scripts/init-sqlite-db.ts", "--reset", dbPath], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const initCode = await initProc.exited;
  if (initCode !== 0) {
    return initCode;
  }

  const proc = Bun.spawn(["bun", "test", path], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}`, CHRONA_DATA_DIR: dataDir, NODE_ENV: "test" },
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

const files: Array<{ file: string; dbPath: string; dataDir: string }> = [];
for (const dir of dirs) {
  const entries = (await Array.fromAsync(glob.scan(dir))).sort((a, b) => a.localeCompare(b));
  for (const file of entries) {
    const fullPath = `${dir}/${file}`;
    files.push({
      file: fullPath,
      dbPath: resolve(tempDir, `${dir.replaceAll("/", "-")}-${file}.db`),
      dataDir: resolve(tempDir, `${dir.replaceAll("/", "-")}-${file}-data`),
    });
  }
}

const serial = files.filter(({ file }) => serialFiles.has(file));
const parallel = files.filter(({ file }) => !serialFiles.has(file));
console.log(
  `Running ${serial.length} serial API test file${serial.length === 1 ? "" : "s"} and ${parallel.length} parallel API test file${parallel.length === 1 ? "" : "s"} with concurrency ${concurrency}...`,
);


try {
  for (const { file, dbPath, dataDir } of serial) {
    const code = await runFile(file, dbPath, dataDir);
    if (code !== 0) {
      exitCode = code;
      failedFiles.push({ file, code });
    }
  }

  const active = new Set<Promise<void>>();
  const launch = (file: string, dbPath: string, dataDir: string) => {
    const job = (async () => {
      const code = await runFile(file, dbPath, dataDir);
      if (code !== 0) {
        exitCode = code;
        failedFiles.push({ file, code });
      }
    })();
    active.add(job);
    job.finally(() => active.delete(job));
  };

  for (const { file, dbPath, dataDir } of parallel) {
    while (active.size >= concurrency) {
      await Promise.race(active);
    }
    launch(file, dbPath, dataDir);
  }

  await Promise.all(active);
} finally {
  for (const { dbPath } of files) {
    if (existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
    }
  }
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failedFiles.length > 0) {
  console.error("\nFailed API test files:");
  for (const failure of failedFiles) {
    console.error(`  - ${failure.file} (exit ${failure.code})`);
  }
}

process.exit(exitCode);
