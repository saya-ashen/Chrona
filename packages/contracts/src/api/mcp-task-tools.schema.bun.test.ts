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

describe("Goal result read contract", () => {
  it("accepts an opaque exact ref and rejects backend identities", () => {
    expect(parseChronaToolPayload("chrona.goal.results.read", {
      ref: "GA123456ABCDEF",
      offset: 12_000,
      maxChars: 4_000,
      limit: 1,
    })).toEqual({ ref: "GA123456ABCDEF", offset: 12_000, maxChars: 4_000, limit: 1 });
    expect(() => parseChronaToolPayload("chrona.goal.results.read", {
      ref: "cms4h510s0006fhfumew2hks4",
      limit: 1,
    })).toThrow();
    expect(() => parseChronaToolPayload("chrona.goal.results.read", {
      ref: "GA123456ABCDEF",
      maxChars: 12_001,
    })).toThrow();
  });
});

describe("MCP resource limits", () => {
  it("rejects oversized records and deeply nested evidence", () => {
    const oversizedEvidence = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, "value"]));
    expect(() => parseChronaToolPayload("chrona.node.condition_select", {
      nodeId: "node-1",
      branchRef: "branch-1",
      summary: "Selected",
      evidence: oversizedEvidence,
    })).toThrow();

    let deeplyNested: unknown = "leaf";
    for (let depth = 0; depth < 9; depth += 1) deeplyNested = { deeplyNested };
    expect(() => parseChronaToolPayload("chrona.node.condition_select", {
      nodeId: "node-1",
      branchRef: "branch-1",
      summary: "Selected",
      evidence: { deeplyNested },
    })).toThrow();
  });
});
