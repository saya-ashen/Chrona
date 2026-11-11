import { afterEach, expect, test } from "bun:test";
import { budgetTimezone, createSettings, kernelModuleModelSettingsSchema, kernelSettingsSchema, moduleModelSettings } from "./settings";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const limits = { maxCallsPerEvent: 2, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 };
async function fixture(settings = {}) {
  const db = testDb({ injectedAgent: false });
  cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "settings", settings } });
  return { db, workspace, service: createSettings({ db, workspaceId: workspace.id, now: () => new Date("2026-10-21T04:00:00Z") }) };
}

test("kernel settings default to disabled; owner can configure, preserve, and disable budgets", async () => {
  const f = await fixture();
  expect(await f.service.get()).toEqual({ wake: { minIntervalMs: 60_000, dailyLimit: 1000, moduleDailyLimit: 100 }, timezone: "Asia/Shanghai", runTimeoutMinutes: null, moduleModel: null });
  expect((await f.service.update({ moduleModel: limits })).moduleModel).toEqual(limits);
  expect((await f.service.update({ timezone: "UTC" })).moduleModel).toEqual(limits);
  expect((await f.service.update({ moduleModel: null })).moduleModel).toBeNull();
  expect(kernelSettingsSchema.safeParse(await f.service.get()).success).toBe(true);
});

test("settings writes preserve unrelated application data", async () => {
  const f = await fixture({ applicationData: { private: "keep" } });
  await f.service.update({ timezone: "UTC", moduleModel: { ...limits, moduleDailyCalls: { example: 0 } } });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspace.id } })).settings).toMatchObject({ applicationData: { private: "keep" }, timezone: "UTC", moduleModel: { ...limits, moduleDailyCalls: { example: 0 } } });
});

for (const input of [
  { moduleModel: { ...limits, models: { fast: "provider/model" } } },
  { moduleModel: { ...limits, timeoutMs: 5000 } },
  { moduleModel: { ...limits, thinking: "high" } },
  { models: {} },
  { builds: {} },
  { timezone: "Invalid/Timezone" },
  { moduleModel: { ...limits, maxCallsPerEvent: 0 } },
  { moduleModel: { ...limits, eventTimeoutMs: 4999 } },
]) test(`settings reject removed policy or invalid values: ${JSON.stringify(input)}`, async () => {
  const f = await fixture();
  await expect(f.service.update(input)).rejects.toMatchObject({ code: "invalid" });
  expect((await f.service.get()).moduleModel).toBeNull();
  expect(await f.db.audit.count()).toBe(0);
});

for (const [field, minimum, maximum] of [["maxCallsPerEvent", 1, 20], ["maxOutputTokens", 1, 32000], ["dailyCalls", 1, 10000], ["eventTimeoutMs", 5000, 600000]] as const) test(`kernel budget ${field} boundaries`, () => {
  for (const value of [minimum, maximum]) expect(kernelModuleModelSettingsSchema.safeParse({ ...limits, [field]: value }).success).toBe(true);
  for (const value of [minimum - 1, maximum + 1, minimum + 0.5]) expect(kernelModuleModelSettingsSchema.safeParse({ ...limits, [field]: value }).success).toBe(false);
});

test("persisted legacy model settings are rejected rather than translated", () => {
  expect(() => moduleModelSettings({ moduleModel: { ...limits, models: { fast: "provider/model" }, timeoutMs: 5000 } })).toThrow();
  expect(moduleModelSettings({})).toBeNull();
});

test("governance timezone ignores legacy notification settings", () => {
  expect(budgetTimezone({ notifications: { timezone: "America/Los_Angeles" } })).toBe("Asia/Shanghai");
  expect(budgetTimezone({ timezone: "UTC", notifications: { timezone: "America/Los_Angeles" } })).toBe("UTC");
});
