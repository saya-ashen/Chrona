import { expect, test } from "bun:test";
import * as contracts from "./index";

test("shared modules inputs expose only schemas used by the public router", () => {
  expect(Object.keys(contracts.modulesToolInputSchemas)).toEqual(["reference", "rollback"]);
  expect(contracts.modulesToolInputSchemas.reference.parse({})).toEqual({});
  expect(contracts.modulesToolInputSchemas.reference.parse({ target: "author.submit" })).toEqual({ target: "author.submit" });
  expect(contracts.modulesToolInputSchemas.reference.safeParse({ target: "author.submit", dir: "checkout" }).success).toBe(false);
  expect(contracts.modulesToolInputSchemas.rollback.safeParse({ module: "example" }).success).toBe(false);
  expect(contracts.modulesToolInputSchemas.rollback.safeParse({ module: "example", hash: "a".repeat(64), dir: "checkout" }).success).toBe(false);
});

test("public kernel namespace vocabulary matches the five registered services", () => {
  const expected: Array<(typeof contracts.KERNEL_MODULE_NAMES)[number]> = ["activity", "approvals", "modules", "secrets", "settings"];
  expect([...contracts.KERNEL_MODULE_NAMES].sort()).toEqual(expected);
  expect([...contracts.SYSTEM_MODULES].sort()).toEqual(expected);
});

test("retired request contracts are absent from the package exports", () => {
  for (const name of [
    "createScheduleSchema", "moduleScheduleSchema", "updateScheduleSchema",
    "chatReplySchema", "newSessionSchema", "updateSessionSchema",
    "memorySettingsSchema", "sessionSettingsSchema", "DEFAULT_SESSION_SETTINGS",
    "todayViewSchema", "modelTierTargetSchema", "tierTarget",
    "notificationSchema", "notificationChannelSchema", "notificationSettingsSchema",
    "DEFAULT_NOTIFICATION_SETTINGS", "NOTIFY_LEVELS", "NOTIFICATION_STATUSES", "buildGovernanceSchema",
    "modulePackageCatalogSchema", "buildRequestSchema", "buildIntentSchema", "reviseBuildSchema",
  ]) expect(Object.hasOwn(contracts, name)).toBe(false);
  expect(contracts.candidateAdmissionInputSchema).toBeDefined();
  expect(contracts.candidateSourceInputSchema).toBeDefined();
  expect(contracts.candidateSubmitInputSchema).toBeDefined();
  expect(contracts.candidateCheckInputSchema).toBeDefined();
});

test("retained private schedule records still parse without publishing timer CRUD", () => {
  expect(contracts.scheduleRuleSchema.parse({ kind: "every", minutes: 5 })).toEqual({ kind: "every", minutes: 5 });
  expect(contracts.scheduleRuleSchema.safeParse({ kind: "every", minutes: 1 }).success).toBe(false);
  for (const mode of ["module", "wake"] as const) expect(contracts.scheduleSchema.parse({
    id: "stored-schedule", mode, rule: { kind: "daily", time: "08:00" }, text: "Stored instruction",
    originSessionId: null, moduleId: null, until: null, status: "paused", nextAt: null,
    lastAt: null, lastResult: null, label: "Stored schedule", createdBy: "chrona", createdAt: "2026-10-20T00:00:00Z",
  }).mode).toBe(mode);
});
