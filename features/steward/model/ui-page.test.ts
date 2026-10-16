import { expect, it } from "vitest";
import { selectedPage, pageTasks } from "./ui-page";

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
