import { describe, expect, test } from "bun:test";
import { toolSpecSchema, validatePanelEntry, validateToolSpec } from "./tool-spec";
const spec = { title: "体重", fields: [{ key: "date", label: "日期", type: "date", required: true }, { key: "kg", label: "体重", type: "number", required: true }, { key: "tag", label: "时段", type: "select", options: ["早", "晚"] }], views: [{ kind: "trend", x: "date", y: "kg" }] };
describe("panel validation", () => {
  test("trend and optional description", () => expect(validateToolSpec({ ...spec, description: "记录" }).passed).toBe(true));
  test.each([
    [{ ...spec, views: [{ kind: "trend", x: "kg", y: "date" }] }, "x (kg)"],
    [{ ...spec, fields: [...spec.fields, spec.fields[0]] }, "键重复"],
    [{ ...spec, views: [{ kind: "table", columns: ["missing"] }] }, "missing"],
    [{ ...spec, fields: [{ key: "tag", label: "时段", type: "select" }] }, "options"],
  ])("actionable spec failure %#", (input, message) => expect(validateToolSpec(input).failures.join(" ")).toContain(message as string));
  test.each([
    [{ date: "2024-02-29", kg: "60.5" }, true],
    [{ date: "2025-02-29", kg: 60 }, false],
    [{ date: "2024-02-30", kg: 60 }, false],
    [{ date: "2024-2-01", kg: 60 }, false],
    [{ date: "2024-02-01", kg: true }, false],
    [{ date: "2024-02-01", kg: "Infinity" }, false],
    [{ date: "2024-02-01", kg: "" }, false],
    [{ date: "2024-02-01", kg: 60, tag: "午" }, false],
    [{ date: "2024-02-01", kg: 60, unknown: 1 }, false],
  ])("entry %#", (values, passed) => expect(validatePanelEntry(toolSpecSchema.parse(spec), values).passed).toBe(passed));
  test("normalizes numbers and absent optional fields", () => expect(validatePanelEntry(toolSpecSchema.parse(spec), { date: "2024-02-29", kg: "60.5" }).values).toEqual({ date: "2024-02-29", kg: 60.5, tag: null }));
});
