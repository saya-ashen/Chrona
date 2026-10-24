import { expect, test } from "bun:test";
import { localDayKey } from "./local-day";
test.each([
  ["Asia/Shanghai", "2026-01-01T16:00:00Z", "2026-01-02"],
  ["America/New_York", "2026-03-08T06:59:00Z", "2026-03-08"],
  ["America/New_York", "2026-03-08T07:00:00Z", "2026-03-08"],
])("day %s %s", (timezone, time, day) => { expect(localDayKey(new Date(time), timezone)).toBe(day); });
