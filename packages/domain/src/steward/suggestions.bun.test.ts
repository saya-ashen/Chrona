import { expect, test } from "bun:test";
import type { Ask } from "@chrona/contracts/steward";
import { canSuggest } from "./suggestions";
const now = new Date("2026-01-31T00:00:00Z");
const ask: Ask = { id: "a", affairId: null, affairTitle: null, kind: "suggestion", status: "open", title: "建议", detail: "", questions: [], action: null, topic: "Read Books", answer: null, decision: null, cooldownUntil: null, ref: null, createdAt: "2026-01-01T00:00:00Z", resolvedAt: null };
test.each([
  ["open normalized", {}, false], ["other topic", { topic: "other" }, true], ["question", { kind: "question" }, true],
  ["null topic", { topic: null }, true], ["answered", { status: "answered" }, true],
  ["cooldown", { status: "dismissed", decision: "dismiss", resolvedAt: "2026-01-02T00:00:00Z" }, false],
  ["boundary", { status: "dismissed", resolvedAt: "2026-01-01T00:00:00Z" }, true],
  ["explicit cooldown", { status: "dismissed", cooldownUntil: "2026-02-01T00:00:00Z" }, false],
  ["permanent", { status: "dismissed", decision: "never_again", resolvedAt: "2000-01-01T00:00:00Z" }, false],
] satisfies [string, Partial<Ask>, boolean][])("suggest %s", (_name, patch, allowed) => {
  expect(canSuggest(" read\tBOOKS ", [{ ...ask, ...patch }], now)).toBe(allowed);
});
test("empty history", () => { expect(canSuggest("books", [], now)).toBe(true); });
