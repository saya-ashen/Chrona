import { expect, test } from "bun:test";
import { appendCsvRow, parsePanelBlocks, toggleCheckbox } from "./markdown";
import type { ToolSpec } from "./tool-spec";

test.each([
  ["- [ ] task", 1, true, "- [x] task"],
  ["header\r\n  * [x] task\r\n", 2, false, "header\r\n  * [ ] task\r\n"],
  ["- [x] task", 1, true, "- [x] task"],
] as const)("toggle %s", (input, line, checked, expected) => expect(toggleCheckbox(input, line, checked)).toBe(expected));
test.each(["plain", "- [X] task", "+ [ ] task", "- [ ]not a task"])("reject %s", input => expect(() => toggleCheckbox(input, 1, true)).toThrow());
test.each([0, -1, 2, 1.5])("reject line %s", line => expect(() => toggleCheckbox("- [ ] task", line, true)).toThrow());
const fields: ToolSpec["fields"] = [{ key: "note", label: "记录", type: "text", required: true }, { key: "amount", label: "数量", type: "number" }];
const panel: ToolSpec & { data: string } = { title: "记录", data: "data/log.csv", fields, views: [{ kind: "table", columns: ["note", "amount"] }] };
const block = (value: unknown) => "```chrona-panel\n" + JSON.stringify(value) + "\n```";
test("parse multiple panels, ignore other fences", () => {
  expect(parsePanelBlocks(block(panel) + "\n" + block(panel))).toEqual([panel, panel]);
  expect(parsePanelBlocks("````markdown\n" + block(panel) + "\n````")).toEqual([]);
});
test.each([
  { ...panel, data: "../secret.csv" }, { ...panel, data: "/log.csv" }, { ...panel, data: "log.json" },
  { ...panel, views: [{ kind: "table", columns: ["missing"] }] }, { ...panel, fields: [fields[0], fields[0]] },
])("invalid panel %j", value => expect(() => parsePanelBlocks(block(value))).toThrow());
test.each(["```chrona-panel\n{}", "```chrona-panel\nnot json\n```"])("invalid block", content => expect(() => parsePanelBlocks(content)).toThrow());
test.each([
  ["", { note: 'a,"b"\nc', amount: "2.5" }, 'note,amount\n"a,""b""\nc",2.5\n'],
  ["note,amount\r\nold,1\r\n", { note: "new" }, "note,amount\r\nold,1\r\nnew,\r\n"],
  ["note,amount", { note: "new", amount: 0 }, "note,amount\nnew,0\n"],
] as const)("append CSV %s", (csv, values, expected) => expect(appendCsvRow(csv, fields, values)).toBe(expected));
test.each([
  ["", { amount: 2 }], ["", { note: "ok", amount: Infinity }], ["", { note: "ok", unknown: 1 }],
  ["other,amount\n", { note: "ok" }], ['note,amount\n"open,1', { note: "ok" }],
  ["note,amount\nbad,1,2\n", { note: "ok" }],
] as const)("reject CSV/value %s", (csv, values) => expect(() => appendCsvRow(csv, fields, values)).toThrow());
