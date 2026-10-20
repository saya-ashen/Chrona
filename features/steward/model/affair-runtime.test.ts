import { expect, it } from "vitest";
import type { Affair, Run } from "@chrona/contracts";
import { affairWorkFeedback } from "./affair-center";
import { detailFixture, fixtureTime, runFixture } from "./fixtures";

it.each<[Run["status"], string | null]>([
  ["failed", "failed"], ["timed_out", "timed_out"], ["provider_unavailable", "provider_unavailable"],
  ["finished", null], ["cancelled", "cancelled"], ["queued", null], ["running", null],
])("derives only an actual unfinished outcome: %s", (status, expected) => {
  const detail = detailFixture();
  detail.runs = [{ ...runFixture(), status }];
  expect(affairWorkFeedback(detail)).toEqual({ issue: expected, recovering: false, canResume: expected !== null });
});
it.each<Affair["work"]>([
  { state: "queued", since: fixtureTime, label: "Prepare day two" },
  { state: "running", since: fixtureTime, label: "Prepare day two" },
])("does not ask for another retry while work is already $state", work => {
  const detail = detailFixture(); detail.affair.work = work; detail.runs = [runFixture()];
  expect(affairWorkFeedback(detail)).toEqual({ issue: "failed", recovering: true, canResume: false });
});
it.each(["paused", "done"] as const)("does not restart a %s affair", status => {
  const detail = detailFixture(); detail.affair.status = status; detail.runs = [runFixture()];
  expect(affairWorkFeedback(detail)).toEqual({ issue: null, recovering: false, canResume: false });
});
it("does not keep showing an old failure after recovery, regardless of array order", () => {
  const detail = detailFixture();
  const recovered = { ...runFixture(), id: "recovered", status: "finished" as const, endedAt: "2026-10-15T03:00:00Z" };
  for (const runs of [[runFixture(), recovered], [recovered, runFixture()]]) {
    detail.runs = runs; expect(affairWorkFeedback(detail).issue).toBeNull();
  }
});
it("uses the most recent failure and falls back to creation time when an end time is absent", () => {
  const detail = detailFixture();
  detail.runs = [runFixture(), { ...runFixture(), id: "later", status: "timed_out", endedAt: null, createdAt: "2026-10-15T04:00:00Z" }];
  expect(affairWorkFeedback(detail).issue).toBe("timed_out");
});
it("does not turn missing history into a failure", () => {
  expect(affairWorkFeedback(detailFixture())).toEqual({ issue: null, recovering: false, canResume: false });
});
