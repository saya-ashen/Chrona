import { describe, expect, it } from "vitest";
import { stewardError } from "./client";
import { initialPanelValues, trendPoints, validatePanelEntry, type ToolSpec } from "./panel";
const spec: ToolSpec = { title: "Weight", fields: [{ key: "date", label: "Date", type: "date", required: true }, { key: "kg", label: "Weight", type: "number", required: true }], views: [{ kind: "trend", x: "date", y: "kg" }] };
it("defaults date to local today and validates required numbers and dates", () => {
  expect(initialPanelValues(spec, new Date(2026, 0, 2))).toEqual({ date: "2026-01-02", kg: "" });
  expect(validatePanelEntry(spec, { date: "2026-02-30", kg: "" }).passed).toBe(false);
  expect(validatePanelEntry(spec, { date: "2026-02-28", kg: "71.2" }).values).toEqual({ date: "2026-02-28", kg: 71.2 });
});
it("preserves concrete HTTP 400 validation messages", () => {
  expect(stewardError({ status: 400, data: { message: "Invalid date" } }).detail).toBe("Invalid date");
  expect(stewardError({ status: 500, data: { message: "Internal details" } }).detail).toBeUndefined();
});
describe("trend scaling", () => {
  it.each([
    { values: [71], lower: 70, upper: 72 },
    { values: [71, 71], lower: 70, upper: 72 },
    { values: [0, 0], lower: -1, upper: 1 },
    { values: [-20, -10], lower: -20.5, upper: -9.5 },
    { values: [0, 100], lower: -5, upper: 105 },
    { values: [71, 73], lower: 70.9, upper: 73.1 },
  ])("pads range $values to $lower–$upper", ({ values, lower, upper }) => {
    const trend = trendPoints(values.map((kg, i) => ({ values: { date: `2026-01-0${i + 1}`, kg } })), "date", "kg")!;
    expect(trend.lower).toBeCloseTo(lower);
    expect(trend.upper).toBeCloseTo(upper);
    expect(trend.min).toBe(Math.min(...values));
    expect(trend.max).toBe(Math.max(...values));
    for (const point of trend.points) {
      expect(point.y).toBeGreaterThan(40);
      expect(point.y).toBeLessThan(200);
    }
  });
  it.each([
    { label: "empty", rows: [], expected: null },
    { label: "single", rows: [{ values: { date: "2026-01-01", kg: 71 } }], expected: [[300, 120]] },
    { label: "chronological", rows: [{ values: { date: "2026-01-03", kg: 73 } }, { values: { date: "2026-01-01", kg: 71 } }], expected: [[60, 192.727273], [540, 47.272727]] },
    { label: "flat", rows: [{ values: { date: "2026-01-01", kg: 71 } }, { values: { date: "2026-01-03", kg: 71 } }], expected: [[60, 120], [540, 120]] },
    { label: "missing", rows: [{ values: { date: "bad", kg: 71 } }], expected: null },
  ])("$label", ({ rows, expected }) => expect(trendPoints(rows, "date", "kg")?.points.map(p => [p.x, Number(p.y.toFixed(6))]) ?? null).toEqual(expected));
});
