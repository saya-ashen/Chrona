import { describe, expect, it } from "vitest";
import { workResults as wr } from "@chrona/contracts";
import { buildResultDraft, canComposeResult, emptyResultContent, resultReviewReason, resultWriteReason, supportingDetails } from "./state";

const context: wr.WorkResultContext = { task: { id: "task", title: "Task", status: "Ready", definitionStatus: "Active" }, occurrenceId: null, writesEnabled: true, workOpen: true, canSubmit: true, canReview: true, canUpload: true, canDownload: true };
const version: NonNullable<wr.WorkResultView["version"]> = { id: "v1", resultId: "r", version: 1, parentVersionId: null, contentHash: "hash", sourceKind: "external", actorKey: "external:agent", sourceLabel: null, sourceWorkId: null, sourceReportedAt: null, publishedAt: "2026-09-17T00:00:00.000Z", content: { ...emptyResultContent, outcome: { title: "Report", summary: "Summary" }, readiness: { status: "ready", summary: "Source claim" } } };
const view: wr.WorkResultView = { result: null, version, state: { current: true, accepted: false, newerVersionPending: false, canAcceptContent: true, readinessIsSourceReported: true } };
describe("independent result UI permissions and content", () => {
  it.each([
    ["flag off", { writesEnabled: false }, "writeDisabled"],
    ["closed", { workOpen: false }, "closed"],
    ["read-only", { canReview: false }, "forbidden"],
    ["normal", {}, null],
  ] as const)("review disabled reason: %s", (_name, patch, expected) => {
    expect(resultReviewReason({ ...context, ...patch }, view, true)).toBe(expected);
  });
  it.each(["partial", "blocked", "missing-files"] as const)("blocks acceptance, not feedback, for %s", (scenario) => {
    const unavailable = { ...view, version: { ...version, content: { ...version.content, readiness: { ...version.content.readiness, status: scenario === "missing-files" ? "ready" as const : scenario } } },
      unavailableRequiredArtifacts: scenario === "missing-files" ? ["AF000000000001"] : [], state: { ...view.state!, canAcceptContent: false } };
    expect(resultReviewReason(context, unavailable, true)).toBe("notReady");
    expect(resultReviewReason(context, unavailable, false)).toBeNull();
  });
  it("does not confuse historical acceptance, current head, readiness and task completion", () => {
    const historical = { ...view, state: { ...view.state!, current: false, accepted: true, newerVersionPending: true } };
    expect(resultReviewReason(context, historical, true)).toBe("historical");
    expect(canComposeResult(context, historical)).toBe(false);
    expect(resultReviewReason(context, { result: null, version: null }, false)).toBe("historical");
    expect(canComposeResult(context, { result: null, version: null })).toBe(true);
    // Completed execution still permits result refinement; Done is modeled as workOpen=false.
    expect(resultWriteReason({ ...context, task: { ...context.task, status: "Completed" } }, true)).toBeNull();
    expect(resultWriteReason({ ...context, workOpen: false, task: { ...context.task, status: "Done" } }, true)).toBe("closed");
  });
  it("round-trips every structured item and existing optional metadata without dropping fields", () => {
    const content = wr.workResultContentSchema.parse({ ...version.content, findings: [{ key: "finding", title: "Title", content: "Text", importance: "primary" }],
      evidence: [{ key: "evidence", summary: "Evidence", artifactRef: "AF000000000001" }], deliverables: [{ key: "file", title: "File", kind: "document", artifactRef: "AF000000000001", summary: "Summary", placement: "supporting", required: false, presentation: { primary: "document", allowDownload: false } }] });
    expect(buildResultDraft(content, supportingDetails(content))).toEqual(content);
    expect(() => buildResultDraft(content, '{"outcome":{"title":"hidden replacement"}}')).toThrow();
    expect(() => buildResultDraft(content, '{"findings":[{"key":"same","content":"one"},{"key":"same","content":"two"}]}')).toThrow();
  });
});
