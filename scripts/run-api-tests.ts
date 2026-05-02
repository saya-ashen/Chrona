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
const glob = new Bun.Glob("*.bun.test.ts");

const dirs = [
  "apps/server/src/__tests__/api",
  "apps/server/src/routes/__tests__",
];

let exitCode = 0;

for (const dir of dirs) {
  const files = (await Array.fromAsync(glob.scan(dir))).sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const path = `${dir}/${file}`;
    const proc = Bun.spawn(["bun", "test", path], {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      exitCode = code;
    }
  }
}

process.exit(exitCode);
