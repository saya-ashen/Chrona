import { expect, it } from "vitest";
import type { Affair } from "@chrona/contracts";
import { affairPill, affairPillClass, progressPill, progressPillClass, progressDetail } from "./affair-overview";
import { affairPages } from "./affair-center";
import { connectorStatusClass } from "./connector-status";
import { omitReadmeSummary } from "./affair-file";
import { affairFixture, detailFixture, fixtureTime } from "./fixtures";

const copy = { runningPill: "running", queuedPill: "queued", waitingPill: "waiting", activePill: "active" };
const statuses = { active: "active status", paused: "paused", done: "done" };
const primary = "bg-primary-soft text-primary";
const muted = "bg-muted text-muted-foreground";
const warning = "bg-warning/10 text-warning";
it.each(([
  ["running", 1, "paused", "running", primary, primary],
  ["queued", 1, "active", "queued", muted, muted],
  [null, 1, "done", "waiting", warning, warning],
  [null, 0, "active", "active", primary, warning],
  [null, 0, "paused", "paused", muted, warning],
  [null, 0, "done", "done", muted, warning],
] as const).map(row => ({ row })))("preserves pill priority: $row", ({ row: [state, openApprovals, status, label, affairClass, progressClass] }) => {
  const affair: Affair = { ...affairFixture(), status, openApprovals, work: state ? { state, since: fixtureTime, label: null } : null };
  expect(affairPill(affair, copy, statuses)).toBe(label);
  expect(progressPill(affair, copy)).toBe(state || (openApprovals ? "waiting" : null));
  expect(affairPillClass(affair)).toBe(affairClass);
  expect(progressPillClass(affair)).toBe(progressClass);
});
it.each([
  [0, null, ""], [2, null, "2 pages"], [0, "next", "next"], [2, "next", "2 pages · next"], [-1, "", ""],
] as const)("progress detail %i/%s", (count, next, expected) => {
  expect(progressDetail(count, next, "{count} pages")).toBe(expected);
});
it.each([
  ["active", "bg-success/10 text-success"], ["failing", warning], ["needs_authorization", warning], ["paused", muted],
] as const)("connector status %s", (status, expected) => expect(connectorStatusClass(status)).toBe(expected));
it.each([
  ["README.md", true], ["missing.md", false], [".chrona/private.md", false], ["folder", false],
])("selects only visible files: %s", (path, selected) => {
  const detail = detailFixture();
  detail.files.push({ ...detail.files[0]!, path: ".chrona/private.md" }, { ...detail.files[0]!, path: "folder", kind: "dir" });
  const model = affairPages(detail, path);
  expect(!!model.selected).toBe(selected);
  expect(model.tree.map(node => node.path)).toEqual(["README.md", "folder"]);
});
it.each([null, undefined])("missing affair has no pages: %s", detail => {
  expect(affairPages(detail, "README.md")).toEqual({ selected: undefined, tree: [] });
});
it.each([
  ["# Heading\n\nSummary\ncontinued\n\n- [ ] task", "# Heading\n\n\n\n\n- [ ] task"],
  ["Heading\n===\nSummary\n# Next", "Heading\n===\n\n# Next"],
  ["```\nexample\n```\nSummary", "```\nexample\n```\n"],
  ["# Heading\n- [ ] task", "# Heading\n- [ ] task"],
  ["Summary\n> quote", "\n> quote"],
])("blanks summary without moving source lines: %s", (content, expected) => {
  expect(omitReadmeSummary(content, "README.md")).toBe(expected);
  expect(omitReadmeSummary(content, "other.md")).toBe(content);
});
