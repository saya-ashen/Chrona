import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  await writeFixture("features/task-workspace/ui.ts", "export const taskWorkspaceUi = 'public-ui';\n");
  await writeFixture("features/task-workspace/server.ts", "export const taskWorkspaceServer = 'public-server';\n");
  await writeFixture("features/task-workspace/test.ts", "export const taskWorkspaceTestSupport = 'test-only';\n");
  await writeFixture("features/task-workspace/model/private.ts", "export const privateTaskWorkspaceState = 'private';\n");
  await writeFixture("packages/engine/src/index.ts", "export const engine = 'server-only';\n");
  await writeFixture(
    "features/consumer/legal.ts",
    "import { taskWorkspaceContract } from '../task-workspace/index.ts';\nexport const legal = taskWorkspaceContract;\n",
  );
  await writeFixture(
    "features/consumer/illegal.ts",
    "import { privateTaskWorkspaceState } from '../task-workspace/model/private.ts';\nexport const illegal = privateTaskWorkspaceState;\n",
  );
  await writeFixture(
    "apps/web/src/legal.ts",
    "import { taskWorkspaceUi } from '../../../features/task-workspace/ui.ts';\nexport const legal = taskWorkspaceUi;\n",
  );
  await writeFixture(
    "apps/web/src/illegal-feature-entry.ts",
    "import { taskWorkspaceServer } from '../../../features/task-workspace/server.ts';\nexport const illegal = taskWorkspaceServer;\n",
  );
  await writeFixture(
    "apps/web/src/illegal-engine.ts",
    "import { engine } from '../../../packages/engine/src/index.ts';\nexport const illegal = engine;\n",
  );
  await writeFixture(
    "packages/consumer/src/illegal-feature.ts",
    "import { taskWorkspaceContract } from '../../../features/task-workspace/index.ts';\nexport const illegal = taskWorkspaceContract;\n",
  );
  await writeFixture(
    "packages/consumer/src/legal-feature.bun.test.ts",
    "import { taskWorkspaceTestSupport } from '../../../features/task-workspace/test.ts';\nexport const legal = taskWorkspaceTestSupport;\n",
  );
  await writeFixture(
    "apps/web/src/illegal-test-entry.ts",
    "import { taskWorkspaceTestSupport } from '../../../features/task-workspace/test.ts';\nexport const illegal = taskWorkspaceTestSupport;\n",
  );
  await writeFixture(
    "packages/consumer/src/illegal-feature.bun.test.ts",
    "import { taskWorkspaceServer } from '../../../features/task-workspace/server.ts';\nexport const illegal = taskWorkspaceServer;\n",
  );
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

  test("allows the web app to use a feature UI entrypoint", async () => {
    const result = await cruise("apps/web/src/legal.ts");
    expect(result.exitCode).toBe(0);
  });

  test("rejects server feature entrypoints in the web app", async () => {
    const result = await cruise("apps/web/src/illegal-feature-entry.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("web-uses-browser-safe-feature-entrypoints");
  });

  test("rejects server dependencies in browser paths", async () => {
    const result = await cruise("apps/web/src/illegal-engine.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("browser-paths-stay-server-free");
  });

  test("rejects test support entrypoints from browser production code", async () => {
    const result = await cruise("apps/web/src/illegal-test-entry.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("feature-test-entrypoints-are-test-only");
  });
  test("rejects feature dependencies from package production code", async () => {
    const result = await cruise("packages/consumer/src/illegal-feature.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("packages-production-never-import-root-features");
  });

  test("allows package tests to use a feature test entrypoint", async () => {
    const result = await cruise("packages/consumer/src/legal-feature.bun.test.ts");
    expect(result.exitCode).toBe(0);
  });

  test("rejects package tests that bypass a feature test entrypoint", async () => {
    const result = await cruise("packages/consumer/src/illegal-feature.bun.test.ts");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("package-tests-use-feature-test-entrypoint-only");
  });
});
