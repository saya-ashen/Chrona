import { z } from "zod";
import { workPageSchema } from "@chrona/ui-protocol/work-pages";
import { deliverableKindSchema, deliverablePresentationSchema, resultContributionSchema, resultEvidenceSchema } from "./content";

export const RESULT_REQUEST_BYTES = 96 * 1024;
export const RESULT_RESPONSE_BYTES = 128 * 1024;
export const RESULT_SCOPES = ["results:read", "results:write", "results:review"] as const;
export const resultIdSchema = z.string().min(1).max(128);
export const resultRevisionSchema = z.string().max(200).regex(/^result-v1:[A-Za-z0-9_-]+:[0-9]+$/);
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const body = z.string().min(1).max(8_000);
const artifactRef = z.string().regex(/^AF[0-9A-F]{12}$/);
const contribution = resultContributionSchema.extend({ key, title: z.string().min(1).max(256).optional(), content: body });
const evidence = resultEvidenceSchema.extend({ key, summary: body });

export const workResultContentSchema = z.object({
  schemaVersion: z.literal(1),
  page: workPageSchema.optional(),
  outcome: z.object({ title: z.string().min(1).max(256), summary: body }).strict(),
  readiness: z.object({ status: z.enum(["ready", "ready_with_caveats", "partial", "blocked"]), summary: body }).strict(),
  findings: z.array(contribution).max(100).default([]),
  decisions: z.array(contribution).max(100).default([]),
  caveats: z.array(contribution).max(100).default([]),
  nextActions: z.array(contribution).max(100).default([]),
  evidence: z.array(evidence).max(100).default([]),
  deliverables: z.array(z.object({
    key, title: z.string().min(1).max(256), kind: deliverableKindSchema, artifactRef,
    summary: body.optional(), presentation: deliverablePresentationSchema.optional(),
    placement: z.enum(["primary", "supporting", "evidence"]).default("primary"), required: z.boolean().default(true),
  }).strict()).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  for (const field of ["findings", "decisions", "caveats", "nextActions", "evidence", "deliverables"] as const) {
    if (new Set(value[field].map((item) => item.key)).size !== value[field].length) {
      ctx.addIssue({ code: "custom", path: [field], message: "Duplicate semantic key" });
    }
  }
  const refs = new Set([...value.deliverables.map((item) => item.artifactRef), ...value.evidence.flatMap((item) => item.artifactRef ? [item.artifactRef] : [])]);
  if (refs.size > 20) ctx.addIssue({ code: "custom", message: "At most 20 distinct artifacts per version" });
});

const scope = { taskId: resultIdSchema, occurrenceId: resultIdSchema.nullable().default(null) };
export const publishWorkResultSchema = z.object({
  ...scope, requestId: z.uuid(), expectedRevision: resultRevisionSchema.nullable().describe("Use editRevision from result_read; null only when no result container exists. On conflict, read and reconcile, never blindly retry with a new revision."), content: workResultContentSchema,
  source: z.object({ label: z.string().min(1).max(200).optional(), workId: z.string().min(1).max(200).optional(), reportedAt: z.iso.datetime({ offset: true }).optional() }).strict().optional(),
}).strict();
export const reviewWorkResultSchema = z.object({
  ...scope, requestId: z.uuid(), expectedRevision: resultRevisionSchema, versionId: resultIdSchema,
  decision: z.enum(["accept", "request_changes", "reject"]), feedback: body.optional(),
}).strict();
export const readWorkResultSchema = z.object({
  ...scope, selection: z.enum(["latest", "accepted", "version"]).default("latest"), versionId: resultIdSchema.optional(),
  view: z.enum(["content", "versions", "reviews"]).default("content"),
  offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(20).default(10),
}).strict().refine((v) => (v.selection === "version") === (v.versionId !== undefined), { message: "An exact version selector requires versionId; other selectors forbid it" })
  .refine((v) => v.view !== "versions" || v.selection === "latest", { message: "Version listings use the latest selector" }).meta({
    // Mirror cross-field selectors in the actual MCP object-root JSON schema.
    allOf: [
      { if: { properties: { selection: { const: "version" } }, required: ["selection"] }, then: { required: ["versionId"] }, else: { not: { required: ["versionId"] } } },
      { if: { properties: { view: { const: "versions" } }, required: ["view"] }, then: { properties: { selection: { const: "latest" } } } },
    ],
  });

export const resultReceiptSchema = z.object({
  commandId: resultIdSchema, operation: z.enum(["publish", "review"]), resultId: resultIdSchema,
  versionId: resultIdSchema, version: z.number().int().positive(), editRevision: resultRevisionSchema,
  acceptedVersionId: resultIdSchema.nullable(), reviewId: resultIdSchema.optional(),
  recordedAt: z.iso.datetime(), executionStarted: z.literal(false), taskStatusChanged: z.literal(false),
}).strict();
export type WorkResultContent = z.infer<typeof workResultContentSchema>;
export type PublishWorkResult = z.infer<typeof publishWorkResultSchema>;
export type ReviewWorkResult = z.infer<typeof reviewWorkResultSchema>;
export type ReadWorkResult = z.infer<typeof readWorkResultSchema>;
export type ResultReceipt = z.infer<typeof resultReceiptSchema>;
