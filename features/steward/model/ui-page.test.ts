import { expect, it } from "vitest";
import { compactUiTable, selectedPage, pageTasks, pageStateUpdates } from "./ui-page";

const page = ["# Day 1", "- [x] intro", "## 今日清单", "- [ ] 口语 20′", "- [x] 听力 90′", "### 细节", "- [ ] nested", "## 记录", "- [ ] later"].join("\n");
it.each([
  [null, ["intro", "口语 20′", "听力 90′", "nested", "later"]],
  ["今日清单", ["口语 20′", "听力 90′", "nested"]],
  ["记录", ["later"]],
  ["missing", []],
])("takes tasks for section %s", (section, texts) => {
  expect(pageTasks(page, section).map(task => task.text)).toEqual(texts);
});
it("keeps source line numbers for write-back", () => {
  expect(pageTasks(page, "今日清单")).toEqual([{ line: 4, text: "口语 20′", checked: false }, { line: 5, text: "听力 90′", checked: true }, { line: 7, text: "nested", checked: false }]);
});
it.each([
  ["首页.ui.json", null, "首页.ui.json"],
  ["首页.ui.json", "d/x.ui.json", "d/x.ui.json"],
  ["首页.ui.json", "README.md", "README.md"],
  [undefined, null, "README.md"],
])("selects entry %s with navigation %s", (entry, path, expected) => expect(selectedPage(entry, path)).toBe(expected));

it.each([
  { previous: { answer: "" }, local: { answer: "draft" }, incoming: { answer: "new default" }, updates: {} },
  { previous: { answer: "" }, local: { answer: "" }, incoming: { answer: "new default" }, updates: { "/answer": "new default" } },
  { previous: { count: 1, answer: "" }, local: { count: 1, answer: "draft" }, incoming: { count: 2, answer: "new" }, updates: { "/count": 2 } },
  { previous: { removed: true }, local: { removed: true }, incoming: { added: 1 }, updates: { "/removed": undefined, "/added": 1 } },
  { previous: { form: { answer: "" } }, local: { form: { answer: "draft" } }, incoming: { form: { answer: "server" } }, updates: {} },
  { previous: { rows: [1] }, local: { rows: [1, 2] }, incoming: { rows: [3, 1] }, updates: {} },
  { previous: { "a/b~c": "" }, local: { "a/b~c": "" }, incoming: { "a/b~c": "new" }, updates: { "/a~1b~0c": "new" } },
  { previous: { count: 1 }, local: { count: 1 }, incoming: { count: 1 }, updates: {} },
])("refreshes page state without merging over local drafts: %j", ({ previous, local, incoming, updates }) => {
  expect(pageStateUpdates(previous, local, incoming)).toEqual(updates);
});

it.each([
  { columns: ["Subject", "Daily", "Mock"], rows: [["Speaking", "100 min", "60 min"], ["Total", "240 min", "240 min"]], compact: true },
  { columns: ["Name"], rows: [], compact: true },
  { columns: ["项目", "用时"], rows: [["口语", "100分钟"]], compact: true },
  { columns: ["Source", "Type"], rows: [["[official](https://example.com/" + "long/".repeat(20) + ")", "audio"]], compact: true },
  { columns: ["A", "B", "C", "D"], rows: [["1", "2", "3", "4"]], compact: false },
  { columns: ["Name", "Notes"], rows: [["NAS", "Long explanations need room to stay readable on a narrow screen."]], compact: false },
  { columns: [], rows: [], compact: false },
  { columns: ["Name"], rows: [["one", "extra"]], compact: false },
])("chooses a readable table layout for $columns", ({ columns, rows, compact }) => {
  expect(compactUiTable(columns, rows)).toBe(compact);
});
