import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
let fixtureRoot = "";

async function writeFixture(path: string, source: string) {
  const target = join(fixtureRoot, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, source);
}

async function cruise(entry: string) {
  const process = Bun.spawn(
    [
      "bun",
      "x",
      "dependency-cruiser",
      "--config",
      join(root, ".dependency-cruiser.cjs"),
      "--output-type",
      "err",
      entry,
    ],
    { cwd: fixtureRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "chrona-boundaries-"));
  await writeFixture(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        baseUrl: root,
        module: "esnext",
        moduleResolution: "bundler",
      },
    }),
  );
  await writeFixture("features/task-workspace/index.ts", "export const taskWorkspaceContract = 'public';\n");
  await writeFixture("features/task-workspace/model/private.ts", "export const privateTaskWorkspaceState = 'private';\n");
  await writeFixture(
    "features/consumer/legal.ts",
    "import { taskWorkspaceContract } from '../task-workspace/index.ts';\nexport const legal = taskWorkspaceContract;\n",
  );
  await writeFixture(
    "features/consumer/illegal.ts",
    "import { privateTaskWorkspaceState } from '../task-workspace/model/private.ts';\nexport const illegal = privateTaskWorkspaceState;\n",
  );
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe("architecture boundary behavior", () => {
  test("allows sibling features to use the public index", async () => {
    const result = await cruise("features/consumer/legal.ts");
    expect(result.exitCode).toBe(0);
  });

  test("rejects sibling feature private imports", async () => {
    const result = await cruise("features/consumer/illegal.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("feature-task-workspace-internals-are-private");
  });
});
