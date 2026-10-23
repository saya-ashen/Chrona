import { describe, expect, it } from "vitest";
import en from "../../../packages/i18n/src/messages/en.json";
import zh from "../../../packages/i18n/src/messages/zh.json";
import { appFixture, emptyToday } from "./fixtures";
import { groupWorkspaceApps, scheduleDescription, workspaceHealthy } from "./workspace";

describe("workspace view models", () => {
  it("groups apps by status without duplication", () => {
    const app = appFixture();
    const groups = groupWorkspaceApps([app, { ...app, id: "paused", status: "paused" }]);
    expect(groups.map(group => [group.key, group.items.map(item => item.id)])).toEqual([["active", ["camera"]], ["paused", ["paused"]]]);
  });
  it.each([
    [{ kind: "daily", time: "09:00" }, "每天 09:00"],
    [{ kind: "weekly", days: [0, 1], time: "18:00" }, "每周 周日、周一 18:00"],
    [{ kind: "every", minutes: 15 }, "每 15 分钟"],
  ] as const)("describes %j in Chinese", (rule, expected) => {
    expect(scheduleDescription(rule.kind === "weekly" ? { ...rule, days: [...rule.days] } : rule, "zh", zh.steward.workspace)).toBe(expected);
  });
  it("describes English schedules", () => {
    expect(scheduleDescription({ kind: "daily", time: "09:00" }, "en", en.steward.workspace)).toBe("Daily at 09:00");
    expect(scheduleDescription({ kind: "at", at: "2026-10-15T10:00:00Z" }, "en", en.steward.workspace)).toContain("2026");
  });
  it("reports unavailable provider and failed deliveries honestly", () => {
    const health = emptyToday().health;
    expect(workspaceHealthy(health)).toBe(true);
    expect(workspaceHealthy({ ...health, failedNotifications: 1 })).toBe(false);
    expect(workspaceHealthy({ ...health, provider: { ...health.provider, available: false } })).toBe(false);
  });
});
