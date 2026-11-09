import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildArtifacts } from "../build/manifest";
import { assertModuleTypecheck, releaseSmokeEnvironment } from "../build/release-smoke";

test("release smoke uses isolated credentials and disables real providers", () => {
  const env = releaseSmokeEnvironment("/tmp/smoke/data", "/tmp/smoke/config", {
    API_KEY: "inherited-test-key",
    CHRONA_STEWARD_AGENT: "pi",
    CHRONA_QQ_APP_ID: "inherited-app",
    CHRONA_QQ_SECRET_FILE: "/must-not-read",
    CHRONA_RESOURCE_DIR: "/must-not-use-source-resources",
    CHRONA_PACKAGE_DIR: "/must-not-use-source-package",
    CHRONA_MIGRATIONS_DIR: "/must-not-use-source-migrations",
    CHRONA_PROCESS_HELPER: "/must-not-use-source-guardian",
    CHRONA_SDK: "/must-not-use-source-sdk",
  });
  expect(env.API_KEY).toBeTruthy();
  expect(env.API_KEY).not.toBe("inherited-test-key");
  expect(env.CHRONA_STEWARD_AGENT).toBe("");
  expect(env.CHRONA_QQ_APP_ID).toBe("");
  expect(env.CHRONA_QQ_SECRET_FILE).toBe("");
  expect(env.DATABASE_URL).toBe("file:/tmp/smoke/data/chrona.db");
  for (const name of ["CHRONA_RESOURCE_DIR", "CHRONA_PACKAGE_DIR", "CHRONA_MIGRATIONS_DIR", "CHRONA_PROCESS_HELPER", "CHRONA_SDK"]) expect(env[name]).toBeUndefined();
});

test("packaged checker uses Web's actual contracts without changing the shipped SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-smoke-typecheck-")), repository = resolve(import.meta.dirname, "..");
  const resources = join(root, "resources"), sdk = join(resources, "module-sdk");
  try {
    for (const resource of buildArtifacts.resources.filter(resource => /^resources\/module-(sdk|typecheck)(\/|$)/.test(resource.to))) {
      const target = join(root, resource.to);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(repository, resource.from), target, { recursive: true });
    }
    await mkdir(join(resources, "external/web"), { recursive: true });
    await cp(join(repository, "packages/engine/src/modules/steward/external/web/module.json"), join(resources, "external/web/module.json"));
    await cp(join(repository, "packages/engine/src/modules/steward/external/files"), join(resources, "external/files"), { recursive: true });
    const original = await readFile(join(sdk, "calls.d.ts"), "utf8");
    await chmod(join(sdk, "calls.d.ts"), 0o444);
    await assertModuleTypecheck(resources);
    expect(await readFile(join(sdk, "calls.d.ts"), "utf8")).toBe(original);
    expect(await Bun.file(join(sdk, "calls.json")).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
