import { expect, test } from "bun:test";
import { evaluateEventRule, toolSpecSchema, validateToolSpec, type ToolSpec } from "./tool-spec";
const spec: Extract<ToolSpec, { type: "event_rule" }> = { type: "event_rule", match: { anyKeywords: ["urgent"], author: "Alice", connectionKind: "local_test" }, then: { disposition: "digest", note: "Review" }, cases: [{ title: "URGENT", body: "", author: "ALICE", expectMatch: true }, { title: "Hello", body: "", author: "Alice", expectMatch: false }] };
test.each([
  ["title", { title: "Urgent", body: "", author: "alice", connectionKind: "local_test" }, true],
  ["body", { title: "", body: "URGENT update", author: "Alice", connectionKind: "local_test" }, true],
  ["author", { title: "urgent", body: "", author: "Bob", connectionKind: "local_test" }, false],
  ["kind", { title: "urgent", body: "", author: "Alice", connectionKind: "reddit_inbox" }, false],
] as const)("pure rule: %s", (_name, event, matched) => { expect(evaluateEventRule(spec, event).matched).toBe(matched); });
test.each([
  ["valid", spec, true],
  ["wrong expectation", { ...spec, cases: spec.cases.map((c) => ({ ...c, expectMatch: !c.expectMatch })) }, false],
  ["no negative", { ...spec, cases: [spec.cases[0]] }, false],
  ["no positive", { ...spec, cases: [spec.cases[1]] }, false],
  ["external action", { ...spec, then: { disposition: "act", note: "send" } }, false],
  ["injected instruction", { ...spec, then: { ...spec.then, shell: "echo unsafe" } }, false],
  ["empty keywords", { ...spec, match: { anyKeywords: [] } }, false],
  ["panel", { type: "table_panel", columns: [{ key: "title", label: "Title" }], source: "affair_events" }, true],
  ["duplicate", { type: "table_panel", columns: [{ key: "title", label: "Title" }, { key: "title", label: "Again" }], source: "affair_events" }, false],
])("validation: %s", (_name, input, passed) => { expect(validateToolSpec(input).passed).toBe(passed as boolean); });
test("closed schema never admits executable code", () => { expect(toolSpecSchema.safeParse({ type: "shell", command: "echo unsafe" }).success).toBe(false); });
