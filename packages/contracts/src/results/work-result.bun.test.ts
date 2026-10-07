import { describe, expect, it } from "bun:test";
import { publishWorkResultSchema, readWorkResultSchema, reviewWorkResultSchema, workResultContentSchema } from "./work-result";

const content = { schemaVersion: 1, outcome: { title: "Result", summary: "Recorded work" }, readiness: { status: "ready", summary: "Ready for review" } };
const publish = { taskId: "task", requestId: crypto.randomUUID(), expectedRevision: null, content };

describe("source-independent result contracts", () => {
  it("normalizes safe defaults without inventing execution identity", () => {
    expect(publishWorkResultSchema.parse(publish)).toMatchObject({ occurrenceId: null, content: { findings: [], deliverables: [] } });
  });
  it.each(["actorId", "actorKind", "runId", "status", "acceptedVersionId", "workspaceId", "permissions"])("rejects caller authority field %s", (field) => {
    expect(publishWorkResultSchema.safeParse({ ...publish, [field]: "forged" }).success).toBe(false);
    expect(publishWorkResultSchema.safeParse({ ...publish, source: { [field]: "forged" } }).success).toBe(false);
  });
  it("rejects unbounded, duplicate, path-based and internal-node content", () => {
    for (const value of [
      { ...content, outcome: { title: "Result", summary: "x".repeat(8_001) } },
      { ...content, findings: [{ key: "x", content: "first" }, { key: "x", content: "second" }] },
      { ...content, findings: [{ key: "x", content: "first", sourceNodeRef: "N1" }] },
      { ...content, deliverables: [{ key: "file", title: "File", kind: "document", source: { type: "generated_file", uri: "generated://outside" } }] },
      { ...content, evidence: Array.from({ length: 21 }, (_, n) => ({ key: `e${n}`, summary: "Evidence", artifactRef: `AF${n.toString(16).padStart(12, "0").toUpperCase()}` })) },
    ]) expect(workResultContentSchema.safeParse(value).success).toBe(false);
  });
  it("binds review to a concrete revision/version and makes selectors unambiguous", () => {
    expect(reviewWorkResultSchema.safeParse({ ...publish, decision: "accept" }).success).toBe(false);
    for (const selector of [{ selection: "version" }, { selection: "latest", versionId: "v1" }, { view: "versions", selection: "accepted" }]) {
      expect(readWorkResultSchema.safeParse({ taskId: "task", ...selector }).success).toBe(false);
    }
    expect(readWorkResultSchema.parse({ taskId: "task", selection: "version", versionId: "v1" })).toMatchObject({ view: "content", offset: 0, limit: 10 });
  });
});
