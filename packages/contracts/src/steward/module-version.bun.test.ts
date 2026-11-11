import { expect, test } from "bun:test";
import { expectedModuleTargetSchema, modulesToolInputSchemas, moduleInstallResultSchema, moduleUpstreamRequestSchema, moduleVersionHashSchema } from "./index";

test.each([40, 64])("module source versions accept %i hex characters throughout lifecycle inputs", length => {
  const hash = "a".repeat(length);
  expect(moduleVersionHashSchema.parse(hash)).toBe(hash);
  expect(modulesToolInputSchemas.rollback.parse({ moduleId: "example-id", hash, reason: "user selected version" })).toMatchObject({ hash });
  expect(moduleInstallResultSchema.parse({ package: "qq", requestKey: "install", status: "building", moduleId: "module", hash, approvalId: null, error: null }).hash).toBe(hash);
  expect(moduleUpstreamRequestSchema.parse({ action: "merge", moduleId: "module", commit: "b".repeat(40), baseHash: hash, requestKey: "merge" })).toMatchObject({ baseHash: hash });
});

test("Git source compatibility never widens contract digests or Git commit identity", () => {
  for (const hash of ["a".repeat(39), "a".repeat(41), "a".repeat(63), "A".repeat(40)]) expect(moduleVersionHashSchema.safeParse(hash).success).toBe(false);
  expect(expectedModuleTargetSchema.safeParse({ moduleId: "module", contractHash: "a".repeat(40) }).success).toBe(false);
  expect(expectedModuleTargetSchema.safeParse({ moduleId: "module", contractHash: "a".repeat(64) }).success).toBe(true);
  expect(moduleUpstreamRequestSchema.safeParse({ action: "status", moduleId: "module" }).success).toBe(true);
  expect(moduleUpstreamRequestSchema.safeParse({ action: "fetch", moduleId: "module", repository: "https://example.com" }).success).toBe(false);
});
