import { expect, test } from "bun:test";
import { exampleWorkPage } from "@chrona/ui-protocol/work-pages/example";
import { readableResultContent } from "./readable-content";
const semantic = { schemaVersion: 1, outcome: { title: "Plan", summary: "Useful conclusion" }, readiness: { status: "ready", summary: "Semantic result" } };

test("valid page remains separate from semantic fallback and legacy scopes", () => {
  const raw = { ...semantic, page: exampleWorkPage };
  expect(readableResultContent(raw, true).content.page).toEqual(exampleWorkPage);
  const legacy = readableResultContent(raw, false);
  expect(legacy.content.page).toBeUndefined();
  expect(legacy.pageUnavailable).toBe(false);
  expect(raw.page).toEqual(exampleWorkPage);
});
test.each([{ schemaVersion: 2 }, { ...exampleWorkPage, on: { click: { action: "execute" } } }, null])("unsupported presentation preserves semantics, never executes or silently counts as renderable: %j", (page) => {
  const view = readableResultContent({ ...semantic, page }, true);
  expect(view.pageUnavailable).toBe(true);
  expect(view.content.page).toBeUndefined();
  expect(view.content.outcome.summary).toBe(semantic.outcome.summary);
});
test("invalid semantic content still fails closed", () => {
  expect(() => readableResultContent({ page: exampleWorkPage }, true)).toThrow();
});
