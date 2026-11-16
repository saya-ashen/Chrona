import { expect, test } from "bun:test";
import * as contracts from "./index";

test("shared modules inputs expose only schemas used by the public router", () => {
  expect(Object.keys(contracts.modulesToolInputSchemas)).toEqual(["describe", "rollback"]);
  expect(contracts.modulesToolInputSchemas.describe.parse({})).toEqual({ limit: 50, audience: "caller" });
  expect(contracts.modulesToolInputSchemas.describe.parse({ target: { moduleId: "author-id", tool: "submit" } })).toEqual({ target: { moduleId: "author-id", tool: "submit" }, limit: 50, audience: "caller" });
  expect(contracts.modulesToolInputSchemas.describe.safeParse({ target: { moduleId: "author-id", tool: "submit" }, dir: "checkout" }).success).toBe(false);
  expect(contracts.modulesToolInputSchemas.rollback.safeParse({ module: "example" }).success).toBe(false);
  expect(contracts.modulesToolInputSchemas.rollback.safeParse({ module: "example", hash: "a".repeat(64), dir: "checkout" }).success).toBe(false);
});

test("public kernel namespace vocabulary matches the seven registered services", () => {
  const expected: Array<(typeof contracts.KERNEL_MODULE_NAMES)[number]> = ["activity", "agent", "approvals", "modules", "secrets", "settings", "timers"];
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
