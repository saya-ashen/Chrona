import { expect, test } from "bun:test";
import { formatCadence } from "./cadence";
for (const [minutes, text] of [[1, "每 1 分钟"], [59, "每 59 分钟"], [60, "每 1 小时"], [90, "每 90 分钟"], [120, "每 2 小时"], [1440, "每天"], [2880, "每 2 天"], [10080, "每周"], [20160, "每 14 天"]] as const) {
  test(`cadence ${minutes}`, () => expect(formatCadence(minutes)).toBe(text));
}
