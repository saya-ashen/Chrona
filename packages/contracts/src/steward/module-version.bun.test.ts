import { expect, test } from "bun:test";
import { expectedModuleTargetSchema, modulesToolInputSchemas, moduleInstallResultSchema, modulePackageCatalogSchema, moduleUpstreamRequestSchema, moduleVersionHashSchema } from "./index";

test.each([40, 64])("module source versions accept %i hex characters throughout lifecycle inputs", length => {
  const hash = "a".repeat(length);
  expect(moduleVersionHashSchema.parse(hash)).toBe(hash);
  for (const operation of ["check", "rollback"] as const) expect(modulesToolInputSchemas[operation].parse({ module: "example", hash })).toMatchObject({ hash });
  expect(modulesToolInputSchemas.checkout.parse({ module: "example", hash, dir: "candidate" })).toMatchObject({ hash });
  expect(modulesToolInputSchemas["request-group"].parse({ versions: [{ module: "first", hash }, { module: "second", hash }] })).toMatchObject({ versions: [{ hash }, { hash }] });
  expect(moduleInstallResultSchema.parse({ package: "qq", requestKey: "install", status: "building", moduleId: "module", hash, approvalId: null, error: null }).hash).toBe(hash);
  expect(moduleUpstreamRequestSchema.parse({ action: "merge", moduleId: "module", commit: "b".repeat(40), baseHash: hash, requestKey: "merge" })).toMatchObject({ baseHash: hash });
});

test("Git source compatibility never widens contract digests or Git commit identity", () => {
  for (const hash of ["a".repeat(39), "a".repeat(41), "a".repeat(63), "A".repeat(40)]) expect(moduleVersionHashSchema.safeParse(hash).success).toBe(false);
  expect(expectedModuleTargetSchema.safeParse({ moduleId: "module", contractHash: "a".repeat(40) }).success).toBe(false);
  expect(expectedModuleTargetSchema.safeParse({ moduleId: "module", contractHash: "a".repeat(64) }).success).toBe(true);
  expect(modulesToolInputSchemas.upstream.safeParse({ action: "status", moduleId: "module" }).success).toBe(true);
  expect(moduleUpstreamRequestSchema.safeParse({ action: "fetch", moduleId: "module", repository: "https://example.com" }).success).toBe(false);
  const item = { name: "qq", description: null, available: true, releaseHash: "a".repeat(40), moduleId: null, installation: null, error: null };
  expect(modulePackageCatalogSchema.parse([item])[0]!.git).toBeNull();
  expect(modulePackageCatalogSchema.safeParse([{ ...item, git: { repository: null, branch: "main", commit: "a".repeat(64) } }]).success).toBe(false);
});
