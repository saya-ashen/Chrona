import { expect, test } from "bun:test";
import { expectedModuleTargetSchema, modulesToolInputSchemas, moduleInstallResultSchema, moduleVersionHashSchema } from "./index";

test.each([64])("module source versions accept %i hex characters throughout lifecycle inputs", length => {
  const hash = "a".repeat(length);
  expect(moduleVersionHashSchema.parse(hash)).toBe(hash);
  expect(modulesToolInputSchemas.rollback.parse({ moduleId: "example-id", hash, reason: "user selected version" })).toMatchObject({ hash });
  expect(moduleInstallResultSchema.parse({ package: "qq", requestKey: "install", status: "building", moduleId: "module", hash, approvalId: null, error: null }).hash).toBe(hash);
});

test("material versions preserve module identity and reject retired Git hashes", () => {
  for (const hash of ["a".repeat(40), "a".repeat(39), "a".repeat(41), "a".repeat(63), "A".repeat(40)]) expect(moduleVersionHashSchema.safeParse(hash).success).toBe(false);
  expect(expectedModuleTargetSchema.parse({ moduleId: "module" })).toEqual({ moduleId: "module" });
  expect(expectedModuleTargetSchema.safeParse({ moduleId: "module", extra: "obsolete" }).success).toBe(false);
});
