import { describe, expect, it } from "bun:test";
import { structuredResultToMarkdown } from "./goal-asset-export";

const content = {
  format: "chrona-json-render" as const,
  schemaVersion: 1 as const,
  catalogVersion: "1.0.0",
  summary: "Destination selected",
  spec: {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["summary", "decision", "risk", "file"] },
      summary: { type: "ResultSummary", props: { text: "日照＋临沂沂蒙山" } },
      decision: { type: "RichMarkdown", props: { title: "Decision", content: "**Selected** for the final itinerary." } },
      risk: { type: "Alert", props: { title: "Constraint", description: "Avoid the holiday peak." } },
      file: { type: "FileRef", props: { path: "GF123", title: "destination-shortlist.csv" } },
    },
  },
  artifactRefs: [{ ref: "GF123", title: "destination-shortlist.csv", mimeType: "text/csv", size: 120, checksum: "abc" }],
};
describe("structuredResultToMarkdown", () => {
  it("preserves the readable hierarchy without leaking file URIs", () => {
    const markdown = structuredResultToMarkdown(content);
    expect(markdown).toContain("日照＋临沂沂蒙山");
    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("Avoid the holiday peak");
    expect(markdown).toContain("destination-shortlist.csv");
    expect(markdown).not.toContain("generated://");
  });
});
