import { describe, expect, it } from "vitest";
import { fileTree, fileKind, markdownParts, panelRows, toggleCheckbox, localImagePath, omitReadmeSummary } from "./affair-file";
import { fixtureTime } from "./fixtures";
import { scheduleDescription } from "./workspace";
import zh from "../../../packages/i18n/src/messages/zh.json";
export const panelSpec = { title: "Weight", data: "weight.csv", fields: [{ key: "day", label: "Day", type: "date" as const }, { key: "kg", label: "Weight (kg)", type: "number" as const }], views: [{ kind: "trend" as const, x: "day", y: "kg" }, { kind: "table" as const, columns: ["day", "kg"] }] };
export const panelMarkdown = '```chrona-panel\n' + JSON.stringify(panelSpec) + '\n```';
describe("affair files", () => {
  it.each([
    ["# Title\n\nSummary with [link](page.md).\nMore summary.\n\n## Result\n- [ ] Go", "# Title\n\n\n\n\n## Result\n- [ ] Go"],
    ["Summary only", ""],
    ["# Title\n\n- [ ] Go", "# Title\n\n- [ ] Go"],
    ["Title\n=====\n\nSummary\n\nResult", "Title\n=====\n\n\n\nResult"],
  ])("omits the README paragraph without shifting checkbox lines", (source, expected) => {
    expect(omitReadmeSummary(source, "README.md")).toBe(expected);
    expect(omitReadmeSummary(source, "day-01.md")).toBe(source);
    expect(markdownParts(omitReadmeSummary(source, "README.md")).filter(part => part.kind === "task")).toEqual(markdownParts(source).filter(part => part.kind === "task"));
  });
  it("builds implicit folders, sorts README first and hides metadata", () => {
    const tree = fileTree(["z.md", "days/a.md", ".chrona/state.json", "README.md", "days/.chrona/test"].map(path => ({ path, kind: "file", size: 1, updatedAt: fixtureTime })));
    expect(tree.map(node => node.name)).toEqual(["README.md", "days", "z.md"]);
    expect(tree[1]?.children.map(node => node.name)).toEqual(["a.md"]);
  });
  it("uses source line numbers, leaves fenced tasks inert and renders panels", () => {
    const parts = markdownParts('# Title\n\n- [ ] Go\n```md\n- [ ] Example\n```\n' + panelMarkdown);
    expect(parts.filter(part => part.kind === "task")).toEqual([{ kind: "task", text: "Go", checked: false, line: 3 }]);
    expect(parts.at(-1)).toEqual({ kind: "panel", spec: panelSpec });
    expect(toggleCheckbox("# Title\r\n- [ ] Go\r\n", 2, true)).toBe("# Title\r\n- [x] Go\r\n");
    expect(markdownParts('```chrona-panel\n{}')[0]?.kind).toBe("invalidPanel");
  });
  it("parses typed CSV values without silently discarding malformed rows", () => {
    expect(panelRows('day,kg\r\n2026-10-15,"70.5"\r\n', panelSpec)[0]?.values).toEqual({ day: "2026-10-15", kg: 70.5 });
    expect(() => panelRows("day,kg\n2026-10-15,no\n", panelSpec)).toThrow();
  });
  it.each(['day,kg\n"2026-10-15,70', 'day,kg\n2026-10-15,"70"x', 'day,kg\n2026-10-15,7"0', 'kg,day\n70,2026-10-15'])('rejects malformed CSV %s', csv => expect(() => panelRows(csv, panelSpec)).toThrow());
  it("reads quoted commas, escaped quotes and multiline cells", () => {
    const spec = { ...panelSpec, fields: [{ key: "note", label: "Note", type: "text" as const }], views: [{ kind: "table" as const, columns: ["note"] }] };
    expect(panelRows('note\n"a,b\n""quoted"""\n', spec)[0]?.values).toEqual({ note: 'a,b\n"quoted"' });
  });
  it.each([["README.md", "markdown"], ["a.png", "image"], ["a.txt", "text"], ["a.py", "text"], ["Dockerfile", "text"], ["a.pdf", "binary"]])("classifies %s", (path, kind) => expect(fileKind(path)).toBe(kind));
  it("resolves images within the affair only", () => {
    expect(localImagePath("../images/a.png", "days/one.md")).toBe("images/a.png");
    expect(localImagePath("../../a.png", "days/one.md")).toBeNull();
    expect(localImagePath("https://example.com/a.png", "README.md")).toBeNull();
    expect(localImagePath(".chrona/a.png", "README.md")).toBeNull();
  });
  it.each([
    [{ kind: "daily", time: "09:00" } as const, "每天 09:00"],
    [{ kind: "every", minutes: 30 } as const, "每 30 分钟"],
    [{ kind: "weekly", days: [1, 3], time: "18:00" } as const, "每周 周一、周三 18:00"],
  ])("describes schedule %j in Chinese", (rule, expected) => expect(scheduleDescription(rule.kind === "weekly" ? { ...rule, days: [...rule.days] } : rule, "zh", zh.steward.workspace)).toBe(expected));
});
