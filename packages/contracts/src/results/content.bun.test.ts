import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  deliverableKindSchema,
  deliverablePresentationSchema,
  resultContributionSchema,
  resultEvidenceSchema,
  type ResultContributionContent,
} from "./content";
import {
  nodeDeliverableSchema,
  resultContributionSchema as apiContributionSchema,
  resultEvidenceSchema as apiEvidenceSchema,
} from "../api/result.schema";
import { taskCompletePayloadSchema } from "../api/mcp-task-tools.schema";
import { executionActionBodySchema } from "../api/execution.schema";
import type { ResultContribution } from "../plan-runtime/node-result";

const finding = {
  key: "research.summary",
  title: "Research finding",
  content: "The supplied evidence supports this conclusion.",
  importance: "primary",
} satisfies ResultContributionContent;

function wireHash(schema: z.ZodType): string {
  return createHash("sha256")
    .update(JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" })))
    .digest("hex");
}

describe("source-independent result content primitives", () => {
  it("accepts semantic content without a task, plan, run, node, or Provider", () => {
    expect(resultContributionSchema.parse(finding)).toEqual(finding);
    expect(resultEvidenceSchema.parse({ key: "source", summary: "A cited observation" }))
      .toEqual({ key: "source", summary: "A cited observation" });
  });

  it("uses the same schema instances in existing API composition", () => {
    expect(apiContributionSchema).toBe(resultContributionSchema);
    expect(apiEvidenceSchema).toBe(resultEvidenceSchema);
    expect(nodeDeliverableSchema.shape.kind).toBe(deliverableKindSchema);
    expect(nodeDeliverableSchema.shape.presentation.unwrap()).toBe(deliverablePresentationSchema);
  });

  it("keeps managed node provenance as a type extension, not client-authored content", () => {
    const managed = { ...finding, sourceNodeRef: "N00000001-01" } satisfies ResultContribution;
    expect(managed.content).toBe(finding.content);
    expect(resultContributionSchema.safeParse(managed).success).toBe(false);
  });

  it.each(["taskId", "runId", "sourceNodeRef", "actorId", "accepted", "permissions"])(
    "rejects the unknown %s field instead of treating it as authority",
    (field) => {
      expect(resultContributionSchema.safeParse({ ...finding, [field]: "claimed" }).success).toBe(false);
      expect(resultEvidenceSchema.safeParse({ key: "source", summary: "Evidence", [field]: "claimed" }).success).toBe(false);
    },
  );

  it.each(["finding", "A", "Fact_1", "source.v2-note", "a".repeat(128)])(
    "preserves the supported stable key %s",
    (key) => expect(resultContributionSchema.safeParse({ ...finding, key }).success).toBe(true),
  );

  it.each(["", "a".repeat(129), "has spaces", "../path", "_prefix"])(
    "rejects an invalid stable key",
    (key) => expect(resultContributionSchema.safeParse({ ...finding, key }).success).toBe(false),
  );

  it("preserves legacy string semantics; extraction does not silently normalize input", () => {
    expect(resultContributionSchema.parse({ key: "A", content: "  unchanged  " }).content).toBe("  unchanged  ");
    expect(resultContributionSchema.safeParse({ ...finding, content: "" }).success).toBe(false);
    expect(resultContributionSchema.safeParse({ ...finding, importance: "verified" }).success).toBe(false);
  });

  it("accepts an opaque artifact reference without claiming ownership validation", () => {
    const evidence = { key: "file", summary: "Evidence file", artifactRef: "AF0123456789AB" };
    expect(resultEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it.each(["AF0123456789ab", "AF0123", "/tmp/report.txt", "generated://run/file.txt"])(
    "does not accept a path or malformed artifact reference",
    (artifactRef) => expect(resultEvidenceSchema.safeParse({ key: "file", summary: "Evidence", artifactRef }).success).toBe(false),
  );

  it.each(["document", "table", "dataset", "image", "archive", "code", "other"])(
    "preserves deliverable kind %s",
    (kind) => expect(deliverableKindSchema.parse(kind)).toBe(kind),
  );

  it("keeps presentation declarative; it does not carry runtime controls", () => {
    expect(deliverablePresentationSchema.parse({ primary: "file", allowDownload: false }))
      .toEqual({ primary: "file", allowDownload: false });
    expect(deliverablePresentationSchema.safeParse({ primary: "file", allowDownload: true, action: "accept" }).success).toBe(false);
    expect(deliverablePresentationSchema.safeParse({ primary: "execute", allowDownload: true }).success).toBe(false);
  });
});

describe("phase A extraction preserves existing HTTP/MCP wire schemas", () => {
  // Captured before extraction. Changes here require an intentional protocol
  // review, not a snapshot update to make a supposedly behavior-free move pass.
  const cases = [
    ["MCP node completion", taskCompletePayloadSchema, "e4d1e28c1ddfce4c43ab58d799c51f001ee74d1311bfc109850218724486d689"],
    ["HTTP execution actions", executionActionBodySchema, "662e7094579853520866772aadd7f1750e4f5f5615ca408dcede6edf93b11f73"],
    ["managed deliverable declaration", nodeDeliverableSchema, "189947f45dd1d915276a51b1ddebdeaba0a6e5da07d7d82d361d8ce334a0b540"],
    ["semantic contribution", resultContributionSchema, "549842c082805f63c8d1d9c8a7413a8b6d0e56e7193606f348f2ee158f60014c"],
    ["semantic evidence", resultEvidenceSchema, "b4390157800f89ec97ac5922ed8109044cde066a2c85403b9c9c514440dc3e50"],
  ] as const;

  it.each(cases)("preserves %s", (_name, schema, expected) => {
    expect(wireHash(schema)).toBe(expected);
  });
});
