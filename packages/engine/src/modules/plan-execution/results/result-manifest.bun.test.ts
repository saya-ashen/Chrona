import { describe, expect, it } from "bun:test";
import type { NodeResult } from "@chrona/contracts/ai";
import {
  aggregateResultManifest,
  createEmptyResultManifest,
} from "./result-manifest";

describe("ResultManifest aggregation", () => {
  it("is stable when canonical node results do not change", () => {
    const results: NodeResult[] = [{
      nodeId: "node-a",
      status: "current",
      outputSummary: "Research complete",
      findings: [{ key: "market-fit", content: "Strong fit" }],
    }];
    const first = aggregateResultManifest({
      results,
      previous: createEmptyResultManifest(),
      sourceNodeRef: () => "N20260725-01",
    });
    const replay = aggregateResultManifest({
      results,
      previous: first,
      sourceNodeRef: () => "N20260725-01",
    });

    expect(first.sourceRevision).toBe(1);
    expect(replay).toEqual(first);
  });

  it("uses current semantic results and preserves superseded deliverables", () => {
    const first = aggregateResultManifest({
      results: [{
        nodeId: "node-a",
        status: "current",
        outputSummary: "Draft complete",
        deliverables: [{
          deliverableKey: "report",
          title: "Report",
          kind: "document",
          artifactRef: "AF111111111111",
          status: "current",
          sourceNodeRef: "N20260725-01",
          presentation: { primary: "file", allowDownload: true },
          placement: "primary",
        }],
      }],
      previous: createEmptyResultManifest(),
      sourceNodeRef: () => "N20260725-01",
    });
    const second = aggregateResultManifest({
      results: [{
        nodeId: "node-b",
        status: "current",
        outputSummary: "Final report complete",
        deliverables: [{
          deliverableKey: "report",
          title: "Report",
          kind: "document",
          artifactRef: "AF222222222222",
          status: "current",
          sourceNodeRef: "N20260725-02",
          presentation: { primary: "file", allowDownload: true },
          placement: "primary",
        }],
      }],
      previous: first,
      sourceNodeRef: () => "N20260725-02",
    });

    expect(second.sourceRevision).toBe(2);
    expect(second.deliverables).toEqual([
      expect.objectContaining({ artifactRef: "AF111111111111", status: "superseded" }),
      expect.objectContaining({
        artifactRef: "AF222222222222",
        status: "current",
        supersedes: "AF111111111111",
      }),
    ]);
    expect(second.sections.map((section) => section.kind)).toEqual([
      "outcome",
      "deliverables",
    ]);
  });

  it("excludes stale contributions from the canonical manifest", () => {
    const manifest = aggregateResultManifest({
      results: [
        {
          nodeId: "node-old",
          status: "stale",
          outputSummary: "Old answer",
          findings: [{ key: "answer", content: "Old" }],
        },
        {
          nodeId: "node-current",
          status: "current",
          outputSummary: "Current answer",
          findings: [{ key: "answer", content: "Current" }],
        },
      ],
      previous: createEmptyResultManifest(),
      sourceNodeRef: (nodeId) => nodeId === "node-current" ? "N20260725-02" : "N20260725-01",
    });

    expect(manifest.outcome.title).toBe("Current answer");
    expect(manifest.findings).toEqual([
      { key: "answer", content: "Current", sourceNodeRef: "N20260725-02" },
    ]);
  });
});
