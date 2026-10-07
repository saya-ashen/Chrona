import { describe, expect, it } from "bun:test";
import { deriveWorkResultState, workResultRevision, workResultScopeKey, workResultWritesAllowed } from "./work-results";

describe("work-result state", () => {
  it("isolates scope and binds revision to the result identity", () => {
    expect(workResultScopeKey(null)).toBe("task");
    expect(workResultScopeKey("one")).toBe("occurrence:one");
    expect(workResultRevision({ id: "r", editRevision: 3 })).toBe("result-v1:r:3");
  });
  it.each([
    ["WaitingForInput", true], ["WaitingForApproval", true], ["Blocked", true], ["Failed", true],
    ["Completed", true], ["Done", false], ["Cancelled", false],
  ] as const)("keeps %s lifecycle distinct from result writes", (status, allowed) => {
    expect(workResultWritesAllowed({ status, definitionStatus: "Active" }, "Active")).toBe(allowed);
    expect(workResultWritesAllowed({ status, definitionStatus: "Active" }, "Archived")).toBe(false);
    expect(workResultWritesAllowed({ status, definitionStatus: "Stopped" }, "Active")).toBe(false);
  });
  it.each([
    ["ready", 0, true], ["ready_with_caveats", 0, true], ["partial", 0, false], ["blocked", 0, false], ["ready", 1, false],
  ] as const)("derives reported readiness %s with %s missing files", (readiness, unavailableRequiredArtifacts, canAcceptContent) => {
    expect(deriveWorkResultState({ headVersionId: "v2", acceptedVersionId: "v1", selectedVersionId: "v2", readiness, unavailableRequiredArtifacts }))
      .toEqual({ current: true, accepted: false, newerVersionPending: true, canAcceptContent, readinessIsSourceReported: true });
    expect(deriveWorkResultState({ headVersionId: "v2", acceptedVersionId: "v1", selectedVersionId: "v1", readiness, unavailableRequiredArtifacts }).canAcceptContent).toBe(false);
  });
});
