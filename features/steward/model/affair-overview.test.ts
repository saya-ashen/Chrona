import { expect, it } from "vitest";
import zh from "../../../packages/i18n/src/messages/zh.json";
import { affairOverview, plainSummary, todaySummary } from "./affair-overview";
import { affairFixture, approvalFixture, emptyToday, fixtureTime } from "./fixtures";

it.each([
  ["[材料](day-01.md)", "材料"],
  ["![比较图](images/camera.png)", "比较图"],
  ["**粗体**和*斜体*、__重点__、_注释_", "粗体和斜体、重点、注释"],
  ["# 标题\n\n## 小标题\n正文", "标题 小标题 正文"],
  ["[资料](https://example.com/a_(b))", "资料"],
  ["普通摘要", "普通摘要"],
])("reduces %s to readable plain text", (input, expected) => expect(plainSummary(input)).toBe(expected));

it.each([
  [2, 1, 3, "2 件事等你决定"],
  [0, 2, 3, "Chrona 正在处理 2 件事"],
  [0, 0, 3, "这周有 3 件事有进展"],
  [0, 0, 0, "目前没有需要你处理的事"],
])("summarizes approvals %i, work %i, progress %i", (approvals, work, progress, expected) => {
  const view = { ...emptyToday(), approvals: Array.from({ length: approvals }, approvalFixture), progress: Array.from({ length: progress }, (_, i) => ({ affair: { ...affairFixture(), work: i < work ? { state: "queued" as const, since: fixtureTime, label: null } : null }, updates: [], changedPages: 0 })) };
  expect(todaySummary(view, { ...zh.steward.foundation, working: zh.steward.overview.working, progress: zh.steward.overview.progressSummary })).toBe(expected);
});
it.each([
  [null, null],
  [{ state: "running", label: "比较", since: fixtureTime }, "正在处理：比较"],
  [{ state: "running", label: null, since: fixtureTime }, "正在回复你的消息"],
  [{ state: "queued", label: "比较", since: fixtureTime }, "即将处理：比较"],
  [{ state: "queued", label: null, since: fixtureTime }, "即将处理：Chrona 的后续工作"],
] as const)("derives work status %j", (work, expected) => {
  expect(affairOverview({ ...affairFixture(), work }, "zh", zh.steward.affairCenter).status).toBe(expected);
});
it("uses generic next work copy when label is null", () => {
  expect(affairOverview({ ...affairFixture(), nextSchedule: { mode: "wake", label: null, at: fixtureTime } }, "zh", zh.steward.affairCenter).next).toContain("下一次：Chrona 的后续工作 · ");
});
