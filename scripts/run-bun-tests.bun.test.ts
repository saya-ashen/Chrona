import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

async function fixture(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "chrona-test-runner-"));
  try {
    for (const dir of ["scripts/build", "packages/process/scripts", "packages/logging/src", "apps/server/src/__tests__/api", "apps/server/src/config", "apps/server/src/middleware"]) {
      await mkdir(join(root, dir), { recursive: true });
    }
    for (const file of ["run-bun-tests.ts", "run-api-tests.ts"]) {
      await cp(join(import.meta.dir, file), join(root, "scripts", file));
    }
    await cp(join(import.meta.dir, "../packages/logging/src/redaction-text.ts"), join(root, "packages/logging/src/redaction-text.ts"));
    await writeFile(join(root, "packages/process/scripts/build-helper.ts"), `
      import { writeFileSync } from "node:fs";
      export function buildProcessHelper(output: string) { writeFileSync("helper-built", output); }
    `);
    await writeFile(join(root, "scripts/init-sqlite-db.ts"), `
      import { writeFileSync } from "node:fs";
      if (process.env.DATABASE_URL !== "file:" + process.argv[2] || process.env.NODE_ENV !== "test") process.exit(9);
      writeFileSync(process.argv[2], "isolated test fixture");
    `);
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function run(root: string, suite: string, args: string[]) {
  const child = Bun.spawn([process.execPath, `scripts/run-${suite}-tests.ts`, ...args], {
    cwd: root,
    env: { ...process.env, CHRONA_TEST_CONCURRENCY: "2", CHRONA_TEST_RETRY_FLAKY: "0" },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, code };
}

test("both --list commands preserve discovery without helper builds or database initialization", async () => {
  await fixture(async root => {
    const bunFile = "scripts/build/probe.bun.test.ts";
    const apiFile = "apps/server/src/__tests__/api/probe.bun.test.ts";
    for (const file of [bunFile, apiFile, "apps/server/src/config/probe.bun.test.ts", "scripts/build/ignored.test.ts"]) {
      await writeFile(join(root, file), 'throw new Error("list must not evaluate tests");');
    }
    const bun = await run(root, "bun", ["--list"]);
    const api = await run(root, "api", ["--list"]);
    expect(bun.code, bun.stderr).toBe(0);
    expect(api.code, api.stderr).toBe(0);
    expect(JSON.parse(bun.stdout)).toEqual([bunFile]);
    expect(JSON.parse(api.stdout)).toEqual([apiFile, "apps/server/src/config/probe.bun.test.ts"]);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
    expect(existsSync(join(root, "helper-built"))).toBe(false);
  });
});

for (const suite of ["bun", "api"]) {
  test(`${suite} execution keeps per-file environments, reports failure and cleans up after both children finish`, async () => {
    await fixture(async root => {
      const prefix = suite === "bun" ? "scripts" : "apps/server/src";
      const files = [`${prefix}/first.bun.test.ts`, `${prefix}/second.bun.test.ts`];
      for (const [index, file] of files.entries()) {
        await writeFile(join(root, file), `
          import { expect, test } from "bun:test";
          import { existsSync, writeFileSync } from "node:fs";
          test("isolated environment", async () => {
            await Bun.sleep(${index * 100});
            const db = process.env.DATABASE_URL!.slice(5);
            expect(existsSync(db)).toBe(true);
            expect(process.env.NODE_ENV).toBe("test");
            expect(process.env.CHRONA_PROCESS_HELPER).toContain("chrona-process-guardian");
            writeFileSync("result-${index}.json", JSON.stringify({ db, data: process.env.CHRONA_DATA_DIR }));
            expect(${index}).toBe(1);
          });
        `);
      }
      const result = await run(root, suite, files);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(files[0]);
      const entries = await Promise.all([0, 1].map(async index => JSON.parse(await readFile(join(root, `result-${index}.json`), "utf8")) as { db: string; data: string }));
      expect(entries[0]!.db).not.toBe(entries[1]!.db);
      expect(entries[0]!.data).not.toBe(entries[1]!.data);
      for (const entry of entries) {
        expect(dirname(entry.db)).toBe(dirname(entry.data));
        expect(existsSync(dirname(entry.db))).toBe(false);
      }
      expect(await readdir(join(root, ".tmp"))).toEqual([]);
    });
  });
}
