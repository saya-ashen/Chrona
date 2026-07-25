import { describe, expect, it } from "bun:test";
import type { ResultManifest } from "@chrona/contracts/ai";
import { __resultFinalizationTestHooks } from "./finalize-task-result";

const manifest: ResultManifest = {
  schemaVersion: 1,
  sourceRevision: 3,
  outcome: { title: "Complete", summary: "The report is ready." },
  readiness: { status: "ready", summary: "Ready for review." },
  sections: [
    { key: "outcome", title: "Outcome", kind: "outcome", itemKeys: [] },
    { key: "deliverables", title: "Current deliverables", kind: "deliverables", itemKeys: ["report"] },
  ],
  deliverables: [{
    deliverableKey: "report",
    title: "Report",
    kind: "document",
    artifactRef: "AF111111111111",
    status: "current",
    sourceNodeRef: "N1",
    presentation: { primary: "file", allowDownload: true },
    placement: "primary",
  }],
  findings: [],
  decisions: [],
  caveats: [],
  nextActions: [],
  evidence: [],
};

function resultSpec(fileRef = "AF111111111111") {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "md" }, children: ["summary", "file"] },
      summary: { type: "ResultSummary", props: { title: "Complete", summary: "The report is ready." } },
      file: { type: "FileRef", props: { path: fileRef, title: "Report" } },
    },
  };
}

describe("finalized result validation", () => {
  it("accepts only declared opaque Artifact refs and strips host provenance", () => {
    const spec = resultSpec() as Record<string, unknown>;
    const elements = spec.elements as Record<string, { props: Record<string, unknown> }>;
    elements.file!.props.downloadHref = "/api/tasks/task-1/result-file";
    elements.file!.props.accessTaskId = "task-1";
    elements.file!.props.sourceNodeId = "node-1";
    elements.file!.props.provider = "omp";

    const validated = __resultFinalizationTestHooks.validateFinalizedSpec({ manifest, payload: spec });

    expect(validated.elements.file?.props).toEqual({ path: "AF111111111111", title: "Report" });
  });

  it("rejects undeclared and malformed Artifact refs", () => {
    expect(() => __resultFinalizationTestHooks.validateFinalizedSpec({
      manifest,
      payload: resultSpec("AF222222222222"),
    })).toThrow("undeclared artifact AF222222222222");
    expect(() => __resultFinalizationTestHooks.validateFinalizedSpec({
      manifest,
      payload: resultSpec("AFnot-opaque"),
    })).toThrow("undeclared artifact AFnot-opaque");
  });

  it("rejects generated URIs, POSIX and Windows absolute paths, and backend IDs", () => {
    const forbidden = [
      "generated://report.md",
      "/tmp/report.md",
      "C:\\tmp\\report.md",
      "cmrz0bbj300dvf8fuo2ym3861",
    ];
    for (const value of forbidden) {
      expect(() => __resultFinalizationTestHooks.validateFinalizedSpec({
        manifest,
        payload: resultSpec(value),
      })).toThrow("Finalized result contains a forbidden");
    }
  });

  it("rejects structurally invalid Chrona Specs", () => {
    expect(() => __resultFinalizationTestHooks.validateFinalizedSpec({
      manifest,
      payload: { root: "missing", elements: {} },
    })).toThrow("not a valid Chrona Spec");
  });
});
