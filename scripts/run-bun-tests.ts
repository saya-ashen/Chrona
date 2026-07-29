import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const include = new Bun.Glob("**/*.bun.test.ts");
const ignoredSegments = new Set(["node_modules", ".direnv", ".git", ".worktrees", "dist", "build", "coverage"]);
const rootDir = process.cwd();
const requestedFiles = process.argv.slice(2);
const concurrency = Math.max(1, Number(process.env.CHRONA_TEST_CONCURRENCY ?? "4"));

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

export interface TestFileEnvironment {
  file: string;
  fileDbPath: string;
  dataDir: string;
  env: Record<string, string | undefined>;
}

export interface TestRunWorkspace {
  root: string;
  files: TestFileEnvironment[];
}

export function createTestRunWorkspace(rootDir: string, files: string[]): TestRunWorkspace {
  const tempDir = resolve(rootDir, ".tmp");
  mkdirSync(tempDir, { recursive: true });

  const root = mkdtempSync(join(tempDir, "bun-test-"));
  return {
    root,
    files: files.map((file, index) => {
      const fileRoot = join(root, `${index}`);
      const fileDbPath = join(fileRoot, "test.db");
      const dataDir = join(fileRoot, "data");
      const env = {
        ...process.env,
        DATABASE_URL: `file:${fileDbPath}`,
        CHRONA_DATA_DIR: dataDir,
        NODE_ENV: "test",
      };

      mkdirSync(fileRoot, { recursive: true });
      return { file, fileDbPath, dataDir, env };
    }),
  };
}

export function cleanupTestRunWorkspace(workspace: TestRunWorkspace) {
  rmSync(workspace.root, { recursive: true, force: true });
}

async function runWithFreshDatabase(item: TestFileEnvironment): Promise<number> {
  const { file, fileDbPath, env } = item;
  const initProc = Bun.spawn([
    "bun",
    "run",
    "scripts/init-sqlite-db.ts",
    "--reset",
    fileDbPath,
  ], {
    cwd: rootDir,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const initCode = await initProc.exited;
  if (initCode !== 0) {
    return initCode;
  }

  const proc = Bun.spawn(["bun", "test", file], {
    cwd: rootDir,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<number> {
  const files = requestedFiles.length > 0
    ? resolveRequestedFiles(requestedFiles)
    : (await Array.fromAsync(include.scan(".")))
      .filter(shouldInclude)
      .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return 0;
  }

  let exitCode = 0;
  const failedFiles: Array<{ file: string; code: number }> = [];
  const workspace = createTestRunWorkspace(rootDir, files);
  const pending = workspace.files;

  console.log(`Running ${files.length} Bun test file${files.length === 1 ? "" : "s"} with concurrency ${concurrency}...`);

  try {
    const active = new Set<Promise<void>>();
    const launch = (item: TestFileEnvironment) => {
      const job = (async () => {
        const code = await runWithFreshDatabase(item);
        if (code !== 0) {
          exitCode = code;
          failedFiles.push({ file: item.file, code });
        }
      })();
      active.add(job);
      job.finally(() => active.delete(job));
    };

    for (const item of pending) {
      while (active.size >= concurrency) {
        await Promise.race(active);
      }
      launch(item);
    }

    await Promise.all(active);
  } finally {
    cleanupTestRunWorkspace(workspace);
  }

  if (failedFiles.length > 0) {
    console.error("\nFailed Bun test files:");
    for (const failure of failedFiles) {
      console.error(`  - ${failure.file} (exit ${failure.code})`);
    }
  }

  return exitCode;
}

if (import.meta.main) {
  process.exit(await main());
}
