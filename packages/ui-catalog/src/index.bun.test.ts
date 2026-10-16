import { expect, test } from "bun:test";
import { checkUiSpec, compileUiSpec, uiGuide } from "./index";

const spec = { root: "tasks", elements: { tasks: { type: "TaskList", children: [], props: { path: "day.md", section: null, title: null, showProgress: true } } } };
test("compiles object and JSONL without stripping event bindings", () => {
  expect(compileUiSpec(spec)).toBe(spec);
  const withEvents = { ...spec, elements: { ...spec.elements, button: { type: "Button", props: { label: "Done", variant: null, disabled: null }, on: { press: { action: "say", params: { text: "done" } } } } } };
  const compiled = compileUiSpec(JSON.stringify({ op: "add", path: "/root", value: withEvents.root }) + "\n" + JSON.stringify({ op: "add", path: "/elements", value: withEvents.elements }));
  expect(compiled).toEqual(withEvents);
  expect(checkUiSpec(spec)).toEqual({ ok: true, issues: [] });
});
test.each(["../x.md", "/tmp/x", ".chrona/entry", "x/../y", "x\\y"])("rejects unsafe path %s with element id", path => {
  const result = checkUiSpec({ ...spec, elements: { tasks: { ...spec.elements.tasks, props: { ...spec.elements.tasks.props, path } } } });
  expect(result.ok).toBe(false);
  expect(result.issues.join()).toContain("tasks");
});
test.each([
  { ...spec, root: "absent" },
  { elements: spec.elements },
  { ...spec, elements: { tasks: { ...spec.elements.tasks, children: ["absent"] } } },
  ...["on", "visible", "repeat"].map(key => ({ ...spec, elements: { tasks: { ...spec.elements.tasks, props: { ...spec.elements.tasks.props, [key]: true } } } })),
  { root: "x", elements: { x: { type: "Script", props: {} } } },
  null,
])("rejects malformed structure %#", input => { expect(checkUiSpec(input).ok).toBe(false); });
test.each(["records.csv", "records.md", "../records.csv", "a\\\\records.csv"])("validates Panel data %s", data => {
  const props = { title: "Weight", data, fields: [{ key: "weight", label: "Weight", type: "number" }], views: [{ kind: "table", columns: ["weight"] }] };
  expect(checkUiSpec({ root: "panel", elements: { panel: { type: "Panel", props, children: [] } } }).ok).toBe(data === "records.csv");
});
test("guide includes preferences, usage, and tool-only save rule", () => {
  const guide = uiGuide(["Keep it short"], ["Page opened: home.ui.json: 3"]);
  expect(guide).toContain("User preference: Keep it short");
  expect(guide).toContain("Page opened: home.ui.json: 3");
  expect(guide).toContain("chrona_ui_set");
});
