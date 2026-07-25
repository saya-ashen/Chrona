import { describe, expect, it } from "bun:test";
import {
  agentControlActionPayloadSchemas,
  chronaPublicToolPayloadSchemas,
  chronaToolNames,
  parseChronaToolPayload,
} from "./mcp-task-tools.schema";

describe("result submission contracts", () => {
  it("removes the legacy plan output tool", () => {
    expect(chronaToolNames).not.toContain("chrona.plan.output" as never);
    expect("chrona.plan.output" in chronaPublicToolPayloadSchemas).toBe(false);
  });

  it("parses semantic completion contributions", () => {
    expect(
      parseChronaToolPayload("chrona.node.complete", {
        summary: "Research complete",
        deliverables: [
          {
            deliverableKey: "channel-table",
            title: "Channel table",
            kind: "table",
            source: {
              type: "generated_file",
              uri: "generated://20260725/N20260725-01/channels.csv",
            },
          },
        ],
        findings: [
          { key: "best-channel", content: "Channel A has the strongest fit." },
        ],
        caveats: [
          { key: "sample-size", content: "Sample size is limited." },
        ],
      }),
    ).toEqual({
      summary: "Research complete",
      deliverables: [
        {
          deliverableKey: "channel-table",
          title: "Channel table",
          kind: "table",
          source: {
            type: "generated_file",
            uri: "generated://20260725/N20260725-01/channels.csv",
          },
        },
      ],
      findings: [
        { key: "best-channel", content: "Channel A has the strongest fit." },
      ],
      caveats: [
        { key: "sample-size", content: "Sample size is limited." },
      ],
    });
  });

  it("rejects unsafe deliverable references", () => {
    expect(() =>
      parseChronaToolPayload("chrona.node.complete", {
        summary: "Done",
        deliverables: [
          {
            deliverableKey: "report",
            title: "Report",
            kind: "document",
            source: { type: "generated_file", uri: "/tmp/report.md" },
          },
        ],
      }),
    ).toThrow();
  });

  it("shares the completion schema with agent control", () => {
    expect(agentControlActionPayloadSchemas.complete).toBe(
      chronaPublicToolPayloadSchemas["chrona.node.complete"],
    );
  });
});
