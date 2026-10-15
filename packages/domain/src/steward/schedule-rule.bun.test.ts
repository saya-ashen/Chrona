import { expect, test } from "bun:test";
import type { ScheduleRule } from "@chrona/contracts/steward";
import { describeRule, nextOccurrence } from "./schedule-rule";

test.each([
  [{ kind: "at", at: "2026-10-16T08:00:00+08:00" }, "2026-10-15T00:00:00Z", "Asia/Shanghai", "2026-10-16T00:00:00.000Z"],
  [{ kind: "at", at: "2026-10-16T08:00:00+08:00" }, "2026-10-16T00:00:00Z", "Asia/Shanghai", null],
  [{ kind: "daily", time: "08:00" }, "2026-10-16T00:00:00Z", "Asia/Shanghai", "2026-10-17T00:00:00.000Z"],
  [{ kind: "weekly", days: [1, 3], time: "20:00" }, "2026-10-14T12:00:00Z", "Asia/Shanghai", "2026-10-19T12:00:00.000Z"],
  [{ kind: "every", minutes: 30 }, "2026-03-08T06:45:12Z", "America/New_York", "2026-03-08T07:15:12.000Z"],
  [{ kind: "daily", time: "02:30" }, "2026-03-08T05:00:00Z", "America/New_York", "2026-03-09T06:30:00.000Z"],
  [{ kind: "daily", time: "01:30" }, "2026-11-01T05:30:00Z", "America/New_York", "2026-11-01T06:30:00.000Z"],
  [{ kind: "daily", time: "00:00" }, "2026-12-31T23:59:59Z", "UTC", "2027-01-01T00:00:00.000Z"],
] satisfies [ScheduleRule, string, string, string | null][])("next %j after %s", (rule, after, timezone, expected) => {
  expect(nextOccurrence(rule, new Date(after), timezone)?.toISOString() ?? null).toBe(expected);
});
test.each([
  [{ kind: "daily", time: "08:00" }, "每天 08:00"],
  [{ kind: "weekly", days: [3, 1, 1], time: "20:00" }, "每周一、三 20:00"],
  [{ kind: "every", minutes: 30 }, "每 30 分钟"],
  [{ kind: "at", at: "2026-10-16T08:00:00+08:00" }, "10月16日 08:00"],
] satisfies [ScheduleRule, string][])("describe %j", (rule, expected) => expect(describeRule(rule)).toBe(expected));
test.each(["24:00", "12:60", "99:99"])("reject wall time %s", time => expect(() => nextOccurrence({ kind: "daily", time }, new Date(), "UTC")).toThrow());
test("invalid date/timezone", () => {
  expect(() => nextOccurrence({ kind: "every", minutes: 30 }, new Date(NaN), "UTC")).toThrow();
  expect(() => nextOccurrence({ kind: "daily", time: "08:00" }, new Date(), "invalid")).toThrow();
});
