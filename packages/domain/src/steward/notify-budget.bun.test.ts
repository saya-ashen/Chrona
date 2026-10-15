import { expect, test } from "bun:test";
import { isDigestDue, localDayKey, routeNotification } from "./notify-budget";
const base = { sentToday: 0, dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "UTC", now: new Date("2026-01-01T12:00:00Z"), urgent: false };
test.each([
  ["normal", "now", {}, "send"], ["web", "web", {}, "web"], ["digest", "digest", { urgent: true }, "fold"],
  ["cap", "now", { sentToday: 5, urgent: true }, "fold"], ["zero", "now", { dailyCap: 0 }, "fold"],
  ["start", "now", { now: new Date("2026-01-01T23:00:00Z") }, "fold"],
  ["end", "now", { now: new Date("2026-01-01T08:00:00Z") }, "send"],
  ["midnight", "now", { now: new Date("2026-01-01T00:00:00Z") }, "fold"],
  ["urgent", "now", { now: new Date("2026-01-01T00:00:00Z"), urgent: true }, "send"],
  ["disabled", "now", { quietHours: null }, "send"],
  ["day quiet", "now", { quietHours: { start: "11:00", end: "13:00" } }, "fold"],
  ["equal", "now", { quietHours: { start: "12:00", end: "12:00" } }, "send"],
  ["timezone", "now", { timezone: "Pacific/Auckland" }, "fold"],
] as const)("route %s", (_name, level, patch, expected) => { expect(routeNotification(level, { ...base, ...patch })).toBe(expected); });
test.each([
  ["Asia/Shanghai", "2026-01-01T16:00:00Z", "2026-01-02"],
  ["America/New_York", "2026-03-08T06:59:00Z", "2026-03-08"],
  ["America/New_York", "2026-03-08T07:00:00Z", "2026-03-08"],
])("day %s %s", (timezone, time, day) => { expect(localDayKey(new Date(time), timezone)).toBe(day); });
test.each([
  ["08:59", null, false], ["09:00", null, true], ["23:59", "2025-12-31", true], ["12:00", "2026-01-01", false],
] as const)("digest %s %s", (time, lastDigestDay, due) => {
  expect(isDigestDue({ digestAt: "09:00", timezone: "UTC", now: new Date(`2026-01-01T${time}:00Z`), lastDigestDay })).toBe(due);
});
